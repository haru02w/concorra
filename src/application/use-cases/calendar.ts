import { bidDeadlines, documentExpiryEvent, type DeadlineEvent } from "@/domain/calendar/deadlines";
import { DomainError, NotFoundError } from "@/domain/shared/errors";
import type { CalendarConnection, CalendarProviderId, Deps } from "../ports";
import type { Actor } from "./context";
import { noticeLink } from "./radar";

const STATE_TTL_MS = 10 * 60 * 1000;

export function startCalendarConnect(deps: Pick<Deps, "calendarProviders" | "cipher" | "clock">, actor: Actor, provider: CalendarProviderId): string {
  const state = deps.cipher.encrypt(JSON.stringify({ u: actor.userId, o: actor.organizationId, p: provider, t: deps.clock.now().getTime() }));
  return deps.calendarProviders[provider].authorizationUrl(state);
}

export async function completeCalendarConnect(
  deps: Pick<Deps, "calendarProviders" | "cipher" | "clock" | "calendars" | "bids" | "documents" | "jobs">,
  actor: Actor,
  input: { provider: CalendarProviderId; code: string; state: string },
): Promise<CalendarConnection> {
  let state: { u: string; o: string; p: string; t: number };
  try {
    state = JSON.parse(deps.cipher.decrypt(input.state));
  } catch {
    throw new DomainError("Invalid OAuth state", "invalid_state");
  }
  if (state.u !== actor.userId || state.o !== actor.organizationId || state.p !== input.provider || deps.clock.now().getTime() - state.t > STATE_TTL_MS) {
    throw new DomainError("Invalid OAuth state", "invalid_state");
  }
  const tokens = await deps.calendarProviders[input.provider].exchangeCode(input.code);
  const connection = await deps.calendars.upsertConnection({
    userId: actor.userId,
    organizationId: actor.organizationId,
    provider: input.provider,
    accessToken: deps.cipher.encrypt(tokens.accessToken),
    refreshToken: tokens.refreshToken ? deps.cipher.encrypt(tokens.refreshToken) : null,
    expiresAt: tokens.expiresAt,
    calendarId: "primary",
    email: tokens.email,
  });
  // Backfill: push existing deadlines to the new calendar.
  for (const bid of await deps.bids.listByOrg(actor.organizationId)) {
    if (["participating", "ready", "submitted"].includes(bid.status)) {
      await deps.jobs.enqueue("calendar.sync", { refType: "bid", refId: bid.id, organizationId: actor.organizationId, action: "upsert" });
    }
  }
  for (const doc of await deps.documents.listByOrg(actor.organizationId)) {
    if (doc.validUntil) await deps.jobs.enqueue("calendar.sync", { refType: "document", refId: doc.id, organizationId: actor.organizationId, action: "upsert" });
  }
  return connection;
}

export async function disconnectCalendar(deps: Pick<Deps, "calendars">, actor: Actor, connectionId: string) {
  await deps.calendars.deleteConnection(actor.userId, connectionId);
}

const REFRESH_MARGIN_MS = 60_000;

async function accessToken(deps: Pick<Deps, "calendars" | "calendarProviders" | "cipher" | "clock">, conn: CalendarConnection): Promise<string> {
  if (!conn.expiresAt || conn.expiresAt.getTime() - REFRESH_MARGIN_MS > deps.clock.now().getTime()) {
    return deps.cipher.decrypt(conn.accessToken);
  }
  if (!conn.refreshToken) throw new DomainError("Calendar token expired; reconnect", "calendar_expired");
  const tokens = await deps.calendarProviders[conn.provider].refresh(deps.cipher.decrypt(conn.refreshToken));
  await deps.calendars.updateTokens(conn.id, {
    accessToken: deps.cipher.encrypt(tokens.accessToken),
    refreshToken: tokens.refreshToken ? deps.cipher.encrypt(tokens.refreshToken) : conn.refreshToken,
    expiresAt: tokens.expiresAt,
  });
  return tokens.accessToken;
}

async function eventsFor(
  deps: Pick<Deps, "bids" | "notices" | "analyses" | "documents" | "config">,
  input: { refType: "bid" | "document"; refId: string; organizationId: string },
): Promise<DeadlineEvent[]> {
  if (input.refType === "bid") {
    const bid = await deps.bids.findById(input.organizationId, input.refId);
    if (!bid) throw new NotFoundError("Bid", input.refId);
    const notice = await deps.notices.findById(bid.noticeId);
    if (!notice) throw new NotFoundError("Notice", bid.noticeId);
    const analysis = bid.analysisId ? await deps.analyses.findById(bid.analysisId) : null;
    const link = `${deps.config.appUrl}/bids/${bid.id}\n${noticeLink(notice)}`;
    return bidDeadlines(bid.id, notice, analysis?.extraction ?? null, link);
  }
  const doc = await deps.documents.findById(input.organizationId, input.refId);
  if (!doc) throw new NotFoundError("Document", input.refId);
  const event = documentExpiryEvent(doc);
  return event ? [event] : [];
}

/** Job (F8): upserts or deletes the events of a bid/document in every connected calendar of the org. */
export async function syncCalendar(
  deps: Pick<Deps, "calendars" | "calendarProviders" | "cipher" | "clock" | "bids" | "notices" | "analyses" | "documents" | "config">,
  input: { refType: "bid" | "document"; refId: string; organizationId: string; action: "upsert" | "delete" },
): Promise<{ upserted: number; deleted: number }> {
  const connections = await deps.calendars.listByOrg(input.organizationId);
  const byId = new Map(connections.map((c) => [c.id, c]));
  let upserted = 0;
  let deleted = 0;

  const existing = await deps.calendars.listEventsByRef(input.refType, input.refId);
  const wanted = input.action === "upsert" ? await eventsFor(deps, input) : [];
  const wantedKeys = new Set(wanted.map((e) => e.key));

  // Remove events that no longer apply (cancelled bid, rectified dates removed).
  for (const event of existing) {
    if (wantedKeys.has(event.key)) continue;
    const conn = byId.get(event.connectionId);
    if (conn) {
      const token = await accessToken(deps, conn);
      await deps.calendarProviders[conn.provider].deleteEvent(token, conn.calendarId, event.externalId);
    }
    await deps.calendars.deleteEvent(event.id);
    deleted++;
  }

  for (const conn of connections) {
    if (!wanted.length) break;
    const token = await accessToken(deps, conn);
    for (const event of wanted) {
      const found = await deps.calendars.findEvent(conn.id, event.key);
      const externalId = await deps.calendarProviders[conn.provider].upsertEvent(token, conn.calendarId, found?.externalId ?? null, event);
      if (!found || found.externalId !== externalId) {
        if (found) await deps.calendars.deleteEvent(found.id);
        await deps.calendars.saveEvent({ connectionId: conn.id, key: event.key, refType: input.refType, refId: input.refId, externalId });
      }
      upserted++;
    }
  }
  return { upserted, deleted };
}
