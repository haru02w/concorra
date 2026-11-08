import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EDITAL_PAGES, makeDoc, makeItem, makeNotice, makeOrg } from "@/domain/fixtures";
import { EMBEDDING_DIMENSIONS, l2normalize } from "@/domain/shared/vector";
import { EMPTY_FILTERS } from "@/domain/rules/rule";
import { createServices } from "@/modules/services";
import { makeTestDeps } from "@/modules/shared/testing/in-memory";
import type { Db } from "./client";
import { createRepositories } from "./repositories";
import { createTestDb } from "./test-db";

let db: Db;
let reset: () => Promise<void>;
let repos: ReturnType<typeof createRepositories>;

/** 768-dim vector with weight on the given axes. */
const vec = (...axes: number[]) => l2normalize(Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (axes.includes(i) ? 1 : 0.001)));

beforeAll(async () => {
  ({ db, reset } = await createTestDb());
  repos = createRepositories(db);
});
afterAll(async () => db?.$disconnect());
beforeEach(async () => reset());

async function seedOrg() {
  const { id: _id, ...data } = makeOrg();
  return repos.organizations.create(data);
}

async function seedNotice(overrides: Parameters<typeof makeNotice>[0] = {}) {
  const { id: _id, filesIngestedAt: _f, ...data } = makeNotice(overrides);
  return (await repos.notices.upsert({ ...data, raw: { source: "test" } })).notice;
}

describe("organizations, users, memberships", () => {
  it("round-trips and scopes memberships", async () => {
    const org = await seedOrg();
    const user = await repos.users.upsert({ workosUserId: "u1", email: "a@b.c", name: "A" });
    const again = await repos.users.upsert({ workosUserId: "u1", email: "new@b.c", name: "A" });
    expect(again.id).toBe(user.id);
    await repos.memberships.upsert(org.id, user.id, "owner");
    expect(await repos.memberships.find(org.id, user.id)).toEqual({ role: "owner" });
    expect((await repos.memberships.listByUser(user.id))[0].organization.cnpj).toBe(org.cnpj);
    expect((await repos.memberships.listByOrg(org.id))[0].user.email).toBe("new@b.c");
    expect(await repos.organizations.findByWorkosOrgId(org.workosOrgId)).toEqual(org);
  });
});

describe("notices", () => {
  it("detects changes by updatedAtPncp and stores items + embeddings", async () => {
    const notice = await seedNotice();
    const { id: _id, filesIngestedAt: _f, ...data } = makeNotice();
    expect((await repos.notices.upsert({ ...data, raw: {} })).changed).toBe(false);
    expect((await repos.notices.upsert({ ...data, objeto: "Novo", updatedAtPncp: new Date("2026-11-05T00:00:00Z"), raw: {} })).changed).toBe(true);
    await repos.notices.replaceItems(notice.id, [makeItem(), makeItem({ numeroItem: 2 })], [vec(1), vec(2)]);
    expect(await repos.notices.listItems(notice.id)).toHaveLength(2);
    expect((await repos.notices.findById(notice.id))?.objeto).toBe("Novo");
  });

  it("computes similarity to the org profile and ranks search", async () => {
    const org = await seedOrg();
    const close = await seedNotice({ numeroControlePNCP: "11111111000111-1-000001/2026", objeto: "Material de limpeza" });
    const far = await seedNotice({ numeroControlePNCP: "11111111000111-1-000002/2026", objeto: "Obras de pavimentação", uf: "SP" });
    await repos.organizations.setProfileEmbedding(org.id, vec(1, 2));
    await repos.notices.setEmbedding(close.id, vec(1, 2));
    await repos.notices.setEmbedding(far.id, vec(500));
    expect(await repos.notices.similarityToOrg(close.id, org.id)).toBeCloseTo(1, 2);
    const ranked = await repos.notices.search({ rankForOrganizationId: org.id, page: 1, pageSize: 10 });
    expect(ranked.rows.map((r) => r.id)).toEqual([close.id, far.id]);
    expect(ranked.total).toBe(2);
    const text = await repos.notices.search({ query: "limpeza", page: 1, pageSize: 10 });
    expect(text.rows.map((r) => r.id)).toEqual([close.id]);
    expect((await repos.notices.search({ uf: "SP", page: 1, pageSize: 10 })).total).toBe(1);
  });

  it("stores pages and searches chunks by vector", async () => {
    const notice = await seedNotice();
    const [file] = await repos.noticeFiles.upsertMany(notice.id, [{ sequencialDocumento: 1, titulo: "Edital", tipo: null, url: "u" }]);
    await repos.noticeFiles.savePages(file.id, ["página um", "página dois\u0000"]);
    await repos.noticeFiles.saveChunks(file.id, [
      { page: 1, text: "habilitação", embedding: vec(3) },
      { page: 2, text: "penalidades", embedding: vec(9) },
    ]);
    expect((await repos.noticeFiles.loadPages(notice.id)).get(file.id)).toEqual(["página um", "página dois"]);
    expect((await repos.noticeFiles.searchChunks(notice.id, vec(9), 1))[0].text).toBe("penalidades");
  });
});

