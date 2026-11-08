import { describe, expect, it } from "vitest";
import { EDITAL_PAGES, makeDoc } from "@/domain/fixtures";
import { EMPTY_FILTERS } from "@/domain/rules/rule";
import { fakeEmbedding } from "../testing/in-memory";
import { setup } from "../testing/setup";
import { requestAnalysis, runAnalysis } from "./analysis";
import { sendDigest, sendMatchNotifications } from "./notifications";
import { createRule, deleteRule, matchNotice, updateRule, type RuleInput } from "./rules";

const ruleInput = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  name: "Limpeza",
  filters: { ...EMPTY_FILTERS, keywordsInclude: ["material de limpeza"] },
  semanticThreshold: null,
  minScore: null,
  channels: ["email", "inapp"],
  frequency: "immediate",
  active: true,
  ...overrides,
});

/** Gives the notice edital pages the fixture extraction can cite. */
async function withEdital(deps: Awaited<ReturnType<typeof setup>>["deps"], noticeId: string) {
  const [file] = await deps.noticeFiles.upsertMany(noticeId, [{ sequencialDocumento: 1, titulo: "Edital", tipo: null, url: "u" }]);
  deps.noticeFiles.rows.set("file-edital", { ...file, id: "file-edital" });
  deps.noticeFiles.rows.delete(file.id);
  await deps.noticeFiles.savePages("file-edital", EDITAL_PAGES.get("file-edital")!);
  await deps.notices.markFilesIngested(noticeId, new Date("2026-11-08T00:00:00Z"));
}

describe("rules CRUD", () => {
  it("enforces active rule limits", async () => {
    const { deps, actor } = await setup({ plan: "free" });
    await createRule(deps, actor, ruleInput());
    const second = await createRule(deps, actor, ruleInput());
    await expect(createRule(deps, actor, ruleInput())).rejects.toThrow(/limit/);
    const inactive = await createRule(deps, actor, ruleInput({ active: false }));
    await expect(updateRule(deps, actor, inactive.id, ruleInput())).rejects.toThrow(/limit/);
    await deleteRule(deps, actor, second.id);
    await updateRule(deps, actor, inactive.id, ruleInput());
    expect(await deps.rules.countActive(actor.organizationId)).toBe(2);
  });
});

describe("matchNotice", () => {
  it("creates matches, queues immediate notifications and auto analysis", async () => {
    const { deps, actor, notice } = await setup();
    await createRule(deps, actor, ruleInput());
    const result = await matchNotice(deps, { noticeId: notice.id });
    expect(result.matched).toBe(1);
    expect(deps.jobs.of("notify.send")[0].matchIds).toHaveLength(1);
    expect(deps.jobs.of("notice.ingest-files")).toEqual([expect.objectContaining({ noticeId: notice.id })]);
    // idempotent
    deps.jobs.clear();
    expect((await matchNotice(deps, { noticeId: notice.id })).matched).toBe(0);
  });

  it("uses profile similarity for semantic rules", async () => {
    const { deps, actor, notice } = await setup();
    await deps.organizations.setProfileEmbedding(actor.organizationId, fakeEmbedding("material de limpeza escolas"));
    await deps.notices.setEmbedding(notice.id, fakeEmbedding("material de limpeza escolas municipais"));
    await createRule(deps, actor, ruleInput({ filters: EMPTY_FILTERS, semanticThreshold: 0.5 }));
    expect((await matchNotice(deps, { noticeId: notice.id })).matched).toBe(1);
  });

  it("notifies without score when out of analysis quota", async () => {
    const { deps, actor, notice } = await setup({ plan: "free" });
    for (let i = 0; i < 5; i++) await deps.usage.tryConsume(actor.organizationId, "analyses", "2026-11", 5);
    await createRule(deps, actor, ruleInput({ minScore: 70 }));
    await matchNotice(deps, { noticeId: notice.id });
    expect(deps.jobs.of("notify.send")[0].matchIds).toHaveLength(1);
    expect([...deps.matches.rows.values()][0].status).toBe("notify");
  });
});

