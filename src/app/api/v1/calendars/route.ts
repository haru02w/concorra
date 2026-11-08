import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** The user's calendar connections (tokens never leave the server). Connect via /api/calendar/{provider}/connect. */
export const GET = withActor(async ({ actor }) => {
  const connections = await getDeps().calendars.listByUser(actor.userId, actor.organizationId);
  return { calendars: connections.map(({ id, provider, email, calendarId, expiresAt }) => ({ id, provider, email, calendarId, expiresAt })) };
});
