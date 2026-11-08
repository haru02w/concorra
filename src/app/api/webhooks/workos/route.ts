import { NextResponse, type NextRequest } from "next/server";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { getContainer } from "@/web/server/container";

/** WorkOS webhook: signature-verified and recorded idempotently. */
export async function POST(request: NextRequest) {
  const { env, deps } = getContainer();
  if (!env.WORKOS_WEBHOOK_SECRET || !env.WORKOS_API_KEY) return NextResponse.json({ error: "not configured" }, { status: 404 });
  const raw = await request.text();
  const sigHeader = request.headers.get("workos-signature");
  if (!sigHeader) return NextResponse.json({ error: "missing signature" }, { status: 401 });
  let event: { id: string };
  try {
    event = await getWorkOS().webhooks.constructEvent({ payload: JSON.parse(raw), sigHeader, secret: env.WORKOS_WEBHOOK_SECRET });
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  await deps.webhookEvents.recordOnce("workos", event.id, event);
  return NextResponse.json({ received: true });
}
