import { NextResponse, type NextRequest } from "next/server";
import { PLANS } from "@/domain/billing/plans";
import { parseJson, withActor } from "@/web/server/api";
import { getServices } from "@/web/server/container";
import { checkoutSchema } from "./billing.schemas";

export const getBilling = withActor(async ({ actor }) => ({ ...(await getServices().billing.getUsageSummary(actor.organizationId)), plans: Object.values(PLANS) }));

/** GET /api/v1/organization/usage */
export const getUsage = withActor(async ({ actor }) => getServices().billing.getUsageSummary(actor.organizationId));

/** Opens an AbacatePay subscription checkout. Body: { planId: "pro" | "business" } → { url }. */
export const checkout = withActor(async ({ req, actor }) => {
  const { planId } = await parseJson(req, checkoutSchema);
  return { url: await getServices().billing.startCheckout(actor, planId) };
});

export const cancel = withActor(async ({ actor }) => {
  await getServices().billing.cancelSubscription(actor);
});

/** POST /api/webhooks/abacatepay: `?webhookSecret=` authenticates, `X-Webhook-Signature` protects the body. */
export async function abacatepayWebhook(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const result = await getServices().billing.receivePaymentWebhook({
      rawBody,
      secret: request.nextUrl.searchParams.get("webhookSecret"),
      signature: request.headers.get("x-webhook-signature"),
    });
    if (result === "rejected") return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[webhook] abacatepay", error);
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
}
