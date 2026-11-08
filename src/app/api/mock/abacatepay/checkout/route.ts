import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { paymentWebhookSecret } from "@/infrastructure/container";
import { ABACATEPAY_PUBLIC_HMAC_KEY } from "@/infrastructure/payments/abacatepay";
import { ApiError } from "@/web/server/api";
import { requireMockMode } from "@/web/server/mock";

/**
 * MOCK_EXTERNAL only: stands in for AbacatePay's hosted checkout. "Paying" sends a
 * signed `subscription.completed` webhook to our own endpoint, then returns to the app.
 */
export async function GET(req: NextRequest) {
  try {
    const { env } = requireMockMode();
    const q = req.nextUrl.searchParams;
    const checkoutId = q.get("id");
    if (!checkoutId) throw new ApiError(400, "invalid_request", "id is required");
    const rawBody = JSON.stringify({
      id: `log_mock_${crypto.randomUUID()}`,
      event: "subscription.completed",
      apiVersion: 2,
      devMode: true,
      data: {
        subscription: { id: `subs_mock_${checkoutId.slice(-12)}`, status: "ACTIVE" },
        checkout: { id: checkoutId, externalId: q.get("externalId"), status: "PAID" },
        customer: { id: q.get("customerId") },
      },
    });
    const signature = createHmac("sha256", ABACATEPAY_PUBLIC_HMAC_KEY).update(rawBody).digest("base64");
    const webhook = await fetch(`${env.APP_URL}/api/webhooks/abacatepay?webhookSecret=${encodeURIComponent(paymentWebhookSecret(env))}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-signature": signature },
      body: rawBody,
    });
    if (!webhook.ok) throw new ApiError(502, "webhook_failed", `Webhook returned ${webhook.status}`);
    const completion = q.get("completionUrl");
    return NextResponse.redirect(completion && completion.startsWith(env.APP_URL) ? completion : `${env.APP_URL}/billing?checkout=done`);
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    throw error;
  }
}
