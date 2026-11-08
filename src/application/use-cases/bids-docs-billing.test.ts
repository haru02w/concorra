import { describe, expect, it } from "vitest";
import { EDITAL_PAGES, makeDoc, makeItem } from "@/domain/fixtures";
import { setup } from "../testing/setup";
import { requestAnalysis, runAnalysis } from "./analysis";
import {
  approveGeneratedDocument,
  buildBidPack,
  cancelBid,
  decideParticipation,
  editGeneratedDocument,
  exportBidZip,
  markBidReady,
  markBidSubmitted,
  renderGeneratedDocument,
  updateProposalPrices,
} from "./bids";
import { deleteDocument, expiryWatch, fileDownloadUrl, uploadDocument, validateUploadedDocument } from "./documents";
import { completeCalendarConnect, startCalendarConnect, syncCalendar } from "./calendar";
import { cancelSubscription, getUsageSummary, processPaymentEvent, receivePaymentWebhook, startCheckout } from "./billing";
import { memberOf } from "../testing/setup";

async function analyzed(plan: "free" | "pro" = "pro") {
  const ctx = await setup({ plan });
  const { deps, notice, actor } = ctx;
  const [file] = await deps.noticeFiles.upsertMany(notice.id, [{ sequencialDocumento: 1, titulo: "Edital", tipo: null, url: "u" }]);
  deps.noticeFiles.rows.delete(file.id);
  deps.noticeFiles.rows.set("file-edital", { ...file, id: "file-edital" });
  await deps.noticeFiles.savePages("file-edital", EDITAL_PAGES.get("file-edital")!);
  await deps.noticeFiles.saveChunks("file-edital", [{ page: 4, text: "Declaração de que não emprega menor", embedding: [] }]);
  await deps.notices.markFilesIngested(notice.id, new Date("2026-11-08T00:00:00Z"));
  await deps.notices.replaceItems(notice.id, [makeItem(), makeItem({ numeroItem: 2, descricao: "Sabão em barra", quantidade: 50 })], null);
  await deps.documents.create({ ...makeDoc(), organizationId: actor.organizationId });
  const analysis = await requestAnalysis(deps, actor.organizationId, notice.id);
  await runAnalysis(deps, { analysisId: analysis.id });
  deps.jobs.clear();
  return ctx;
}

describe("participation", () => {
  it("free plan cannot build bid packs", async () => {
    const { deps, actor, notice } = await analyzed("free");
    await expect(decideParticipation(deps, actor, { noticeId: notice.id, decision: "participate" })).rejects.toThrow(/limit/);
  });

  it("skip records the reason and can be reversed", async () => {
    const { deps, actor, notice } = await analyzed();
    const skipped = await decideParticipation(deps, actor, { noticeId: notice.id, decision: "skip", reason: "Fora da região" });
    expect(skipped).toEqual(expect.objectContaining({ status: "skipped", skipReason: "Fora da região" }));
    const bid = await decideParticipation(deps, actor, { noticeId: notice.id, decision: "participate" });
    expect(bid.id).toBe(skipped.id);
    expect(bid.status).toBe("participating");
  });
});