describe("contracts", () => {
  it("upserts and finds similar price references", async () => {
    const item = { numeroControlePNCP: "x", numeroItem: 1, orgaoCnpj: "1", orgaoNome: "Org", descricao: "Detergente", unidade: "UN", quantidade: 10, valorUnitario: 2.5, dataAssinatura: new Date("2026-10-01T00:00:00Z"), uf: "ES" };
    await repos.contractItems.upsertMany([item, { ...item, numeroItem: 2, descricao: "Cimento" }], [vec(1), vec(7)]);
    await repos.contractItems.upsertMany([{ ...item, valorUnitario: 3 }], [vec(1)]);
    const refs = await repos.contractItems.similar(vec(1), 5);
    expect(refs[0]).toEqual(expect.objectContaining({ descricao: "Detergente", valorUnitario: 3 }));
    expect(refs[0].data?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("rules, matches, usage, webhooks, kv", () => {
  it("deduplicates matches per rule and notice", async () => {
    const org = await seedOrg();
    const notice = await seedNotice();
    const rule = await repos.rules.create({ organizationId: org.id, name: "r", filters: EMPTY_FILTERS, semanticThreshold: null, minScore: null, channels: ["email"], frequency: "daily", active: true });
    const data = { ruleId: rule.id, noticeId: notice.id, organizationId: org.id, similarity: null, status: "notify" as const, frequency: "daily" as const, channels: ["email" as const], minScore: null };
    expect(await repos.matches.createIfAbsent(data)).not.toBeNull();
    expect(await repos.matches.createIfAbsent(data)).toBeNull();
    expect(await repos.matches.listForDigest()).toHaveLength(1);
    expect((await repos.matches.listByOrg(org.id, 10))[0].ruleName).toBe("r");
  });

  it("consumes usage atomically up to the limit", async () => {
    const org = await seedOrg();
    const attempts = await Promise.all(Array.from({ length: 8 }, () => repos.usage.tryConsume(org.id, "analyses", "2026-11", 5)));
    expect(attempts.filter(Boolean)).toHaveLength(5);
    expect(await repos.usage.get(org.id, "analyses", "2026-11")).toBe(5);
    expect(await repos.usage.tryConsume(org.id, "bidPacks", "2026-11", 0)).toBe(false);
    await repos.usage.release(org.id, "analyses", "2026-11");
    expect(await repos.usage.get(org.id, "analyses", "2026-11")).toBe(4);
  });

  it("records webhooks once and stores key/values", async () => {
    expect(await repos.webhookEvents.recordOnce("abacatepay", "log_1", { a: 1 })).toBeTruthy();
    expect(await repos.webhookEvents.recordOnce("abacatepay", "log_1", { a: 1 })).toBeNull();
    await repos.kv.set("k", "1");
    await repos.kv.set("k", "2");
    expect(await repos.kv.get("k")).toBe("2");
  });
});

describe("bids and documents", () => {
  it("persists pack steps idempotently and JSON fields", async () => {
    const org = await seedOrg();
    const notice = await seedNotice();
    const bid = await repos.bids.create({ organizationId: org.id, noticeId: notice.id, analysisId: null, status: "participating", skipReason: null });
    await repos.bids.completeStep(bid.id, "checklist");
    await repos.bids.completeStep(bid.id, "checklist");
    expect((await repos.bids.findById(org.id, bid.id))?.packSteps).toEqual(["checklist"]);
    expect(await repos.bids.findById("other", bid.id)).toBeNull();
    await repos.bids.saveProposalLines(bid.id, [{ numeroItem: 1, descricao: "x", unidade: null, quantidade: 1, unitPriceCents: null }]);
    expect(await repos.bids.getProposalLines(bid.id)).toHaveLength(1);
    const doc = await repos.generatedDocs.upsert(bid.id, "proposal", { kind: "proposal", title: "P", markdown: "m", aiSlots: { a: "b" }, status: "draft", verification: [], docxFileId: null, pdfFileId: null });
    const again = await repos.generatedDocs.upsert(bid.id, "proposal", { kind: "proposal", title: "P2", markdown: "m", aiSlots: {}, status: "draft", verification: [], docxFileId: null, pdfFileId: null });
    expect(again.id).toBe(doc.id);
    expect((await repos.bids.listByOrg(org.id))[0].notice.id).toBe(notice.id);
  });

  it("lists expiring documents not yet notified", async () => {
    const org = await seedOrg();
    const file = await repos.files.create({ organizationId: org.id, storageKey: "k1", name: "cnd.pdf", mime: "application/pdf", size: 1, sha256: "x" });
    const { id: _id, fileName: _n, ...doc } = makeDoc({ organizationId: org.id, fileId: file.id, validUntil: new Date("2026-11-10T00:00:00Z") });
    const created = await repos.documents.create(doc);
    expect(created.fileName).toBe("cnd.pdf");
    expect(await repos.documents.listExpiringUnnotified(new Date("2026-11-20T00:00:00Z"))).toHaveLength(1);
    await repos.documents.update(created.id, { expiryNotifiedAt: new Date() });
    expect(await repos.documents.listExpiringUnnotified(new Date("2026-11-20T00:00:00Z"))).toHaveLength(0);
  });
});

describe("use cases on Postgres", () => {
  it("match → analysis → participate → bid pack", async () => {
    const fakes = makeTestDeps();
    fakes.ai.dims = EMBEDDING_DIMENSIONS;
    const services = createServices({ ...fakes, ...repos });
    const org = await seedOrg();
    const user = await repos.users.upsert({ workosUserId: "u1", email: "owner@x.y", name: null });
    await repos.memberships.upsert(org.id, user.id, "owner");
    const notice = await seedNotice();
    await repos.notices.replaceItems(notice.id, [makeItem()], null);
    const [file] = await repos.noticeFiles.upsertMany(notice.id, [{ sequencialDocumento: 1, titulo: "Edital", tipo: null, url: "u" }]);
    await repos.noticeFiles.savePages(file.id, EDITAL_PAGES.get("file-edital")!);
    await repos.notices.markFilesIngested(notice.id, new Date("2026-11-08T00:00:00Z"));
    // fixture citations point at "file-edital": retarget them to the stored file id
    const extraction = JSON.parse(JSON.stringify(fakes.ai.extraction).replaceAll("file-edital", file.id));
    fakes.ai.extraction = extraction;
    await repos.rules.create({ organizationId: org.id, name: "Limpeza", filters: { ...EMPTY_FILTERS, keywordsInclude: ["limpeza"] }, semanticThreshold: null, minScore: null, channels: ["email"], frequency: "immediate", active: true });

    await services.rules.matchNotice({ noticeId: notice.id });
    const [{ analysisId }] = fakes.jobs.of("analysis.run");
    const analysis = await services.analysis.runAnalysis({ analysisId });
    expect(analysis.status).toBe("done");
    expect(analysis.citationReport?.failedPaths).toEqual([]);

    const actor = { userId: user.id, workosUserId: "u1", email: user.email, organizationId: org.id, role: "owner" as const };
    const bid = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" });
    const built = await services.bids.buildBidPack({ bidId: bid.id });
    expect(built.packStatus).toBe("done");
    expect((await repos.generatedDocs.listByBid(bid.id)).length).toBeGreaterThanOrEqual(4);
    expect(await repos.usage.get(org.id, "bidPacks", "2026-11")).toBe(1);
  });
});
