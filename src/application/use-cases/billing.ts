import { addDays, usagePeriod } from "@/domain/shared/dates";
import { DomainError, NotFoundError } from "@/domain/shared/errors";
import { PLANS, type PlanId } from "@/domain/billing/plans";
import type { Deps, PaymentEvent, Subscription } from "../ports";
import { loadOrg, requireOwner, type Actor } from "./context";
import { notifyOrganization } from "./notifications";

export async function getUsageSummary(deps: Pick<Deps, "organizations" | "usage" | "rules" | "memberships" | "subscriptions" | "clock">, organizationId: string) {
  const org = await loadOrg(deps, organizationId);
  const period = usagePeriod(deps.clock.now());
  const plan = PLANS[org.planId];
  const [analyses, bidPacks, rules, members, subscription] = await Promise.all([
    deps.usage.get(org.id, "analyses", period),
    deps.usage.get(org.id, "bidPacks", period),
    deps.rules.countActive(org.id),
    deps.memberships.count(org.id),
    deps.subscriptions.findByOrg(org.id),
  ]);
  return { plan, period, subscription, used: { analyses, bidPacks, rules, members } };
}

/** F10: opens an AbacatePay subscription checkout for a paid plan. */
export async function startCheckout(
  deps: Pick<Deps, "organizations" | "subscriptions" | "payments" | "config">,
  actor: Actor,
  planId: Exclude<PlanId, "free">,
): Promise<string> {
  requireOwner(actor);
  const org = await loadOrg(deps, actor.organizationId);
  if (org.planId === planId) throw new DomainError("Você já está neste plano", "same_plan");
  const current = await deps.subscriptions.findByOrg(org.id);
  const customerRef = current?.customerRef ?? (await deps.payments.ensureCustomer({ name: org.razaoSocial, email: actor.email, taxId: org.cnpj }));
  const { checkoutRef, url } = await deps.payments.createSubscriptionCheckout({
    planId,
    customerRef,
    externalId: org.id,
    returnUrl: `${deps.config.appUrl}/billing`,
    completionUrl: `${deps.config.appUrl}/billing?checkout=done`,
  });
  await deps.subscriptions.upsert({
    organizationId: org.id,
    planId: current?.planId ?? org.planId,
    pendingPlanId: planId,
    status: current?.status ?? "active",
    customerRef,
    checkoutRef,
    subscriptionRef: current?.subscriptionRef ?? null,
    currentPeriodEnd: current?.currentPeriodEnd ?? null,
  });
  return url;
}

/** Webhook endpoint: verify, store once (idempotent), process in a job. */
export async function receivePaymentWebhook(
  deps: Pick<Deps, "payments" | "webhookEvents" | "jobs">,
  input: { rawBody: string; secret: string | null; signature: string | null },
): Promise<"accepted" | "duplicate" | "rejected"> {
  if (!deps.payments.verifyWebhook(input)) return "rejected";
  const payload = JSON.parse(input.rawBody) as unknown;
  const { eventId } = deps.payments.parseWebhook(payload);
  const id = await deps.webhookEvents.recordOnce("abacatepay", eventId, payload);
  if (!id) return "duplicate";
  await deps.jobs.enqueue("billing.webhook", { webhookEventId: id });
  return "accepted";
}

async function setPlan(deps: Pick<Deps, "organizations" | "subscriptions">, sub: Subscription, patch: Partial<Subscription>) {
  const next = { ...sub, ...patch };
  await deps.subscriptions.upsert(next);
  await deps.organizations.update(sub.organizationId, { planId: next.planId });
}

const PERIOD_DAYS = 31;

/** Job: applies a verified payment event to the subscription. */
export async function processPaymentEvent(
  deps: Pick<Deps, "payments" | "webhookEvents" | "subscriptions" | "organizations" | "clock" | "notifications" | "memberships" | "mailer" | "config">,
  input: { webhookEventId: string },
): Promise<PaymentEvent["type"]> {
  const record = await deps.webhookEvents.find(input.webhookEventId);
  if (!record) throw new NotFoundError("WebhookEvent", input.webhookEventId);
  if (record.processedAt) return "ignored";
  const { event } = deps.payments.parseWebhook(record.payload);
  const now = deps.clock.now();

  if (event.type === "subscription.activated") {
    let sub = event.checkoutRef ? await deps.subscriptions.findByCheckoutRef(event.checkoutRef) : null;
    if (!sub && event.externalId) sub = await deps.subscriptions.findByOrg(event.externalId);
    if (!sub?.pendingPlanId) throw new NotFoundError("Subscription for checkout", event.checkoutRef ?? "-");
    await setPlan(deps, sub, {
      planId: sub.pendingPlanId,
      pendingPlanId: null,
      status: "active",
      subscriptionRef: event.subscriptionRef,
      customerRef: event.customerRef ?? sub.customerRef,
      currentPeriodEnd: addDays(now, PERIOD_DAYS),
    });
    await notifyOrganization(deps, sub.organizationId, {
      type: "billing",
      title: `Plano ${PLANS[sub.pendingPlanId].name} ativado`,
      body: "Obrigado! Os novos limites já estão valendo.",
      link: "/billing",
    });
  } else if (event.type !== "ignored") {
    const sub = await deps.subscriptions.findBySubscriptionRef(event.subscriptionRef);
    if (!sub) throw new NotFoundError("Subscription", event.subscriptionRef);
    if (event.type === "subscription.renewed") {
      await setPlan(deps, sub, { status: "active", currentPeriodEnd: addDays(now, PERIOD_DAYS) });
    } else if (event.type === "subscription.cancelled") {
      await setPlan(deps, sub, { planId: "free", status: "cancelled", subscriptionRef: null, currentPeriodEnd: null });
      await notifyOrganization(deps, sub.organizationId, { type: "billing", title: "Assinatura cancelada", body: "Sua organização voltou ao plano Free.", link: "/billing" });
    } else if (event.type === "subscription.payment_failed") {
      await notifyOrganization(deps, sub.organizationId, {
        type: "billing",
        title: "Falha no pagamento da assinatura",
        body: "Não conseguimos cobrar a assinatura. Atualize o meio de pagamento para evitar o cancelamento.",
        link: "/billing",
      });
    }
  }
  await deps.webhookEvents.markProcessed(record.id);
  return event.type;
}

export async function cancelSubscription(deps: Pick<Deps, "subscriptions" | "payments" | "organizations">, actor: Actor): Promise<void> {
  requireOwner(actor);
  const sub = await deps.subscriptions.findByOrg(actor.organizationId);
  if (!sub?.subscriptionRef) throw new DomainError("Nenhuma assinatura ativa", "no_subscription");
  await deps.payments.cancelSubscription(sub.subscriptionRef);
  await setPlan(deps, sub, { planId: "free", status: "cancelled", subscriptionRef: null, currentPeriodEnd: null });
}
