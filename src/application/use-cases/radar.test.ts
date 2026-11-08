import { describe, expect, it } from "vitest";
import { makeItem, makeNotice } from "@/domain/fixtures";
import type { NoticeUpsert } from "../ports";
import { setup } from "../testing/setup";
import { ingestNoticeFiles, openNotice, syncContracts, syncOpenNotices, syncUpdatedNotices } from "./radar";

function upsert(overrides: Parameters<typeof makeNotice>[0] = {}): NoticeUpsert {
  const { id: _id, filesIngestedAt: _f, ...data } = makeNotice(overrides);
  return { ...data, raw: {} };
}

describe("syncOpenNotices", () => {
  it("upserts, embeds, matches and advances the round-robin cursor", async () => {
    const { deps } = await setup({ notice: false });
    deps.pncp.items = [makeItem()];
    deps.pncp.open = [[upsert({ numeroControlePNCP: "11111111000111-1-000001/2026" })], [upsert({ numeroControlePNCP: "11111111000111-1-000002/2026" })]];
    const first = await syncOpenNotices(deps, { pagesPerRun: 1 });
    expect(first).toEqual({ processed: 1, changed: 1, nextPage: 2 });
    const second = await syncOpenNotices(deps, { pagesPerRun: 5 });
    expect(second.nextPage).toBe(1);
    expect(deps.notices.rows.size).toBe(2);
    expect(deps.jobs.of("rules.match")).toHaveLength(2);
    const notice = [...deps.notices.rows.values()][0];
    expect(await deps.notices.listItems(notice.id)).toHaveLength(1);
    expect(deps.notices.embeddings.get(notice.id)).toBeDefined();
  });

  it("skips unchanged notices", async () => {
    const { deps } = await setup({ notice: false });
    deps.pncp.open = [[upsert()]];
    await syncOpenNotices(deps);
    deps.jobs.clear();
    const again = await syncOpenNotices(deps);
    expect(again.changed).toBe(0);
    expect(deps.jobs.of("rules.match")).toHaveLength(0);
  });
});

describe("syncUpdatedNotices", () => {
  it("keeps tracked or still-open notices only and moves the cursor", async () => {
    const { deps, notice } = await setup();
    deps.pncp.updated = {
      6: [
        upsert({ numeroControlePNCP: notice.numeroControlePNCP, updatedAtPncp: new Date("2026-11-07T10:00:00Z"), objeto: "Retificado" }),
        upsert({ numeroControlePNCP: "22222222000122-1-000009/2026", dataEncerramento: new Date("2026-01-01T00:00:00Z") }),
        upsert({ numeroControlePNCP: "33333333000133-1-000009/2026", dataEncerramento: new Date("2026-12-01T00:00:00Z") }),
      ],
    };
    const result = await syncUpdatedNotices(deps);
    expect(result.changed).toBe(2);
    expect((await deps.notices.findById(notice.id))?.objeto).toBe("Retificado");
    expect(await deps.notices.findByControle("22222222000122-1-000009/2026")).toBeNull();
    expect(await deps.kv.get("pncp.updates.since")).toBe("20261108");
  });
});

describe("syncContracts", () => {
  it("stores embedded contract items", async () => {
    const { deps } = await setup({ notice: false });
    deps.pncp.contracts = [[{ numeroControlePNCP: "x", numeroItem: 1, orgaoCnpj: "1", orgaoNome: "Org", descricao: "Detergente neutro", unidade: "UN", quantidade: 10, valorUnitario: 2.1, dataAssinatura: null, uf: "ES" }]];
    expect(await syncContracts(deps)).toEqual({ stored: 1 });
    expect(deps.contractItems.rows[0].embedding).toHaveLength(32);
  });
});

describe("ingestNoticeFiles", () => {
  it("downloads PDFs, stores pages and chunks, then continues the analysis", async () => {
    const { deps, notice } = await setup();
    deps.pncp.files = [
      { sequencialDocumento: 1, titulo: "Edital", tipo: "Edital", url: "https://pncp/1" },
      { sequencialDocumento: 2, titulo: "Anexos", tipo: "Outros", url: "https://pncp/2" },
    ];
    deps.pncp.downloads.set("https://pncp/2", { bytes: new Uint8Array([0x50, 0x4b]), contentType: "application/zip", fileName: "anexos.zip" });
    const analysis = await deps.analyses.create({ organizationId: "org", noticeId: notice.id, status: "ingesting", noticeVersion: null });
    const result = await ingestNoticeFiles(deps, { noticeId: notice.id, analysisId: analysis.id });
    expect(result.files).toBe(1);
    const pages = await deps.noticeFiles.loadPages(notice.id);
    expect([...pages.values()][0]).toHaveLength(2);
    expect([...deps.noticeFiles.chunks.values()][0].length).toBeGreaterThan(0);
    expect((await deps.notices.findById(notice.id))?.filesIngestedAt).not.toBeNull();
    expect(deps.jobs.of("analysis.run")).toEqual([{ analysisId: analysis.id }]);
    expect(deps.storage.objects.has(`notices/${notice.id}/1.pdf`)).toBe(true);
  });

  it("falls back to OCR for scanned PDFs and skips work when fresh", async () => {
    const { deps, notice } = await setup();
    deps.pncp.files = [{ sequencialDocumento: 1, titulo: "Edital", tipo: null, url: "https://pncp/1" }];
    deps.pdfText.pages = ["", " "];
    await ingestNoticeFiles(deps, { noticeId: notice.id });
    expect(deps.ai.calls.ocr).toHaveLength(1);
    expect([...deps.noticeFiles.rows.values()][0].ocr).toBe(true);
    const again = await ingestNoticeFiles(deps, { noticeId: notice.id });
    expect(again.files).toBe(0);
  });
});

describe("demo masking", () => {
  it("masks CPFs and agent names in edital pages when demo mode is on", async () => {
    const { deps, notice } = await setup();
    deps.config.demoMode = true;
    deps.pncp.files = [{ sequencialDocumento: 1, titulo: "Edital", tipo: null, url: "https://pncp/1" }];
    deps.pdfText.pages = ["Pregoeira: Ana Maria Souza, CPF 123.456.789-09, conduzirá a sessão pública do pregão."];
    await ingestNoticeFiles(deps, { noticeId: notice.id });
    const [page] = [...(await deps.noticeFiles.loadPages(notice.id)).values()][0];
    expect(page).toContain("[nome omitido]");
    expect(page).not.toContain("Ana Maria");
    expect(page).not.toContain("123.456.789-09");
  });
});

describe("openNotice", () => {
  it("queues lazy ingestion on first open", async () => {
    const { deps, actor, notice } = await setup();
    const view = await openNotice(deps, actor, notice.id);
    expect(view.notice.id).toBe(notice.id);
    expect(deps.jobs.of("notice.ingest-files")).toEqual([{ noticeId: notice.id }]);
  });
});
