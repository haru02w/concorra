import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ABACATEPAY_PUBLIC_HMAC_KEY, AbacatePayGateway, ensureProducts } from "./abacatepay";

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace("https://api.abacatepay.com/v2", "");
    void init;
    return new Response(JSON.stringify({ data: responses[path], success: true, error: null }));
  });
}

const gateway = (fetchFn: ReturnType<typeof mockFetch>) =>
  new AbacatePayGateway({ apiKey: "key", webhookSecret: "whsec", productIds: { pro: "prod_pro", business: "prod_biz" }, fetch: fetchFn as unknown as typeof fetch });

const bodyOf = (fetchFn: ReturnType<typeof mockFetch>, i: number) => JSON.parse(String((fetchFn.mock.calls[i][1] as RequestInit).body));

describe("AbacatePayGateway", () => {
  it("creates customers, subscription checkouts and cancels", async () => {
    const fetchFn = mockFetch({
      "/customers/create": { id: "cust_1" },
      "/subscriptions/create": { id: "bill_1", url: "https://pay/bill_1" },
      "/subscriptions/cancel": { id: "subs_1" },
    });
    const gw = gateway(fetchFn);
    expect(await gw.ensureCustomer({ name: "X", email: "a@b.c", taxId: "11222333000181" })).toBe("cust_1");
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer key" });
    const checkout = await gw.createSubscriptionCheckout({ planId: "business", customerRef: "cust_1", externalId: "org-1", returnUrl: "r", completionUrl: "c" });
    expect(checkout).toEqual({ checkoutRef: "bill_1", url: "https://pay/bill_1" });
    expect(bodyOf(fetchFn, 1)).toEqual({ items: [{ id: "prod_biz", quantity: 1 }], customerId: "cust_1", externalId: "org-1", returnUrl: "r", completionUrl: "c", methods: ["CARD", "PIX"] });
    await gw.cancelSubscription("subs_1");
    expect(bodyOf(fetchFn, 2)).toEqual({ id: "subs_1" });
  });

  it("throws on API errors", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: null, success: false, error: "Unauthorized" }), { status: 401 }));
    const gw = new AbacatePayGateway({ apiKey: "k", webhookSecret: "s", productIds: { pro: "a", business: "b" }, fetch: fetchFn as unknown as typeof fetch });
    await expect(gw.ensureCustomer({ name: "x", email: "y", taxId: "z" })).rejects.toThrow(/401.*Unauthorized/);
  });

  it("verifies webhook secret and signature", () => {
    const gw = gateway(mockFetch({}));
    const rawBody = '{"id":"log_1","event":"subscription.renewed"}';
    const signature = createHmac("sha256", ABACATEPAY_PUBLIC_HMAC_KEY).update(rawBody).digest("base64");
    expect(gw.verifyWebhook({ rawBody, secret: "whsec", signature })).toBe(true);
    expect(gw.verifyWebhook({ rawBody, secret: "whsec", signature: null })).toBe(true);
    expect(gw.verifyWebhook({ rawBody, secret: "wrong", signature })).toBe(false);
    expect(gw.verifyWebhook({ rawBody, secret: null, signature })).toBe(false);
    expect(gw.verifyWebhook({ rawBody: rawBody + " ", secret: "whsec", signature })).toBe(false);
  });

  it("parses subscription events defensively", () => {
    const gw = gateway(mockFetch({}));
    expect(
      gw.parseWebhook({
        id: "log_1",
        event: "subscription.completed",
        data: { subscription: { id: "subs_1" }, checkout: { id: "bill_1", externalId: "org-1" }, customer: { id: "cust_1" } },
      }),
    ).toEqual({ eventId: "log_1", event: { type: "subscription.activated", subscriptionRef: "subs_1", checkoutRef: "bill_1", customerRef: "cust_1", externalId: "org-1" } });
    expect(gw.parseWebhook({ id: "log_2", event: "subscription.completed", data: { id: "subs_2", checkoutId: "bill_2", externalId: "org-2" } }).event).toEqual({
      type: "subscription.activated",
      subscriptionRef: "subs_2",
      checkoutRef: "bill_2",
      customerRef: null,
      externalId: "org-2",
    });
    expect(gw.parseWebhook({ id: "3", event: "subscription.renewed", data: { subscription: { id: "s" } } }).event).toEqual({ type: "subscription.renewed", subscriptionRef: "s" });
    expect(gw.parseWebhook({ id: "4", event: "subscription.payment_failed", data: { id: "s" } }).event.type).toBe("subscription.payment_failed");
    expect(gw.parseWebhook({ id: "5", event: "subscription.cancelled", data: { id: "s" } }).event.type).toBe("subscription.cancelled");
    expect(gw.parseWebhook({ id: "6", event: "checkout.completed", data: {} }).event).toEqual({ type: "ignored", name: "checkout.completed" });
  });

  it("creates monthly products for paid plans", async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: { id: `prod_${++n}` }, success: true })));
    expect(await ensureProducts({ apiKey: "k", fetch: fetchFn as unknown as typeof fetch })).toEqual({ pro: "prod_1", business: "prod_2" });
    const first = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(first).toEqual({ externalId: "concorra-pro", name: "Concorra Pro", price: 9900, currency: "BRL", cycle: "MONTHLY" });
  });
});
