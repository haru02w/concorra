import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS } from "@/domain/rules/rule";
import { fakeEmbedding } from "@/modules/shared/testing/in-memory";
import { ruleInput, setup } from "@/modules/shared/testing/setup";

describe("rules CRUD", () => {
  it("enforces active rule limits", async () => {
    const { services, deps, actor } = await setup({ plan: "free" });
    await services.rules.createRule(actor, ruleInput());
    const second = await services.rules.createRule(actor, ruleInput());
    await expect(services.rules.createRule(actor, ruleInput())).rejects.toThrow(/limit/);
    const inactive = await services.rules.createRule(actor, ruleInput({ active: false }));
    await expect(services.rules.updateRule(actor, inactive.id, ruleInput())).rejects.toThrow(/limit/);
    await services.rules.deleteRule(actor, second.id);
    await services.rules.updateRule(actor, inactive.id, ruleInput());
    expect(await deps.rules.countActive(actor.organizationId)).toBe(2);
  });
});

describe("matchNotice", () => {
  it("creates matches, queues immediate notifications and auto analysis", async () => {
    const { services, deps, actor, notice } = await setup();
    await services.rules.createRule(actor, ruleInput());
    const result = await services.rules.matchNotice({ noticeId: notice.id });
    expect(result.matched).toBe(1);
    expect(deps.jobs.of("notify.send")[0].matchIds).toHaveLength(1);
    expect(deps.jobs.of("notice.ingest-files")).toEqual([expect.objectContaining({ noticeId: notice.id })]);
    // idempotent
    deps.jobs.clear();
    expect((await services.rules.matchNotice({ noticeId: notice.id })).matched).toBe(0);
  });

  it("uses profile similarity for semantic rules", async () => {
    const { services, deps, actor, notice } = await setup();
    await deps.organizations.setProfileEmbedding(actor.organizationId, fakeEmbedding("material de limpeza escolas"));
    await deps.notices.setEmbedding(notice.id, fakeEmbedding("material de limpeza escolas municipais"));
    await services.rules.createRule(actor, ruleInput({ filters: EMPTY_FILTERS, semanticThreshold: 0.5 }));
    expect((await services.rules.matchNotice({ noticeId: notice.id })).matched).toBe(1);
  });

  it("notifies without score when out of analysis quota", async () => {
    const { services, deps, actor, notice } = await setup({ plan: "free" });
    for (let i = 0; i < 5; i++) await deps.usage.tryConsume(actor.organizationId, "analyses", "2026-11", 5);
    await services.rules.createRule(actor, ruleInput({ minScore: 70 }));
    await services.rules.matchNotice({ noticeId: notice.id });
    expect(deps.jobs.of("notify.send")[0].matchIds).toHaveLength(1);
    expect([...deps.matches.rows.values()][0].status).toBe("notify");
  });
});
