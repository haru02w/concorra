import { describe, expect, it } from "vitest";
import { ruleInput, setup } from "@/modules/shared/testing/setup";

describe("notifications", () => {
  it("emails members and creates in-app notifications", async () => {
    const { services, deps, actor, notice } = await setup();
    await services.rules.createRule(actor, ruleInput());
    await services.rules.matchNotice({ noticeId: notice.id });
    await services.notifications.sendMatchNotifications(deps.jobs.of("notify.send")[0]);
    expect(deps.mailer.sent).toHaveLength(1);
    expect(deps.mailer.sent[0].to).toEqual(["owner@limpabem.test"]);
    expect(deps.mailer.sent[0].html).toContain(`/radar/${notice.id}`);
    expect(deps.notifications.rows.filter((n) => n.type === "match")).toHaveLength(1);
    expect([...deps.matches.rows.values()][0].status).toBe("notified");
  });

  it("sends one daily digest per organization", async () => {
    const { services, deps, actor, notice } = await setup();
    await services.rules.createRule(actor, ruleInput({ frequency: "daily", channels: ["email"] }));
    await services.rules.matchNotice({ noticeId: notice.id });
    expect(deps.jobs.of("notify.send")).toHaveLength(0);
    expect(await services.notifications.sendDigest()).toBe(1);
    expect(deps.mailer.sent[0].subject).toMatch(/Resumo diário/);
    expect(await services.notifications.sendDigest()).toBe(0);
  });
});
