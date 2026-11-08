import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/web/server/container";
import { verifySvix } from "./svix";

/** Resend (Svix-signed) webhook: verified and recorded idempotently. */
export async function POST(request: NextRequest) {
  const { env, deps } = getContainer();
  if (!env.RESEND_WEBHOOK_SECRET) return NextResponse.json({ error: "not configured" }, { status: 404 });
  const body = await request.text();
  const id = request.headers.get("svix-id");
  const valid = verifySvix({
    secret: env.RESEND_WEBHOOK_SECRET,
    id,
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body,
  });
  if (!valid || !id) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  await deps.webhookEvents.recordOnce("resend", id, payload);
  return NextResponse.json({ received: true });
}