describe("bid pack", () => {
  it("builds checklist, prices, drafts, verification, files and instructions", async () => {
    const { deps, actor, notice } = await analyzed();
    await deps.contractItems.upsertMany(
      [{ numeroControlePNCP: "c1", numeroItem: 1, orgaoCnpj: "1", orgaoNome: "Prefeitura Y", descricao: "Detergente neutro 500ml", unidade: "UN", quantidade: 100, valorUnitario: 2.2, dataAssinatura: null, uf: "ES" }],
      [(await deps.ai.embed(["Detergente neutro 500ml"], "document"))[0]],
    );
    const bid = await decideParticipation(deps, actor, { noticeId: notice.id, decision: "participate" });
    expect(deps.jobs.of("bid.build-pack")).toEqual([{ bidId: bid.id }]);
    expect(deps.jobs.of("calendar.sync")).toHaveLength(1);

    const built = await buildBidPack(deps, { bidId: bid.id });
    expect(built.packStatus).toBe("done");
    expect((await deps.bids.findById(actor.organizationId, bid.id))?.packSteps).toHaveLength(6);

    const checklist = await deps.bids.getChecklist(bid.id);
    expect(checklist.map((g) => g.status)).toEqual(["have", "missing", "manual"]);
    const refs = await deps.bids.getPriceReferences(bid.id);
    expect(refs[1][0].orgaoNome).toBe("Prefeitura Y");
    const lines = await deps.bids.getProposalLines(bid.id);
    expect(lines.every((l) => l.unitPriceCents === null)).toBe(true); // never auto-filled

    const docs = await deps.generatedDocs.listByBid(bid.id);
    expect(docs.map((d) => d.key).sort()).toEqual(["cover_letter", "declaration:d1", "instructions", "proposal"]);
    const proposal = docs.find((d) => d.kind === "proposal")!;
    expect(proposal.markdown).toContain("11.222.333/0001-81");
    expect(proposal.markdown).toContain("A PREENCHER");
    expect(proposal.verification.some((v) => v.severity === "warning")).toBe(true);
    expect(docs.filter((d) => d.kind !== "instructions").every((d) => d.docxFileId && d.pdfFileId)).toBe(true);
    expect(deps.notifications.rows.some((n) => n.type === "bid_pack_ready")).toBe(true);

    // retry is a no-op
    const draftsBefore = deps.ai.calls.draft.length;
    await deps.bids.update(bid.id, { packStatus: "idle" });
    await buildBidPack(deps, { bidId: bid.id });
    expect(deps.ai.calls.draft.length).toBe(draftsBefore);
  });

  it("waits for the analysis when there is none yet", async () => {
    const { deps, actor, notice } = await setup();
    await deps.notices.markFilesIngested(notice.id, new Date("2026-11-08T00:00:00Z"));
    const bid = await decideParticipation(deps, actor, { noticeId: notice.id, decision: "participate" });
    deps.jobs.clear();
    await buildBidPack(deps, { bidId: bid.id });
    expect(deps.jobs.of("analysis.run")).toHaveLength(1);
    expect(deps.jobs.queued.find((j) => j.name === "bid.build-pack")?.options).toEqual({ startAfterSeconds: 30 });
  });

  it("prices, edits, approval, ready, submitted, export and cancel", async () => {
    const { deps, actor, notice } = await analyzed();
    const bid = await decideParticipation(deps, actor, { noticeId: notice.id, decision: "participate" });
    await buildBidPack(deps, { bidId: bid.id });

    await expect(markBidReady(deps, actor, bid.id)).rejects.toThrow(/não aprovados/);
    await expect(updateProposalPrices(deps, actor, bid.id, { 1: -5 })).rejects.toThrow(/Preço/);
    await updateProposalPrices(deps, actor, bid.id, { 1: 250, 2: 1000 });
    const proposal = (await deps.generatedDocs.listByBid(bid.id)).find((d) => d.kind === "proposal")!;
    expect(proposal.markdown).toMatch(/R\$\s2\.500,00/); // 1000 × R$2,50
    expect(proposal.markdown).toMatch(/global da proposta:\*\* R\$\s3\.000,00/); // total
    expect(proposal.markdown).not.toContain("A PREENCHER");
    expect(deps.jobs.of("bid.render-doc")).toEqual([{ generatedDocumentId: proposal.id }]);
    await renderGeneratedDocument(deps, { generatedDocumentId: proposal.id });

    const declaration = (await deps.generatedDocs.listByBid(bid.id)).find((d) => d.kind === "declaration")!;
    await editGeneratedDocument(deps, actor, declaration.id, declaration.markdown.replace("11.222.333/0001-81", "00.000.000/0000-00"));
    await expect(approveGeneratedDocument(deps, actor, declaration.id)).rejects.toThrow(/erros/);
    await editGeneratedDocument(deps, actor, declaration.id, declaration.markdown + "\nObservação.");

    for (const doc of await deps.generatedDocs.listByBid(bid.id)) {
      if (doc.kind !== "instructions") await approveGeneratedDocument(deps, memberOf(actor), doc.id);
    }
    expect((await markBidReady(deps, actor, bid.id)).status).toBe("ready");
    expect((await markBidSubmitted(deps, actor, bid.id)).status).toBe("submitted");

    const zip = await exportBidZip(deps, actor, bid.id);
    expect(zip.name).toMatch(/^concorra-.*\.zip$/);
    const names = deps.archiver.last.map((f) => f.name);
    expect(names).toContain("00-INSTRUCOES.md");
    expect(names).toContain("01-CHECKLIST.md");
    expect(names.some((n) => n.startsWith("documentos-gerados/pdf/"))).toBe(true);
    expect(names.some((n) => n.startsWith("habilitacao/"))).toBe(false); // vault doc has no stored file in this fixture

    await cancelBid(deps, actor, bid.id);
    expect(deps.jobs.of("calendar.sync").at(-1)).toEqual(expect.objectContaining({ action: "delete" }));
  });

  it("scopes bids by organization", async () => {
    const { deps, actor, notice } = await analyzed();
    const bid = await decideParticipation(deps, actor, { noticeId: notice.id, decision: "participate" });
    await expect(markBidReady(deps, { ...actor, organizationId: "other" }, bid.id)).rejects.toThrow(/not found/);
  });
});

