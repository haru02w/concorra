import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentEvent, PaymentGateway } from "@/application/ports";
import { PLANS, type PlanId } from "@/domain/billing/plans";

const BASE = "https://api.abacatepay.com/v2";
/** Public key AbacatePay uses to sign webhook bodies (integrity, not authenticity). */
export const ABACATEPAY_PUBLIC_HMAC_KEY =
  "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
type PaidPlan = Exclude<PlanId, "free">;

async function call(fetchFn: typeof fetch, apiKey: string, path: string, body: unknown): Promise<Json> {
  const res = await fetchFn(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as { data?: Json; success?: boolean; error?: unknown } | null;
  if (!res.ok || !json || json.success === false || json.error) {
    throw new Error(`AbacatePay ${path} failed (${res.status}): ${JSON.stringify(json?.error ?? json)}`);
  }
  return json.data;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface AbacatePayOptions {
  apiKey: string;
  webhookSecret: string;
  productIds: Record<PaidPlan, string>;
  fetch?: typeof fetch;
}

export class AbacatePayGateway implements PaymentGateway {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: AbacatePayOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async ensureCustomer(input: { name: string; email: string; taxId: string }): Promise<string> {
    const data = await call(this.fetch, this.options.apiKey, "/customers/create", input);
    return data.id;
  }

  async createSubscriptionCheckout(input: { planId: PaidPlan; customerRef: string; externalId: string; returnUrl: string; completionUrl: string }) {
    const data = await call(this.fetch, this.options.apiKey, "/subscriptions/create", {
      items: [{ id: this.options.productIds[input.planId], quantity: 1 }],
      customerId: input.customerRef,
      externalId: input.externalId,
      returnUrl: input.returnUrl,
      completionUrl: input.completionUrl,
      methods: ["CARD", "PIX"],
    });
    return { checkoutRef: data.id as string, url: data.url as string };
  }

  async cancelSubscription(subscriptionRef: string): Promise<void> {
    await call(this.fetch, this.options.apiKey, "/subscriptions/cancel", { id: subscriptionRef });
  }

  verifyWebhook(input: { rawBody: string; secret: string | null; signature: string | null }): boolean {
    if (!input.secret || !safeEqual(input.secret, this.options.webhookSecret)) return false;
    if (input.signature) {
      const expected = createHmac("sha256", ABACATEPAY_PUBLIC_HMAC_KEY).update(input.rawBody).digest("base64");
      if (!safeEqual(input.signature, expected)) return false;
    }
    return true;
  }

  parseWebhook(payload: unknown): { eventId: string; event: PaymentEvent } {
    const p = (payload ?? {}) as Json;
    const d = p.data ?? {};
    const subscriptionRef: string = d.subscription?.id ?? d.id ?? "";
    const name: string = p.event ?? "unknown";
    let event: PaymentEvent;
    switch (name) {
      case "subscription.completed":
        event = {
          type: "subscription.activated",
          subscriptionRef,
          checkoutRef: d.checkout?.id ?? d.subscription?.checkoutId ?? d.checkoutId ?? null,
          customerRef: d.customer?.id ?? null,
          externalId: d.checkout?.externalId ?? d.subscription?.externalId ?? d.externalId ?? null,
        };
        break;
      case "subscription.renewed":
        event = { type: "subscription.renewed", subscriptionRef };
        break;
      case "subscription.payment_failed":
        event = { type: "subscription.payment_failed", subscriptionRef };
        break;
      case "subscription.cancelled":
        event = { type: "subscription.cancelled", subscriptionRef };
        break;
      default:
        event = { type: "ignored", name };
    }
    return { eventId: String(p.id ?? ""), event };
  }
}

/** Setup helper: creates the monthly products for paid plans; returns their ids. */
export async function ensureProducts(options: { apiKey: string; fetch?: typeof fetch }): Promise<Record<PaidPlan, string>> {
  const fetchFn = options.fetch ?? fetch;
  const ids = {} as Record<PaidPlan, string>;
  for (const planId of ["pro", "business"] as const) {
    const plan = PLANS[planId];
    const data = await call(fetchFn, options.apiKey, "/products/create", {
      externalId: `concorra-${planId}`,
      name: `Concorra ${plan.name}`,
      price: plan.priceCents,
      currency: "BRL",
      cycle: "MONTHLY",
    });
    ids[planId] = data.id;
  }
  return ids;
}
