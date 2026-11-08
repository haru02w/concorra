import { computeGaps } from "@/domain/analysis/gaps";
import type { NoticeExtraction } from "@/domain/analysis/extraction";
import { assertTransition, canMarkReady, nextPackStep, type Bid, type GeneratedDocKind, type GeneratedDocument } from "@/domain/bid/bid";
import {
  COVER_LETTER_TEMPLATE,
  declarationTemplate,
  formatProposalTotal,
  listAiSlots,
  PROPOSAL_TEMPLATE,
  proposalTable,
  renderTemplate,
  type ProposalLine,
  type TemplateContext,
} from "@/domain/bid/templates";
import { verifyGeneratedDocument } from "@/domain/bid/verification";
import { DOCUMENT_KIND_LABELS } from "@/domain/documents/document";
import type { Notice } from "@/domain/notice/notice";
import { hasMeEppBenefits, type Organization } from "@/domain/organization/organization";
import { DomainError, NotFoundError, ValidationError } from "@/domain/shared/errors";
import { l2normalize } from "@/domain/shared/vector";
import type { Deps, PriceReference } from "../shared/ports";
import { consumeQuota, loadOrg, safeFileName, storeBytes, type Actor } from "../shared/context";
import { noticeLink } from "@/domain/notice/notice";
import type { AnalysisService } from "../analysis/analysis.service";
import type { NotificationsService } from "../notifications/notifications.service";

/** Lei 14.133/2021 declarations used when the edital does not list its own. */
export function standardDeclarations(org: Pick<Organization, "porte">): { key: string; title: string; guidance: string }[] {
  const list = [
    { key: "habilitacao", title: "Declaração de cumprimento dos requisitos de habilitação", guidance: "Art. 63, I da Lei 14.133/2021." },
    { key: "fatos-impeditivos", title: "Declaração de inexistência de fatos impeditivos", guidance: "Inexistência de fatos impeditivos à habilitação." },
    { key: "menor", title: "Declaração de não emprego de menor", guidance: "Art. 7º, XXXIII da Constituição Federal." },
    { key: "pcd", title: "Declaração de reserva de cargos para pessoa com deficiência", guidance: "Art. 63, IV da Lei 14.133/2021." },
    { key: "custos", title: "Declaração de integralidade dos custos da proposta", guidance: "Art. 63, §1º da Lei 14.133/2021." },
  ];
  if (hasMeEppBenefits(org.porte)) {
    list.push({ key: "me-epp", title: "Declaração de enquadramento como ME/EPP", guidance: "LC 123/2006, arts. 42 a 49." });
  }
  return list;
}

function templateContext(org: Organization, notice: Notice, now: Date): TemplateContext {
  return {
    razaoSocial: org.razaoSocial,
    cnpj: org.cnpj,
    endereco: org.endereco ?? "",
    representante: org.representante ?? "Representante legal",
    orgaoNome: notice.orgaoNome,
    numeroEdital: notice.numeroCompra ?? notice.numeroControlePNCP,
    processo: notice.processo ?? "-",
    objeto: notice.objeto,
    cidade: org.municipio ?? "",
    data: new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(now),
  };
}

interface DraftSpec {
  key: string;
  kind: GeneratedDocKind;
  title: string;
  template: string;
  guidance: string;
}

function draftSpecs(org: Organization, extraction: NoticeExtraction): DraftSpec[] {
  const declarations = extraction.declarations.length
    ? extraction.declarations.map((d) => ({ key: `declaration:${d.id}`, title: d.title, guidance: d.description }))
    : standardDeclarations(org).map((d) => ({ key: `declaration:${d.key}`, title: d.title, guidance: d.guidance }));
  return [
    ...declarations.map((d) => ({ ...d, kind: "declaration" as const, template: declarationTemplate(d.title) })),
    { key: "proposal", kind: "proposal", title: "Proposta comercial", template: PROPOSAL_TEMPLATE, guidance: "Proposta de preços conforme o edital." },
    { key: "cover_letter", kind: "cover_letter", title: "Carta de apresentação", template: COVER_LETTER_TEMPLATE, guidance: "Apresentação da empresa e sua experiência." },
    ...extraction.annexModels.map((a, i) => ({
      key: `annex:${i}`,
      kind: "annex" as const,
      title: a.title,
      template: declarationTemplate(a.title),
      guidance: a.description,
    })),
  ];
}

