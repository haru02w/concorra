import { NextResponse, type NextRequest } from "next/server";
import { withActor } from "@/web/server/api";
import { getServices } from "@/web/server/container";
import { getSession } from "@/web/server/session";

type ProviderRoute = { params: Promise<{ provider: string }> };

/** The user's calendar connections (tokens never leave the server). Connect via /api/calendar/{provider}/connect. */
export const listCalendars = withActor(async ({ actor }) => {
  const connections = await getServices().calendar.listConnections(actor);
  return { calendars: connections.map(({ id, provider, email, calendarId, expiresAt }) => ({ id, provider, email, calendarId, expiresAt })) };
});

export const disconnectCalendar = withActor<{ id: string }>(async ({ actor, params }) => {
  await getServices().calendar.disconnectCalendar(actor, params.id);
});

/** GET /api/calendar/{provider}/connect: starts OAuth. */
export async function connect(request: NextRequest, { params }: ProviderRoute) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const session = await getSession();
  if (!session?.actor) return NextResponse.redirect(new URL("/sign-in", request.url));
  try {
    return NextResponse.redirect(getServices().calendar.startCalendarConnect(session.actor, provider));
  } catch (error) {
    console.error("[calendar] connect", error);
    return NextResponse.redirect(new URL("/settings?calendar=error", request.url));
  }
}

/** GET /api/calendar/{provider}/callback: completes OAuth. */
export async function callback(request: NextRequest, { params }: ProviderRoute) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const session = await getSession();
  if (!session?.actor) return NextResponse.redirect(new URL("/sign-in", request.url));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/settings?calendar=error", request.url));
  try {
    await getServices().calendar.completeCalendarConnect(session.actor, { provider, code, state });
    return NextResponse.redirect(new URL("/settings?calendar=connected", request.url));
  } catch (error) {
    console.error("[calendar] callback", error);
    return NextResponse.redirect(new URL("/settings?calendar=error", request.url));
  }
}
