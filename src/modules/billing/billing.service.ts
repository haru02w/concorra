import { addDays, usagePeriod } from "@/domain/shared/dates";
import { DomainError, NotFoundError } from "@/domain/shared/errors";
import { PLANS, type PlanId } from "@/domain/billing/plans";
import type { Deps, PaymentEvent, Subscription } from "../shared/ports";
import { loadOrg, requireOwner, type Actor } from "../shared/context";
import type { NotificationsService } from "../notifications/notifications.service";

const PERIOD_DAYS = 31;

export class BillingService {
  constructor(
    private readonly deps: Deps,
    private readonly notifications: NotificationsService,
  ) {}

  async getUsageSummary(organizationId: string) {
    const org = await loadOrg(this.deps, organizationId);
    const period = usagePeriod(this.deps.clock.now());
    const plan = PLANS[org.planId];
    const [analyses, bidPacks, rules, members, subscription] = await Promise.all([
      this.deps.usage.get(org.id, "analyses", period),
      this.deps.usage.get(org.id, "bidPacks", period),
      this.deps.rules.countActive(org.id),
      this.deps.memberships.count(org.id),
      this.deps.subscriptions.findByOrg(org.id),
    ]);
    return { plan, period, subscription, used: { analyses, bidPacks, rules, members } };
  }

  /** F10: opens an AbacatePay subscription checkout for a paid plan. */
  async startCheckout(actor: Actor, planId: Exclude<PlanId, "free">): Promise<string> {
    requireOwner(actor);
    const org = await loadOrg(this.deps, actor.organizationId);
    if (org.planId === planId) throw new DomainError("Você já está neste plano", "same_plan");
    const current = await this.deps.subscriptions.findByOrg(org.id);
    const customerRef = current?.customerRef ?? (await this.deps.payments.ensureCustomer({ name: org.razaoSocial, email: actor.email, taxId: org.cnpj }));
    const { checkoutRef, url } = await this.deps.payments.createSubscriptionCheckout({
      planId,
      customerRef,
      externalId: org.id,
      returnUrl: `${this.deps.config.appUrl}/billing`,
      completionUrl: `${this.deps.config.appUrl}/billing?checkout=done`,
    });
    await this.deps.subscriptions.upsert({
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
  async receivePaymentWebhook(input: { rawBody: string; secret: string | null; signature: string | null }): Promise<"accepted" | "duplicate" | "rejected"> {
    if (!this.deps.payments.verifyWebhook(input)) return "rejected";
    const payload = JSON.parse(input.rawBody) as unknown;
    const { eventId } = this.deps.payments.parseWebhook(payload);
    const id = await this.deps.webhookEvents.recordOnce("abacatepay", eventId, payload);
    if (!id) return "duplicate";
    await this.deps.jobs.enqueue("billing.webhook", { webhookEventId: id });
    return "accepted";
  }

  private async setPlan(sub: Subscription, patch: Partial<Subscription>) {
    const next = { ...sub, ...patch };
    await this.deps.subscriptions.upsert(next);
    await this.deps.organizations.update(sub.organizationId, { planId: next.planId });
  }

  /** Job: applies a verified payment event to the subscription. */
  async processPaymentEvent(input: { webhookEventId: string }): Promise<PaymentEvent["type"]> {
    const record = await this.deps.webhookEvents.find(input.webhookEventId);
    if (!record) throw new NotFoundError("WebhookEvent", input.webhookEventId);
    if (record.processedAt) return "ignored";
    const { event } = this.deps.payments.parseWebhook(record.payload);
    const now = this.deps.clock.now();

    if (event.type === "subscription.activated") {
      let sub = event.checkoutRef ? await this.deps.subscriptions.findByCheckoutRef(event.checkoutRef) : null;
      if (!sub && event.externalId) sub = await this.deps.subscriptions.findByOrg(event.externalId);
      if (!sub?.pendingPlanId) throw new NotFoundError("Subscription for checkout", event.checkoutRef ?? "-");
      await this.setPlan(sub, {
        planId: sub.pendingPlanId,
        pendingPlanId: null,
        status: "active",
        subscriptionRef: event.subscriptionRef,
        customerRef: event.customerRef ?? sub.customerRef,
        currentPeriodEnd: addDays(now, PERIOD_DAYS),
      });
      await this.notifications.notifyOrganization(sub.organizationId, {
        type: "billing",
        title: `Plano ${PLANS[sub.pendingPlanId].name} ativado`,
        body: "Obrigado! Os novos limites já estão valendo.",
        link: "/billing",
      });
    } else if (event.type !== "ignored") {
      const sub = await this.deps.subscriptions.findBySubscriptionRef(event.subscriptionRef);
      if (!sub) throw new NotFoundError("Subscription", event.subscriptionRef);
      if (event.type === "subscription.renewed") {
        await this.setPlan(sub, { status: "active", currentPeriodEnd: addDays(now, PERIOD_DAYS) });
      } else if (event.type === "subscription.cancelled") {
        await this.setPlan(sub, { planId: "free", status: "cancelled", subscriptionRef: null, currentPeriodEnd: null });
        await this.notifications.notifyOrganization(sub.organizationId, { type: "billing", title: "Assinatura cancelada", body: "Sua organização voltou ao plano Free.", link: "/billing" });
      } else if (event.type === "subscription.payment_failed") {
        await this.notifications.notifyOrganization(sub.organizationId, {
          type: "billing",
          title: "Falha no pagamento da assinatura",
          body: "Não conseguimos cobrar a assinatura. Atualize o meio de pagamento para evitar o cancelamento.",
          link: "/billing",
        });
      }
    }
    await this.deps.webhookEvents.markProcessed(record.id);
    return event.type;
  }

  async cancelSubscription(actor: Actor): Promise<void> {
    requireOwner(actor);
    const sub = await this.deps.subscriptions.findByOrg(actor.organizationId);
    if (!sub?.subscriptionRef) throw new DomainError("Nenhuma assinatura ativa", "no_subscription");
    await this.deps.payments.cancelSubscription(sub.subscriptionRef);
    await this.setPlan(sub, { planId: "free", status: "cancelled", subscriptionRef: null, currentPeriodEnd: null });
  }
}
