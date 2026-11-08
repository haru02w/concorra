import { describe, expect, it } from "vitest";
import { analyzed, memberOf, setup } from "@/modules/shared/testing/setup";

describe("participation", () => {
  it("free plan cannot build bid packs", async () => {
    const { services, actor, notice } = await analyzed("free");
    await expect(services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" })).rejects.toThrow(/limit/);
  });

  it("skip records the reason and can be reversed", async () => {
    const { services, actor, notice } = await analyzed();
    const skipped = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "skip", reason: "Fora da região" });
    expect(skipped).toEqual(expect.objectContaining({ status: "skipped", skipReason: "Fora da região" }));
    const bid = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" });
    expect(bid.id).toBe(skipped.id);
    expect(bid.status).toBe("participating");
  });
});

describe("bid pack", () => {
  it("builds checklist, prices, drafts, verification, files and instructions", async () => {
    const { services, deps, actor, notice } = await analyzed();
    await deps.contractItems.upsertMany(
      [{ numeroControlePNCP: "c1", numeroItem: 1, orgaoCnpj: "1", orgaoNome: "Prefeitura Y", descricao: "Detergente neutro 500ml", unidade: "UN", quantidade: 100, valorUnitario: 2.2, dataAssinatura: null, uf: "ES" }],
      [(await deps.ai.embed(["Detergente neutro 500ml"], "document"))[0]],
    );
    const bid = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" });
    expect(deps.jobs.of("bid.build-pack")).toEqual([{ bidId: bid.id }]);
    expect(deps.jobs.of("calendar.sync")).toHaveLength(1);

    const built = await services.bids.buildBidPack({ bidId: bid.id });
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
    await services.bids.buildBidPack({ bidId: bid.id });
    expect(deps.ai.calls.draft.length).toBe(draftsBefore);
  });

  it("waits for the analysis when there is none yet", async () => {
    const { services, deps, actor, notice } = await setup();
    await deps.notices.markFilesIngested(notice.id, new Date("2026-11-08T00:00:00Z"));
    const bid = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" });
    deps.jobs.clear();
    await services.bids.buildBidPack({ bidId: bid.id });
    expect(deps.jobs.of("analysis.run")).toHaveLength(1);
    expect(deps.jobs.queued.find((j) => j.name === "bid.build-pack")?.options).toEqual({ startAfterSeconds: 30 });
  });

  it("prices, edits, approval, ready, submitted, export and cancel", async () => {
    const { services, deps, actor, notice } = await analyzed();
    const bid = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" });
    await services.bids.buildBidPack({ bidId: bid.id });

    await expect(services.bids.markBidReady(actor, bid.id)).rejects.toThrow(/não aprovados/);
    await expect(services.bids.updateProposalPrices(actor, bid.id, { 1: -5 })).rejects.toThrow(/Preço/);
    await services.bids.updateProposalPrices(actor, bid.id, { 1: 250, 2: 1000 });
    const proposal = (await deps.generatedDocs.listByBid(bid.id)).find((d) => d.kind === "proposal")!;
    expect(proposal.markdown).toMatch(/R\$\s2\.500,00/); // 1000 × R$2,50
    expect(proposal.markdown).toMatch(/global da proposta:\*\* R\$\s3\.000,00/); // total
    expect(proposal.markdown).not.toContain("A PREENCHER");
    expect(deps.jobs.of("bid.render-doc")).toEqual([{ generatedDocumentId: proposal.id }]);
    await services.bids.renderGeneratedDocument({ generatedDocumentId: proposal.id });

    const declaration = (await deps.generatedDocs.listByBid(bid.id)).find((d) => d.kind === "declaration")!;
    await services.bids.editGeneratedDocument(actor, declaration.id, declaration.markdown.replace("11.222.333/0001-81", "00.000.000/0000-00"));
    await expect(services.bids.approveGeneratedDocument(actor, declaration.id)).rejects.toThrow(/erros/);
    await services.bids.editGeneratedDocument(actor, declaration.id, declaration.markdown + "\nObservação.");

    for (const doc of await deps.generatedDocs.listByBid(bid.id)) {
      if (doc.kind !== "instructions") await services.bids.approveGeneratedDocument(memberOf(actor), doc.id);
    }
    expect((await services.bids.markBidReady(actor, bid.id)).status).toBe("ready");
    expect((await services.bids.markBidSubmitted(actor, bid.id)).status).toBe("submitted");

    const zip = await services.bids.exportBidZip(actor, bid.id);
    expect(zip.name).toMatch(/^concorra-.*\.zip$/);
    const names = deps.archiver.last.map((f) => f.name);
    expect(names).toContain("00-INSTRUCOES.md");
    expect(names).toContain("01-CHECKLIST.md");
    expect(names.some((n) => n.startsWith("documentos-gerados/pdf/"))).toBe(true);
    expect(names.some((n) => n.startsWith("habilitacao/"))).toBe(false); // vault doc has no stored file in this fixture

    await services.bids.cancelBid(actor, bid.id);
    expect(deps.jobs.of("calendar.sync").at(-1)).toEqual(expect.objectContaining({ action: "delete" }));
  });

  it("scopes bids by organization", async () => {
    const { services, actor, notice } = await analyzed();
    const bid = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" });
    await expect(services.bids.markBidReady({ ...actor, organizationId: "other" }, bid.id)).rejects.toThrow(/not found/);
  });
});