describe("document vault", () => {
  const pdf = { name: "cnd.pdf", mime: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) };

  it("uploads, validates with AI + deterministic checks and schedules reminders", async () => {
    const { deps, actor } = await setup();
    const doc = await uploadDocument(deps, actor, { kind: "cnd_federal", upload: pdf });
    expect(doc.status).toBe("pending");
    const validated = await validateUploadedDocument(deps, deps.jobs.of("docs.validate-upload")[0]);
    expect(validated.status).toBe("valid");
    expect(validated.checks.every((c) => c.ok)).toBe(true);
    expect(deps.jobs.of("calendar.sync")).toEqual([expect.objectContaining({ refType: "document", refId: doc.id })]);
    expect(await fileDownloadUrl(deps, actor, doc.fileId)).toMatch(/^https:\/\/storage.test/);
    await expect(fileDownloadUrl(deps, { ...actor, organizationId: "x" }, doc.fileId)).rejects.toThrow();
    await deleteDocument(deps, actor, doc.id);
    expect(deps.storage.objects.size).toBe(0);
  });

  it("flags documents of another company", async () => {
    const { deps, actor } = await setup();
    deps.ai.documentExtraction = { ...deps.ai.documentExtraction, cnpj: "99.999.999/0001-91" };
    const doc = await uploadDocument(deps, actor, { kind: "cnd_federal", upload: pdf });
    expect((await validateUploadedDocument(deps, { documentId: doc.id })).status).toBe("invalid");
  });

  it("warns once about expiring documents", async () => {
    const { deps, actor } = await setup();
    await deps.documents.create({ ...makeDoc({ validUntil: new Date("2026-11-15T00:00:00Z") }), organizationId: actor.organizationId });
    expect(await expiryWatch(deps)).toBe(1);
    expect(deps.mailer.sent[0].subject).toMatch(/vencendo/);
    expect(await expiryWatch(deps)).toBe(0);
  });
});

