import { NextResponse, type NextRequest } from "next/server";
import { receivePaymentWebhook } from "@/application/use-cases/billing";
import { getDeps } from "@/web/server/container";

/** AbacatePay webhook: `?webhookSecret=` authenticates, `X-Webhook-Signature` protects the body. */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const result = await receivePaymentWebhook(getDeps(), {
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