function requirementTexts(extraction: NoticeExtraction): string[] {
  return [...extraction.declarations.map((d) => `${d.title}: ${d.description}`), ...extraction.annexModels.map((a) => `${a.title}: ${a.description}`)];
}

export class BidsService {
  constructor(
    private readonly deps: Deps,
    private readonly analysis: AnalysisService,
    private readonly notifications: NotificationsService,
  ) {}

  /** F5: participate (consumes a bid pack) or skip with an optional reason. */
  async decideParticipation(actor: Actor, input: { noticeId: string; decision: "participate" | "skip"; reason?: string }): Promise<Bid> {
    const notice = await this.deps.notices.findById(input.noticeId);
    if (!notice) throw new NotFoundError("Notice", input.noticeId);
    const existing = await this.deps.bids.findByNotice(actor.organizationId, notice.id);
    const latest = await this.deps.analyses.findLatest(actor.organizationId, notice.id);

    if (input.decision === "skip") {
      if (existing) {
        assertTransition(existing.status, "skipped");
        return this.deps.bids.update(existing.id, { status: "skipped", skipReason: input.reason ?? null });
      }
      return this.deps.bids.create({
        organizationId: actor.organizationId,
        noticeId: notice.id,
        analysisId: latest?.id ?? null,
        status: "skipped",
        skipReason: input.reason ?? null,
      });
    }

    if (existing) assertTransition(existing.status, "participating");
    await consumeQuota(this.deps, actor.organizationId, "bidPacks");
    const bid = existing
      ? await this.deps.bids.update(existing.id, { status: "participating", skipReason: null, packStatus: "idle", packSteps: [], packError: null })
      : await this.deps.bids.create({ organizationId: actor.organizationId, noticeId: notice.id, analysisId: latest?.id ?? null, status: "participating", skipReason: null });
    await this.deps.jobs.enqueue("bid.build-pack", { bidId: bid.id }, { singletonKey: bid.id });
    await this.deps.jobs.enqueue("calendar.sync", { refType: "bid", refId: bid.id, organizationId: actor.organizationId, action: "upsert" });
    return bid;
  }

