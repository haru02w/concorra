import { describe, expect, it } from "vitest";
import { memberOf, setup } from "@/modules/shared/testing/setup";

describe("billing", () => {
  it("checkout → webhook (verified, idempotent) → plan upgrade → cancel", async () => {
    const { services, deps, actor } = await setup({ plan: "free" });
    await deps.subscriptions.upsert({ organizationId: actor.organizationId, planId: "free", pendingPlanId: null, status: "active", customerRef: null, checkoutRef: null, subscriptionRef: null, currentPeriodEnd: null });
    await expect(services.billing.startCheckout(memberOf(actor), "pro")).rejects.toThrow(/owners/);
    expect(await services.billing.startCheckout(actor, "pro")).toBe("https://pay.test/bill_1");
    expect((await deps.subscriptions.findByOrg(actor.organizationId))?.pendingPlanId).toBe("pro");

    const body = JSON.stringify({ id: "log_1", event: "subscription.completed", data: { checkoutRef: "bill_1", subscriptionRef: "subs_1" } });
    expect(await services.billing.receivePaymentWebhook({ rawBody: body, secret: "bad", signature: null })).toBe("rejected");
    expect(await services.billing.receivePaymentWebhook({ rawBody: body, secret: "whsec", signature: null })).toBe("accepted");
    expect(await services.billing.receivePaymentWebhook({ rawBody: body, secret: "whsec", signature: null })).toBe("duplicate");

    expect(await services.billing.processPaymentEvent(deps.jobs.of("billing.webhook")[0])).toBe("subscription.activated");
    expect((await deps.organizations.findById(actor.organizationId))?.planId).toBe("pro");
    const usage = await services.billing.getUsageSummary(actor.organizationId);
    expect(usage.plan.id).toBe("pro");
    expect(usage.subscription?.subscriptionRef).toBe("subs_1");

    await services.billing.cancelSubscription(actor);
    expect(deps.payments.cancelled).toEqual(["subs_1"]);
    expect((await deps.organizations.findById(actor.organizationId))?.planId).toBe("free");
  });

  it("downgrades on cancellation webhook", async () => {
    const { services, deps, actor } = await setup({ plan: "pro" });
    await deps.subscriptions.upsert({ organizationId: actor.organizationId, planId: "pro", pendingPlanId: null, status: "active", customerRef: "c", checkoutRef: null, subscriptionRef: "subs_9", currentPeriodEnd: null });
    const body = JSON.stringify({ id: "log_9", event: "subscription.cancelled", data: { subscriptionRef: "subs_9" } });
    await services.billing.receivePaymentWebhook({ rawBody: body, secret: "whsec", signature: null });
    await services.billing.processPaymentEvent(deps.jobs.of("billing.webhook")[0]);
    expect((await deps.organizations.findById(actor.organizationId))?.planId).toBe("free");
  });
});
