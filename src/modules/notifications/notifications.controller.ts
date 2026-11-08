import { NextResponse, type NextRequest } from "next/server";
import { verifySvix } from "@/infrastructure/email/svix";
import { parseJson, withActor } from "@/web/server/api";
import { getContainer, getServices } from "@/web/server/container";
import { markReadSchema } from "./notifications.schemas";

export const listNotifications = withActor(async ({ actor }) => {
  const { notifications } = getServices();
  const [list, unread] = await Promise.all([notifications.listNotifications(actor), notifications.countUnread(actor)]);
  return { notifications: list, unread };
});

/** Body: { ids: string[] } or { ids: "all" }. */
export const markRead = withActor(async ({ req, actor }) => {
  const { ids } = await parseJson(req, markReadSchema);
  await getServices().notifications.markNotificationsRead(actor, ids);
});

/** POST /api/webhooks/resend: Svix-signed, verified and recorded idempotently. */
export async function resendWebhook(request: NextRequest) {
  const { env } = getContainer();
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
  await getServices().notifications.recordEmailEvent(id, payload);
  return NextResponse.json({ received: true });
}