  /**
   * Job: builds the bid pack as resumable steps (checklist → prices → drafts →
   * verify → render → instructions). Completed steps are skipped on retry.
   */
  async buildBidPack(input: { bidId: string }): Promise<Bid> {
    let bid = await this.deps.bids.findByIdUnscoped(input.bidId);
    if (!bid) throw new NotFoundError("Bid", input.bidId);
    if (bid.status !== "participating") return bid;
    const notice = await this.deps.notices.findById(bid.noticeId);
    if (!notice) throw new NotFoundError("Notice", bid.noticeId);
    const org = await loadOrg(this.deps, bid.organizationId);

    // The pack needs a finished analysis; request one and come back later.
    let analysis = bid.analysisId ? await this.deps.analyses.findById(bid.analysisId) : await this.deps.analyses.findLatest(org.id, notice.id);
    if (!analysis || analysis.status === "failed") {
      analysis = await this.analysis.requestAnalysis(org.id, notice.id, { force: analysis?.status === "failed" });
    }
    if (analysis.id !== bid.analysisId) bid = await this.deps.bids.update(bid.id, { analysisId: analysis.id });
    if (analysis.status !== "done" || !analysis.extraction) {
      await this.deps.bids.update(bid.id, { packStatus: "building" });
      await this.deps.jobs.enqueue("bid.build-pack", { bidId: bid.id }, { startAfterSeconds: 30 });
      return bid;
    }
    const extraction = analysis.extraction;
    await this.deps.bids.update(bid.id, { packStatus: "building", packError: null });

    try {
      for (let step = nextPackStep(bid.packSteps); step; step = nextPackStep(bid.packSteps)) {
        if (step === "checklist") await this.stepChecklist(bid, org, notice, extraction);
        if (step === "prices") await this.stepPrices(bid, notice);
        if (step === "drafts") await this.stepDrafts(bid, org, notice, extraction);
        if (step === "verify") await this.stepVerify(bid, org, notice, extraction);
        if (step === "render") await this.stepRender(bid);
        if (step === "instructions") await this.stepInstructions(bid, org, notice, extraction);
        await this.deps.bids.completeStep(bid.id, step);
        bid = { ...bid, packSteps: [...bid.packSteps, step] };
      }
    } catch (error) {
      await this.deps.bids.update(bid.id, { packStatus: "failed", packError: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    bid = await this.deps.bids.update(bid.id, { packStatus: "done" });
    await this.notifications.notifyOrganization(org.id, {
      type: "bid_pack_ready",
      title: "Pacote da licitação pronto para revisão",
      body: `${notice.objeto.slice(0, 160)}\nRevise e aprove cada documento antes de enviar.`,
      link: `/bids/${bid.id}`,
    });
    return bid;
  }

  private async stepChecklist(bid: Bid, org: Organization, notice: Notice, extraction: NoticeExtraction) {
    const docs = await this.deps.documents.listByOrg(org.id);
    await this.deps.bids.saveChecklist(bid.id, computeGaps(extraction.requirements, docs, notice.dataEncerramento));
  }

  private async stepPrices(bid: Bid, notice: Notice) {
    const items = await this.deps.notices.listItems(notice.id);
    const refs: Record<number, PriceReference[]> = {};
    if (items.length) {
      const embeddings = (await this.deps.ai.embed(items.map((i) => i.descricao), "query")).map(l2normalize);
      for (const [i, item] of items.entries()) refs[item.numeroItem] = await this.deps.contractItems.similar(embeddings[i], 5);
    }
    await this.deps.bids.savePriceReferences(bid.id, refs);
    if (!(await this.deps.bids.getProposalLines(bid.id)).length) {
      await this.deps.bids.saveProposalLines(
        bid.id,
        items.map((i) => ({ numeroItem: i.numeroItem, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade ?? 1, unitPriceCents: null })),
      );
    }
  }

  private async renderProposalMarkdown(bidId: string, ctx: TemplateContext, ai: Record<string, string>) {
    const { table, totalCents } = proposalTable(await this.deps.bids.getProposalLines(bidId));
    return renderTemplate(PROPOSAL_TEMPLATE, { ...ctx, items_table: table, total: formatProposalTotal(totalCents) }, ai);
  }

  private async stepDrafts(bid: Bid, org: Organization, notice: Notice, extraction: NoticeExtraction) {
    const ctx = templateContext(org, notice, this.deps.clock.now());
    const existing = new Set((await this.deps.generatedDocs.listByBid(bid.id)).map((d) => d.key));
    for (const spec of draftSpecs(org, extraction)) {
      if (existing.has(spec.key)) continue; // resume after a crash
      const query = (await this.deps.ai.embed([`${spec.title}. ${spec.guidance}`], "query")).map(l2normalize)[0];
      const excerpts = (await this.deps.noticeFiles.searchChunks(notice.id, query, 4)).map((c) => c.text);
      const ai = await this.deps.ai.draft({
        kind: spec.kind,
        title: spec.title,
        slots: listAiSlots(spec.template),
        company: { razaoSocial: org.razaoSocial, porte: org.porte, expertise: org.expertiseText },
        notice: { objeto: notice.objeto, orgaoNome: notice.orgaoNome, numeroEdital: ctx.numeroEdital, modalidade: notice.modalidadeNome },
        excerpts,
        guidance: spec.guidance,
      });
      const markdown = spec.kind === "proposal" ? await this.renderProposalMarkdown(bid.id, ctx, ai) : renderTemplate(spec.template, ctx, ai);
      await this.deps.generatedDocs.upsert(bid.id, spec.key, {
        kind: spec.kind,
        title: spec.title,
        markdown,
        aiSlots: ai,
        status: "draft",
        verification: [],
        docxFileId: null,
        pdfFileId: null,
      });
    }
  }

  private async stepVerify(bid: Bid, org: Organization, notice: Notice, extraction: NoticeExtraction) {
    const ctx = templateContext(org, notice, this.deps.clock.now());
    for (const doc of await this.deps.generatedDocs.listByBid(bid.id)) {
      if (doc.kind === "instructions") continue;
      const issues = [
        ...verifyGeneratedDocument(doc.markdown, ctx),
        ...(await this.deps.ai.verifyDocument({ markdown: doc.markdown, requirements: requirementTexts(extraction) })),
      ];
      await this.deps.generatedDocs.update(doc.id, { verification: issues });
    }
  }

  private async renderOne(organizationId: string, doc: GeneratedDocument) {
    const base = safeFileName(doc.title);
    const [docx, pdf] = await Promise.all([this.deps.renderer.toDocx(doc.markdown), this.deps.renderer.toPdf(doc.markdown)]);
    const docxFile = await storeBytes(this.deps, organizationId, {
      name: `${base}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: docx,
    });
    const pdfFile = await storeBytes(this.deps, organizationId, { name: `${base}.pdf`, mime: "application/pdf", bytes: pdf });
    for (const old of [doc.docxFileId, doc.pdfFileId]) {
      if (!old) continue;
      const file = await this.deps.files.findById(old);
      if (file) {
        await this.deps.storage.delete(file.storageKey).catch(() => undefined);
        await this.deps.files.delete(file.id);
      }
    }
    await this.deps.generatedDocs.update(doc.id, { docxFileId: docxFile.id, pdfFileId: pdfFile.id });
  }

  private async stepRender(bid: Bid) {
    for (const doc of await this.deps.generatedDocs.listByBid(bid.id)) {
      if (doc.kind === "instructions" || (doc.docxFileId && doc.pdfFileId)) continue;
      await this.renderOne(bid.organizationId, doc);
    }
  }

  private async stepInstructions(bid: Bid, org: Organization, notice: Notice, extraction: NoticeExtraction) {
    const checklist = await this.deps.bids.getChecklist(bid.id);
    const generated = await this.deps.generatedDocs.listByBid(bid.id);
    const query = (await this.deps.ai.embed(["envio da proposta e documentos de habilitação no sistema eletrônico, prazos e forma de envio"], "query")).map(l2normalize)[0];
    const excerpts = (await this.deps.noticeFiles.searchChunks(notice.id, query, 4)).map((c) => c.text);
    const markdown = await this.deps.ai.submissionInstructions({
      portal: extraction.submissionPortal,
      link: noticeLink(notice),
      modalidade: notice.modalidadeNome,
      documents: [
        ...checklist.map((g) => (g.documentKind ? `${DOCUMENT_KIND_LABELS[g.documentKind]} — ${g.description}` : g.description)),
        ...generated.filter((d) => d.kind !== "instructions").map((d) => d.title),
      ],
      declarations: extraction.declarations.map((d) => d.title),
      excerpts,
    });
    await this.deps.generatedDocs.upsert(bid.id, "instructions", {
      kind: "instructions",
      title: "Instruções de envio",
      markdown,
      aiSlots: {},
      status: "approved",
      verification: [],
      docxFileId: null,
      pdfFileId: null,
    });
  }

  private async loadBidForActor(actor: Actor, bidId: string): Promise<Bid> {
    const bid = await this.deps.bids.findById(actor.organizationId, bidId);
    if (!bid) throw new NotFoundError("Bid", bidId);
    return bid;
  }

  private async loadDocForActor(actor: Actor, docId: string) {
    const doc = await this.deps.generatedDocs.findById(docId);
    if (!doc) throw new NotFoundError("GeneratedDocument", docId);
    const bid = await this.loadBidForActor(actor, doc.bidId);
    return { doc, bid };
  }

  /** User sets unit prices; the proposta is re-rendered by code (prices are never auto-filled). */
  async updateProposalPrices(actor: Actor, bidId: string, prices: Record<number, number | null>): Promise<ProposalLine[]> {
    const bid = await this.loadBidForActor(actor, bidId);
    const lines = await this.deps.bids.getProposalLines(bid.id);
    const updated: ProposalLine[] = lines.map((l) => {
      const price = prices[l.numeroItem];
      if (price !== undefined && price !== null && (price < 0 || !Number.isFinite(price))) throw new ValidationError("Preço inválido");
      return price === undefined ? l : { ...l, unitPriceCents: price === null ? null : Math.round(price) };
    });
    await this.deps.bids.saveProposalLines(bid.id, updated);
    const proposal = (await this.deps.generatedDocs.listByBid(bid.id)).find((d) => d.kind === "proposal");
    if (!proposal) return updated;
    const notice = (await this.deps.notices.findById(bid.noticeId))!;
    const org = await loadOrg(this.deps, bid.organizationId);
    const ctx = templateContext(org, notice, this.deps.clock.now());
    const markdown = await this.renderProposalMarkdown(bid.id, ctx, proposal.aiSlots);
    await this.deps.generatedDocs.update(proposal.id, { markdown, status: "draft", verification: verifyGeneratedDocument(markdown, ctx) });
    await this.deps.jobs.enqueue("bid.render-doc", { generatedDocumentId: proposal.id });
    return updated;
  }

  async editGeneratedDocument(actor: Actor, docId: string, markdown: string): Promise<GeneratedDocument> {
    const { doc, bid } = await this.loadDocForActor(actor, docId);
    if (!markdown.trim()) throw new ValidationError("Documento vazio");
    const notice = (await this.deps.notices.findById(bid.noticeId))!;
    const org = await loadOrg(this.deps, bid.organizationId);
    const verification = doc.kind === "instructions" ? [] : verifyGeneratedDocument(markdown, templateContext(org, notice, this.deps.clock.now()));
    const updated = await this.deps.generatedDocs.update(doc.id, { markdown, status: doc.kind === "instructions" ? "approved" : "draft", verification });
    if (doc.kind !== "instructions") await this.deps.jobs.enqueue("bid.render-doc", { generatedDocumentId: doc.id });
    return updated;
  }

  /** Job: re-render DOCX/PDF of one generated document after edits. */
  async renderGeneratedDocument(input: { generatedDocumentId: string }) {
    const doc = await this.deps.generatedDocs.findById(input.generatedDocumentId);
    if (!doc) throw new NotFoundError("GeneratedDocument", input.generatedDocumentId);
    const bid = await this.deps.bids.findByIdUnscoped(doc.bidId);
    if (!bid) throw new NotFoundError("Bid", doc.bidId);
    await this.renderOne(bid.organizationId, doc);
  }

  async approveGeneratedDocument(actor: Actor, docId: string): Promise<GeneratedDocument> {
    const { doc } = await this.loadDocForActor(actor, docId);
    if (doc.verification.some((v) => v.severity === "error")) {
      throw new DomainError("Corrija os erros de verificação antes de aprovar", "verification_failed");
    }
    return this.deps.generatedDocs.update(doc.id, { status: "approved" });
  }

  async markBidReady(actor: Actor, bidId: string): Promise<Bid> {
    const bid = await this.loadBidForActor(actor, bidId);
    assertTransition(bid.status, "ready");
    const docs = (await this.deps.generatedDocs.listByBid(bid.id)).filter((d) => d.kind !== "instructions");
    const check = canMarkReady(docs);
    if (!check.ok) throw new DomainError(check.reason!, "not_ready");
    return this.deps.bids.update(bid.id, { status: "ready" });
  }

  async markBidSubmitted(actor: Actor, bidId: string): Promise<Bid> {
    const bid = await this.loadBidForActor(actor, bidId);
    assertTransition(bid.status, "submitted");
    return this.deps.bids.update(bid.id, { status: "submitted" });
  }

  async cancelBid(actor: Actor, bidId: string): Promise<Bid> {
    const bid = await this.loadBidForActor(actor, bidId);
    assertTransition(bid.status, "cancelled");
    const updated = await this.deps.bids.update(bid.id, { status: "cancelled" });
    await this.deps.jobs.enqueue("calendar.sync", { refType: "bid", refId: bid.id, organizationId: actor.organizationId, action: "delete" });
    return updated;
  }

  /** ZIP with every generated DOCX/PDF, the vault documents in the checklist and a README. */
  async exportBidZip(actor: Actor, bidId: string): Promise<{ name: string; bytes: Uint8Array }> {
    const bid = await this.loadBidForActor(actor, bidId);
    const notice = await this.deps.notices.findById(bid.noticeId);
    const entries: { name: string; bytes: Uint8Array }[] = [];
    const addFile = async (fileId: string | null, folder: string) => {
      if (!fileId) return;
      const file = await this.deps.files.findById(fileId);
      if (!file || file.organizationId !== actor.organizationId) return;
      entries.push({ name: `${folder}/${safeFileName(file.name)}`, bytes: await this.deps.storage.get(file.storageKey) });
    };
    const generated = await this.deps.generatedDocs.listByBid(bid.id);
    for (const doc of generated) {
      if (doc.kind === "instructions") {
        entries.push({ name: "00-INSTRUCOES.md", bytes: new TextEncoder().encode(doc.markdown) });
        continue;
      }
      await addFile(doc.docxFileId, "documentos-gerados/docx");
      await addFile(doc.pdfFileId, "documentos-gerados/pdf");
    }
    const checklist = await this.deps.bids.getChecklist(bid.id);
    for (const gap of checklist) {
      if (!gap.documentId) continue;
      const doc = await this.deps.documents.findById(actor.organizationId, gap.documentId);
      if (doc) await addFile(doc.fileId, "habilitacao");
    }
    const lines = checklist.map((g) => `- [${g.status === "have" ? "x" : " "}] ${g.description} — ${g.status} (${g.note})`);
    entries.push({ name: "01-CHECKLIST.md", bytes: new TextEncoder().encode(`# Checklist de habilitação\n\n${lines.join("\n")}\n`) });
    const name = `concorra-${safeFileName(notice?.numeroCompra ?? bid.id)}.zip`;
    return { name, bytes: await this.deps.archiver.zip(entries) };
  }

  async listBids(actor: Actor) {
    return this.deps.bids.listByOrg(actor.organizationId);
  }

  async findBidForNotice(actor: Actor, noticeId: string): Promise<Bid | null> {
    return this.deps.bids.findByNotice(actor.organizationId, noticeId);
  }

  /** Bid with its pack: notice, checklist (plus the vault file of each matched document), proposal lines, price references, generated documents and calendar event count. */
  async getBidDetail(actor: Actor, bidId: string) {
    const bid = await this.loadBidForActor(actor, bidId);
    const [notice, checklist, proposalLines, priceReferences, documents, events] = await Promise.all([
      this.deps.notices.findById(bid.noticeId),
      this.deps.bids.getChecklist(bid.id),
      this.deps.bids.getProposalLines(bid.id),
      this.deps.bids.getPriceReferences(bid.id),
      this.deps.generatedDocs.listByBid(bid.id),
      this.deps.calendars.listEventsByRef("bid", bid.id),
    ]);
    if (!notice) throw new NotFoundError("Notice", bid.noticeId);
    const vaultFileIds: Record<string, string> = {};
    for (const gap of checklist) {
      if (!gap.documentId || gap.documentId in vaultFileIds) continue;
      const doc = await this.deps.documents.findById(actor.organizationId, gap.documentId);
      if (doc) vaultFileIds[gap.documentId] = doc.fileId;
    }
    return { bid, notice, checklist, proposalLines, priceReferences, documents, calendarEvents: events.length, vaultFileIds };
  }
}