describe("analysis", () => {
  it("runs extraction, validates citations, scores and releases pending matches", async () => {
    const { deps, actor, notice } = await setup();
    await withEdital(deps, notice.id);
    await deps.documents.create({ ...makeDoc(), organizationId: actor.organizationId });
    await createRule(deps, actor, ruleInput({ minScore: 10 }));
    await createRule(deps, actor, ruleInput({ name: "exigente", minScore: 99 }));
    await matchNotice(deps, { noticeId: notice.id });
    const [{ analysisId }] = deps.jobs.of("analysis.run");
    const analysis = await runAnalysis(deps, { analysisId });

    expect(analysis.status).toBe("done");
    expect(analysis.citationReport?.failedPaths).toEqual([]);
    expect(analysis.extraction?.objeto.verified).toBe(true);
    expect(analysis.gaps?.map((g) => g.status)).toEqual(["have", "missing", "manual"]);
    expect(analysis.score).toBeGreaterThan(0);
    expect(analysis.scoreFactors).toHaveLength(6);
    expect(analysis.recommendation).toBeDefined();
    const statuses = [...deps.matches.rows.values()].map((m) => m.status).sort();
    expect(statuses).toEqual(["discarded", "notify"]);
    expect(deps.notifications.rows.some((n) => n.type === "analysis_ready")).toBe(true);
  });

  it("re-extracts failed citations once and keeps them unverified if still failing", async () => {
    const { deps, actor, notice } = await setup();
    await withEdital(deps, notice.id);
    deps.ai.extraction.penalties = { value: "Multa de 99%", citation: { fileId: "file-edital", page: 5, excerpt: "multa de 99% inventada" } };
    const analysis = await requestAnalysis(deps, actor.organizationId, notice.id);
    const done = await runAnalysis(deps, { analysisId: analysis.id });
    expect(deps.ai.calls.extractNotice).toHaveLength(2);
    expect((deps.ai.calls.extractNotice[1] as { retryPaths: string[] }).retryPaths).toEqual(["penalties"]);
    expect(done.extraction?.penalties.verified).toBe(false);
    expect(done.citationReport?.failedPaths).toEqual(["penalties"]);
  });

  it("caches per notice version and enforces quota", async () => {
    const { deps, actor, notice } = await setup({ plan: "free" });
    const a = await requestAnalysis(deps, actor.organizationId, notice.id);
    const b = await requestAnalysis(deps, actor.organizationId, notice.id);
    expect(b.id).toBe(a.id);
    expect(await deps.usage.get(actor.organizationId, "analyses", "2026-11")).toBe(1);
  });

  it("marks failures and releases the quota", async () => {
    const { deps, actor, notice } = await setup();
    deps.ai.extractNotice = async () => {
      throw new Error("model down");
    };
    const analysis = await requestAnalysis(deps, actor.organizationId, notice.id);
    await expect(runAnalysis(deps, { analysisId: analysis.id })).rejects.toThrow("model down");
    expect((await deps.analyses.findById(analysis.id))?.status).toBe("failed");
    expect(await deps.usage.get(actor.organizationId, "analyses", "2026-11")).toBe(0);
    // job retry fails again: quota is not released twice
    await expect(runAnalysis(deps, { analysisId: analysis.id })).rejects.toThrow("model down");
    expect(await deps.usage.get(actor.organizationId, "analyses", "2026-11")).toBe(0);
  });

  it("re-charges the quota when a retry succeeds", async () => {
    const { deps, actor, notice } = await setup();
    const original = deps.ai.extractNotice.bind(deps.ai);
    deps.ai.extractNotice = async () => {
      throw new Error("timeout");
    };
    const analysis = await requestAnalysis(deps, actor.organizationId, notice.id);
    await expect(runAnalysis(deps, { analysisId: analysis.id })).rejects.toThrow();
    deps.ai.extractNotice = original;
    await runAnalysis(deps, { analysisId: analysis.id });
    expect(await deps.usage.get(actor.organizationId, "analyses", "2026-11")).toBe(1);
  });

  it("analyzes PNCP metadata when the notice has no files", async () => {
    const { deps, actor, notice } = await setup();
    await deps.notices.markFilesIngested(notice.id, new Date());
    deps.ai.extraction.objeto = { value: notice.objeto, citation: { fileId: "pncp-metadata", page: 1, excerpt: notice.objeto } };
    const analysis = await requestAnalysis(deps, actor.organizationId, notice.id);
    const done = await runAnalysis(deps, { analysisId: analysis.id });
    expect(done.extraction?.objeto.verified).toBe(true);
  });
});

describe("notifications", () => {
  it("emails members and creates in-app notifications", async () => {
    const { deps, actor, notice } = await setup();
    await createRule(deps, actor, ruleInput());
    await matchNotice(deps, { noticeId: notice.id });
    await sendMatchNotifications(deps, deps.jobs.of("notify.send")[0]);
    expect(deps.mailer.sent).toHaveLength(1);
    expect(deps.mailer.sent[0].to).toEqual(["owner@limpabem.test"]);
    expect(deps.mailer.sent[0].html).toContain(`/radar/${notice.id}`);
    expect(deps.notifications.rows.filter((n) => n.type === "match")).toHaveLength(1);
    expect([...deps.matches.rows.values()][0].status).toBe("notified");
  });

  it("sends one daily digest per organization", async () => {
    const { deps, actor, notice } = await setup();
    await createRule(deps, actor, ruleInput({ frequency: "daily", channels: ["email"] }));
    await matchNotice(deps, { noticeId: notice.id });
    expect(deps.jobs.of("notify.send")).toHaveLength(0);
    expect(await sendDigest(deps)).toBe(1);
    expect(deps.mailer.sent[0].subject).toMatch(/Resumo diário/);
    expect(await sendDigest(deps)).toBe(0);
  });
});
