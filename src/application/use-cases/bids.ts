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
import type { Deps } from "../ports";
import { consumeQuota, loadOrg, safeFileName, storeBytes, type Actor } from "./context";
import { requestAnalysis } from "./analysis";
import { notifyOrganization } from "./notifications";
import { noticeLink } from "./radar";

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

type DecideDeps = Pick<Deps, "bids" | "notices" | "analyses" | "organizations" | "usage" | "clock" | "jobs">;

/** F5: participate (consumes a bid pack) or skip with an optional reason. */
export async function decideParticipation(
  deps: DecideDeps,
  actor: Actor,
  input: { noticeId: string; decision: "participate" | "skip"; reason?: string },
): Promise<Bid> {
  const notice = await deps.notices.findById(input.noticeId);
  if (!notice) throw new NotFoundError("Notice", input.noticeId);
  const existing = await deps.bids.findByNotice(actor.organizationId, notice.id);
  const latest = await deps.analyses.findLatest(actor.organizationId, notice.id);

  if (input.decision === "skip") {
    if (existing) {
      assertTransition(existing.status, "skipped");
      return deps.bids.update(existing.id, { status: "skipped", skipReason: input.reason ?? null });
    }
    return deps.bids.create({
      organizationId: actor.organizationId,
      noticeId: notice.id,
      analysisId: latest?.id ?? null,
      status: "skipped",
      skipReason: input.reason ?? null,
    });
  }

  if (existing) assertTransition(existing.status, "participating");
  await consumeQuota(deps, actor.organizationId, "bidPacks");
  const bid = existing
    ? await deps.bids.update(existing.id, { status: "participating", skipReason: null, packStatus: "idle", packSteps: [], packError: null })
    : await deps.bids.create({ organizationId: actor.organizationId, noticeId: notice.id, analysisId: latest?.id ?? null, status: "participating", skipReason: null });
  await deps.jobs.enqueue("bid.build-pack", { bidId: bid.id }, { singletonKey: bid.id });
  await deps.jobs.enqueue("calendar.sync", { refType: "bid", refId: bid.id, organizationId: actor.organizationId, action: "upsert" });
  return bid;
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

type PackDeps = Pick<
  Deps,
  | "bids"
  | "notices"
  | "noticeFiles"
  | "analyses"
  | "organizations"
  | "documents"
  | "contractItems"
  | "generatedDocs"
  | "files"
  | "storage"
  | "renderer"
  | "ai"
  | "jobs"
  | "clock"
  | "usage"
  | "notifications"
  | "memberships"
  | "mailer"
  | "config"
>;

/**
 * Job: builds the bid pack as resumable steps (checklist → prices → drafts →
 * verify → render → instructions). Completed steps are skipped on retry.
 */
export async function buildBidPack(deps: PackDeps, input: { bidId: string }): Promise<Bid> {
  let bid = await deps.bids.findByIdUnscoped(input.bidId);
  if (!bid) throw new NotFoundError("Bid", input.bidId);
  if (bid.status !== "participating") return bid;
  const notice = await deps.notices.findById(bid.noticeId);
  if (!notice) throw new NotFoundError("Notice", bid.noticeId);
  const org = await loadOrg(deps, bid.organizationId);

  // The pack needs a finished analysis; request one and come back later.
  let analysis = bid.analysisId ? await deps.analyses.findById(bid.analysisId) : await deps.analyses.findLatest(org.id, notice.id);
  if (!analysis || analysis.status === "failed") {
    analysis = await requestAnalysis(deps, org.id, notice.id, { force: analysis?.status === "failed" });
  }
  if (analysis.id !== bid.analysisId) bid = await deps.bids.update(bid.id, { analysisId: analysis.id });
  if (analysis.status !== "done" || !analysis.extraction) {
    await deps.bids.update(bid.id, { packStatus: "building" });
    await deps.jobs.enqueue("bid.build-pack", { bidId: bid.id }, { startAfterSeconds: 30 });
    return bid;
  }
  const extraction = analysis.extraction;
  await deps.bids.update(bid.id, { packStatus: "building", packError: null });

  try {
    for (let step = nextPackStep(bid.packSteps); step; step = nextPackStep(bid.packSteps)) {
      if (step === "checklist") await stepChecklist(deps, bid, org, notice, extraction);
      if (step === "prices") await stepPrices(deps, bid, notice);
      if (step === "drafts") await stepDrafts(deps, bid, org, notice, extraction);
      if (step === "verify") await stepVerify(deps, bid, org, notice, extraction);
      if (step === "render") await stepRender(deps, bid);
      if (step === "instructions") await stepInstructions(deps, bid, org, notice, extraction);
      await deps.bids.completeStep(bid.id, step);
      bid = { ...bid, packSteps: [...bid.packSteps, step] };
    }
  } catch (error) {
    await deps.bids.update(bid.id, { packStatus: "failed", packError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  bid = await deps.bids.update(bid.id, { packStatus: "done" });
  await notifyOrganization(deps, org.id, {
    type: "bid_pack_ready",
    title: "Pacote da licitação pronto para revisão",
    body: `${notice.objeto.slice(0, 160)}\nRevise e aprove cada documento antes de enviar.`,
    link: `/bids/${bid.id}`,
  });
  return bid;
}

async function stepChecklist(deps: PackDeps, bid: Bid, org: Organization, notice: Notice, extraction: NoticeExtraction) {
  const docs = await deps.documents.listByOrg(org.id);
  await deps.bids.saveChecklist(bid.id, computeGaps(extraction.requirements, docs, notice.dataEncerramento));
}

async function stepPrices(deps: PackDeps, bid: Bid, notice: Notice) {
  const items = await deps.notices.listItems(notice.id);
  const refs: Record<number, Awaited<ReturnType<PackDeps["contractItems"]["similar"]>>> = {};
  if (items.length) {
    const embeddings = (await deps.ai.embed(items.map((i) => i.descricao), "query")).map(l2normalize);
    for (const [i, item] of items.entries()) refs[item.numeroItem] = await deps.contractItems.similar(embeddings[i], 5);
  }
  await deps.bids.savePriceReferences(bid.id, refs);
  if (!(await deps.bids.getProposalLines(bid.id)).length) {
    await deps.bids.saveProposalLines(
      bid.id,
      items.map((i) => ({ numeroItem: i.numeroItem, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade ?? 1, unitPriceCents: null })),
    );
  }
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

async function renderProposalMarkdown(deps: Pick<Deps, "bids">, bidId: string, ctx: TemplateContext, ai: Record<string, string>) {
  const { table, totalCents } = proposalTable(await deps.bids.getProposalLines(bidId));
  return renderTemplate(PROPOSAL_TEMPLATE, { ...ctx, items_table: table, total: formatProposalTotal(totalCents) }, ai);
}

async function stepDrafts(deps: PackDeps, bid: Bid, org: Organization, notice: Notice, extraction: NoticeExtraction) {
  const ctx = templateContext(org, notice, deps.clock.now());
  const existing = new Set((await deps.generatedDocs.listByBid(bid.id)).map((d) => d.key));
  for (const spec of draftSpecs(org, extraction)) {
    if (existing.has(spec.key)) continue; // resume after a crash
    const query = (await deps.ai.embed([`${spec.title}. ${spec.guidance}`], "query")).map(l2normalize)[0];
    const excerpts = (await deps.noticeFiles.searchChunks(notice.id, query, 4)).map((c) => c.text);
    const ai = await deps.ai.draft({
      kind: spec.kind,
      title: spec.title,
      slots: listAiSlots(spec.template),
      company: { razaoSocial: org.razaoSocial, porte: org.porte, expertise: org.expertiseText },
      notice: { objeto: notice.objeto, orgaoNome: notice.orgaoNome, numeroEdital: ctx.numeroEdital, modalidade: notice.modalidadeNome },
      excerpts,
      guidance: spec.guidance,
    });
    const markdown = spec.kind === "proposal" ? await renderProposalMarkdown(deps, bid.id, ctx, ai) : renderTemplate(spec.template, ctx, ai);
    await deps.generatedDocs.upsert(bid.id, spec.key, {
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

function requirementTexts(extraction: NoticeExtraction): string[] {
  return [...extraction.declarations.map((d) => `${d.title}: ${d.description}`), ...extraction.annexModels.map((a) => `${a.title}: ${a.description}`)];
}

async function stepVerify(deps: PackDeps, bid: Bid, org: Organization, notice: Notice, extraction: NoticeExtraction) {
  const ctx = templateContext(org, notice, deps.clock.now());
  for (const doc of await deps.generatedDocs.listByBid(bid.id)) {
    if (doc.kind === "instructions") continue;
    const issues = [
      ...verifyGeneratedDocument(doc.markdown, ctx),
      ...(await deps.ai.verifyDocument({ markdown: doc.markdown, requirements: requirementTexts(extraction) })),
    ];
    await deps.generatedDocs.update(doc.id, { verification: issues });
  }
}

async function renderOne(deps: Pick<Deps, "generatedDocs" | "renderer" | "storage" | "files">, organizationId: string, doc: GeneratedDocument) {
  const base = safeFileName(doc.title);
  const [docx, pdf] = await Promise.all([deps.renderer.toDocx(doc.markdown), deps.renderer.toPdf(doc.markdown)]);
  const docxFile = await storeBytes(deps, organizationId, {
    name: `${base}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: docx,
  });
  const pdfFile = await storeBytes(deps, organizationId, { name: `${base}.pdf`, mime: "application/pdf", bytes: pdf });
  for (const old of [doc.docxFileId, doc.pdfFileId]) {
    if (!old) continue;
    const file = await deps.files.findById(old);
    if (file) {
      await deps.storage.delete(file.storageKey).catch(() => undefined);
      await deps.files.delete(file.id);
    }
  }
  await deps.generatedDocs.update(doc.id, { docxFileId: docxFile.id, pdfFileId: pdfFile.id });
}

async function stepRender(deps: PackDeps, bid: Bid) {
  for (const doc of await deps.generatedDocs.listByBid(bid.id)) {
    if (doc.kind === "instructions" || (doc.docxFileId && doc.pdfFileId)) continue;
    await renderOne(deps, bid.organizationId, doc);
  }
}

async function stepInstructions(deps: PackDeps, bid: Bid, org: Organization, notice: Notice, extraction: NoticeExtraction) {
  const checklist = await deps.bids.getChecklist(bid.id);
  const generated = await deps.generatedDocs.listByBid(bid.id);
  const query = (await deps.ai.embed(["envio da proposta e documentos de habilitação no sistema eletrônico, prazos e forma de envio"], "query")).map(l2normalize)[0];
  const excerpts = (await deps.noticeFiles.searchChunks(notice.id, query, 4)).map((c) => c.text);
  const markdown = await deps.ai.submissionInstructions({
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
  await deps.generatedDocs.upsert(bid.id, "instructions", {
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

async function loadBidForActor(deps: Pick<Deps, "bids">, actor: Actor, bidId: string): Promise<Bid> {
  const bid = await deps.bids.findById(actor.organizationId, bidId);
  if (!bid) throw new NotFoundError("Bid", bidId);
  return bid;
}

async function loadDocForActor(deps: Pick<Deps, "bids" | "generatedDocs">, actor: Actor, docId: string) {
  const doc = await deps.generatedDocs.findById(docId);
  if (!doc) throw new NotFoundError("GeneratedDocument", docId);
  const bid = await loadBidForActor(deps, actor, doc.bidId);
  return { doc, bid };
}

/** User sets unit prices; the proposta is re-rendered by code (prices are never auto-filled). */
export async function updateProposalPrices(
  deps: Pick<Deps, "bids" | "generatedDocs" | "notices" | "organizations" | "jobs" | "clock">,
  actor: Actor,
  bidId: string,
  prices: Record<number, number | null>,
): Promise<void> {
  const bid = await loadBidForActor(deps, actor, bidId);
  const lines = await deps.bids.getProposalLines(bid.id);
  const updated: ProposalLine[] = lines.map((l) => {
    const price = prices[l.numeroItem];
    if (price !== undefined && price !== null && (price < 0 || !Number.isFinite(price))) throw new ValidationError("Preço inválido");
    return price === undefined ? l : { ...l, unitPriceCents: price === null ? null : Math.round(price) };
  });
  await deps.bids.saveProposalLines(bid.id, updated);
  const proposal = (await deps.generatedDocs.listByBid(bid.id)).find((d) => d.kind === "proposal");
  if (!proposal) return;
  const notice = (await deps.notices.findById(bid.noticeId))!;
  const org = await loadOrg(deps, bid.organizationId);
  const ctx = templateContext(org, notice, deps.clock.now());
  const markdown = await renderProposalMarkdown(deps, bid.id, ctx, proposal.aiSlots);
  await deps.generatedDocs.update(proposal.id, { markdown, status: "draft", verification: verifyGeneratedDocument(markdown, ctx) });
  await deps.jobs.enqueue("bid.render-doc", { generatedDocumentId: proposal.id });
}

export async function editGeneratedDocument(
  deps: Pick<Deps, "bids" | "generatedDocs" | "notices" | "organizations" | "jobs" | "clock">,
  actor: Actor,
  docId: string,
  markdown: string,
): Promise<void> {
  const { doc, bid } = await loadDocForActor(deps, actor, docId);
  if (!markdown.trim()) throw new ValidationError("Documento vazio");
  const notice = (await deps.notices.findById(bid.noticeId))!;
  const org = await loadOrg(deps, bid.organizationId);
  const verification = doc.kind === "instructions" ? [] : verifyGeneratedDocument(markdown, templateContext(org, notice, deps.clock.now()));
  await deps.generatedDocs.update(doc.id, { markdown, status: doc.kind === "instructions" ? "approved" : "draft", verification });
  if (doc.kind !== "instructions") await deps.jobs.enqueue("bid.render-doc", { generatedDocumentId: doc.id });
}

/** Job: re-render DOCX/PDF of one generated document after edits. */
export async function renderGeneratedDocument(deps: Pick<Deps, "generatedDocs" | "bids" | "renderer" | "storage" | "files">, input: { generatedDocumentId: string }) {
  const doc = await deps.generatedDocs.findById(input.generatedDocumentId);
  if (!doc) throw new NotFoundError("GeneratedDocument", input.generatedDocumentId);
  const bid = await deps.bids.findByIdUnscoped(doc.bidId);
  if (!bid) throw new NotFoundError("Bid", doc.bidId);
  await renderOne(deps, bid.organizationId, doc);
}

export async function approveGeneratedDocument(deps: Pick<Deps, "bids" | "generatedDocs">, actor: Actor, docId: string): Promise<void> {
  const { doc } = await loadDocForActor(deps, actor, docId);
  if (doc.verification.some((v) => v.severity === "error")) {
    throw new DomainError("Corrija os erros de verificação antes de aprovar", "verification_failed");
  }
  await deps.generatedDocs.update(doc.id, { status: "approved" });
}

export async function markBidReady(deps: Pick<Deps, "bids" | "generatedDocs">, actor: Actor, bidId: string): Promise<Bid> {
  const bid = await loadBidForActor(deps, actor, bidId);
  assertTransition(bid.status, "ready");
  const docs = (await deps.generatedDocs.listByBid(bid.id)).filter((d) => d.kind !== "instructions");
  const check = canMarkReady(docs);
  if (!check.ok) throw new DomainError(check.reason!, "not_ready");
  return deps.bids.update(bid.id, { status: "ready" });
}

export async function markBidSubmitted(deps: Pick<Deps, "bids">, actor: Actor, bidId: string): Promise<Bid> {
  const bid = await loadBidForActor(deps, actor, bidId);
  assertTransition(bid.status, "submitted");
  return deps.bids.update(bid.id, { status: "submitted" });
}

export async function cancelBid(deps: Pick<Deps, "bids" | "jobs">, actor: Actor, bidId: string): Promise<Bid> {
  const bid = await loadBidForActor(deps, actor, bidId);
  assertTransition(bid.status, "cancelled");
  const updated = await deps.bids.update(bid.id, { status: "cancelled" });
  await deps.jobs.enqueue("calendar.sync", { refType: "bid", refId: bid.id, organizationId: actor.organizationId, action: "delete" });
  return updated;
}

/** ZIP with every generated DOCX/PDF, the vault documents in the checklist and a README. */
export async function exportBidZip(
  deps: Pick<Deps, "bids" | "generatedDocs" | "documents" | "files" | "storage" | "archiver" | "notices">,
  actor: Actor,
  bidId: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const bid = await loadBidForActor(deps, actor, bidId);
  const notice = await deps.notices.findById(bid.noticeId);
  const entries: { name: string; bytes: Uint8Array }[] = [];
  const addFile = async (fileId: string | null, folder: string) => {
    if (!fileId) return;
    const file = await deps.files.findById(fileId);
    if (!file || file.organizationId !== actor.organizationId) return;
    entries.push({ name: `${folder}/${safeFileName(file.name)}`, bytes: await deps.storage.get(file.storageKey) });
  };
  const generated = await deps.generatedDocs.listByBid(bid.id);
  for (const doc of generated) {
    if (doc.kind === "instructions") {
      entries.push({ name: "00-INSTRUCOES.md", bytes: new TextEncoder().encode(doc.markdown) });
      continue;
    }
    await addFile(doc.docxFileId, "documentos-gerados/docx");
    await addFile(doc.pdfFileId, "documentos-gerados/pdf");
  }
  const checklist = await deps.bids.getChecklist(bid.id);
  for (const gap of checklist) {
    if (!gap.documentId) continue;
    const doc = await deps.documents.findById(actor.organizationId, gap.documentId);
    if (doc) await addFile(doc.fileId, "habilitacao");
  }
  const lines = checklist.map((g) => `- [${g.status === "have" ? "x" : " "}] ${g.description} — ${g.status} (${g.note})`);
  entries.push({ name: "01-CHECKLIST.md", bytes: new TextEncoder().encode(`# Checklist de habilitação\n\n${lines.join("\n")}\n`) });
  const name = `concorra-${safeFileName(notice?.numeroCompra ?? bid.id)}.zip`;
  return { name, bytes: await deps.archiver.zip(entries) };
}