describe("calendar", () => {
  it("connects via OAuth state and syncs bid deadlines idempotently", async () => {
    const { deps, actor, notice } = await analyzed();
    const url = startCalendarConnect(deps, actor, "google");
    const state = decodeURIComponent(new URL(url).searchParams.get("state")!);
    await expect(completeCalendarConnect(deps, { ...actor, userId: "other" }, { provider: "google", code: "c", state })).rejects.toThrow(/state/);
    await completeCalendarConnect(deps, actor, { provider: "google", code: "c", state });
    const bid = await decideParticipation(deps, actor, { noticeId: notice.id, decision: "participate" });
    const input = { refType: "bid" as const, refId: bid.id, organizationId: actor.organizationId, action: "upsert" as const };
    expect(await syncCalendar(deps, input)).toEqual({ upserted: 4, deleted: 0 });
    expect(await syncCalendar(deps, input)).toEqual({ upserted: 4, deleted: 0 });
    expect(deps.calendars.events.size).toBe(4);
    expect(deps.calendarProviders.google.events.size).toBe(4);
    expect(await syncCalendar(deps, { ...input, action: "delete" })).toEqual({ upserted: 0, deleted: 4 });
    expect(deps.calendarProviders.google.events.size).toBe(0);
  });

  it("refreshes expired tokens", async () => {
    const { deps, actor, notice } = await analyzed();
    await deps.calendars.upsertConnection({ userId: actor.userId, organizationId: actor.organizationId, provider: "microsoft", accessToken: deps.cipher.encrypt("old"), refreshToken: deps.cipher.encrypt("r"), expiresAt: new Date("2026-11-08T11:00:00Z"), calendarId: "primary", email: null });
    const bid = await decideParticipation(deps, actor, { noticeId: notice.id, decision: "participate" });
    await syncCalendar(deps, { refType: "bid", refId: bid.id, organizationId: actor.organizationId, action: "upsert" });
    expect(deps.calendarProviders.microsoft.refreshed).toBe(1);
    const [conn] = await deps.calendars.listByOrg(actor.organizationId);
    expect(deps.cipher.decrypt(conn.accessToken)).toBe("access-2");
  });
});

describe("billing", () => {
  it("checkout → webhook (verified, idempotent) → plan upgrade → cancel", async () => {
    const { deps, actor } = await setup({ plan: "free" });
    await deps.subscriptions.upsert({ organizationId: actor.organizationId, planId: "free", pendingPlanId: null, status: "active", customerRef: null, checkoutRef: null, subscriptionRef: null, currentPeriodEnd: null });
    await expect(startCheckout(deps, memberOf(actor), "pro")).rejects.toThrow(/owners/);
    expect(await startCheckout(deps, actor, "pro")).toBe("https://pay.test/bill_1");
    expect((await deps.subscriptions.findByOrg(actor.organizationId))?.pendingPlanId).toBe("pro");

    const body = JSON.stringify({ id: "log_1", event: "subscription.completed", data: { checkoutRef: "bill_1", subscriptionRef: "subs_1" } });
    expect(await receivePaymentWebhook(deps, { rawBody: body, secret: "bad", signature: null })).toBe("rejected");
    expect(await receivePaymentWebhook(deps, { rawBody: body, secret: "whsec", signature: null })).toBe("accepted");
    expect(await receivePaymentWebhook(deps, { rawBody: body, secret: "whsec", signature: null })).toBe("duplicate");

    expect(await processPaymentEvent(deps, deps.jobs.of("billing.webhook")[0])).toBe("subscription.activated");
    expect((await deps.organizations.findById(actor.organizationId))?.planId).toBe("pro");
    const usage = await getUsageSummary(deps, actor.organizationId);
    expect(usage.plan.id).toBe("pro");
    expect(usage.subscription?.subscriptionRef).toBe("subs_1");

    await cancelSubscription(deps, actor);
    expect(deps.payments.cancelled).toEqual(["subs_1"]);
    expect((await deps.organizations.findById(actor.organizationId))?.planId).toBe("free");
  });

  it("downgrades on cancellation webhook", async () => {
    const { deps, actor } = await setup({ plan: "pro" });
    await deps.subscriptions.upsert({ organizationId: actor.organizationId, planId: "pro", pendingPlanId: null, status: "active", customerRef: "c", checkoutRef: null, subscriptionRef: "subs_9", currentPeriodEnd: null });
    const body = JSON.stringify({ id: "log_9", event: "subscription.cancelled", data: { subscriptionRef: "subs_9" } });
    await receivePaymentWebhook(deps, { rawBody: body, secret: "whsec", signature: null });
    await processPaymentEvent(deps, deps.jobs.of("billing.webhook")[0]);
    expect((await deps.organizations.findById(actor.organizationId))?.planId).toBe("free");
  });
});
