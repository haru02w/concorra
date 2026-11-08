import { describe, expect, it } from "vitest";
import { makeDoc } from "@/domain/fixtures";
import { ruleInput, setup, withEdital } from "@/modules/shared/testing/setup";

describe("analysis", () => {
  it("runs extraction, validates citations, scores and releases pending matches", async () => {
    const { services, deps, actor, notice } = await setup();
    await withEdital(deps, notice.id);
    await deps.documents.create({ ...makeDoc(), organizationId: actor.organizationId });
    await services.rules.createRule(actor, ruleInput({ minScore: 10 }));
    await services.rules.createRule(actor, ruleInput({ name: "exigente", minScore: 99 }));
    await services.rules.matchNotice({ noticeId: notice.id });
    const [{ analysisId }] = deps.jobs.of("analysis.run");
    const analysis = await services.analysis.runAnalysis({ analysisId });

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
    const { services, deps, actor, notice } = await setup();
    await withEdital(deps, notice.id);
    deps.ai.extraction.penalties = { value: "Multa de 99%", citation: { fileId: "file-edital", page: 5, excerpt: "multa de 99% inventada" } };
    const analysis = await services.analysis.requestAnalysis(actor.organizationId, notice.id);
    const done = await services.analysis.runAnalysis({ analysisId: analysis.id });
    expect(deps.ai.calls.extractNotice).toHaveLength(2);
    expect((deps.ai.calls.extractNotice[1] as { retryPaths: string[] }).retryPaths).toEqual(["penalties"]);
    expect(done.extraction?.penalties.verified).toBe(false);
    expect(done.citationReport?.failedPaths).toEqual(["penalties"]);
  });

  it("caches per notice version and enforces quota", async () => {
    const { services, deps, actor, notice } = await setup({ plan: "free" });
    const a = await services.analysis.requestAnalysis(actor.organizationId, notice.id);
    const b = await services.analysis.requestAnalysis(actor.organizationId, notice.id);
    expect(b.id).toBe(a.id);
    expect(await deps.usage.get(actor.organizationId, "analyses", "2026-11")).toBe(1);
  });

  it("marks failures and releases the quota", async () => {
    const { services, deps, actor, notice } = await setup();
    deps.ai.extractNotice = async () => {
      throw new Error("model down");
    };
    const analysis = await services.analysis.requestAnalysis(actor.organizationId, notice.id);
    await expect(services.analysis.runAnalysis({ analysisId: analysis.id })).rejects.toThrow("model down");
    expect((await deps.analyses.findById(analysis.id))?.status).toBe("failed");
    expect(await deps.usage.get(actor.organizationId, "analyses", "2026-11")).toBe(0);
    // job retry fails again: quota is not released twice
    await expect(services.analysis.runAnalysis({ analysisId: analysis.id })).rejects.toThrow("model down");
    expect(await deps.usage.get(actor.organizationId, "analyses", "2026-11")).toBe(0);
  });

  it("re-charges the quota when a retry succeeds", async () => {
    const { services, deps, actor, notice } = await setup();
    const original = deps.ai.extractNotice.bind(deps.ai);
    deps.ai.extractNotice = async () => {
      throw new Error("timeout");
    };
    const analysis = await services.analysis.requestAnalysis(actor.organizationId, notice.id);
    await expect(services.analysis.runAnalysis({ analysisId: analysis.id })).rejects.toThrow();
    deps.ai.extractNotice = original;
    await services.analysis.runAnalysis({ analysisId: analysis.id });
    expect(await deps.usage.get(actor.organizationId, "analyses", "2026-11")).toBe(1);
  });

  it("analyzes PNCP metadata when the notice has no files", async () => {
    const { services, deps, actor, notice } = await setup();
    await deps.notices.markFilesIngested(notice.id, new Date());
    deps.ai.extraction.objeto = { value: notice.objeto, citation: { fileId: "pncp-metadata", page: 1, excerpt: notice.objeto } };
    const analysis = await services.analysis.requestAnalysis(actor.organizationId, notice.id);
    const done = await services.analysis.runAnalysis({ analysisId: analysis.id });
    expect(done.extraction?.objeto.verified).toBe(true);
  });
});
