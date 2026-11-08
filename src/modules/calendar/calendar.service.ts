import { bidDeadlines, documentExpiryEvent, type DeadlineEvent } from "@/domain/calendar/deadlines";
import { DomainError, NotFoundError } from "@/domain/shared/errors";
import type { CalendarConnection, CalendarProviderId, Deps } from "../shared/ports";
import type { Actor } from "../shared/context";
import { noticeLink } from "@/domain/notice/notice";

const STATE_TTL_MS = 10 * 60 * 1000;

const REFRESH_MARGIN_MS = 60_000;

export class CalendarService {
  constructor(private readonly deps: Deps) {}

  startCalendarConnect(actor: Actor, provider: CalendarProviderId): string {
    const state = this.deps.cipher.encrypt(JSON.stringify({ u: actor.userId, o: actor.organizationId, p: provider, t: this.deps.clock.now().getTime() }));
    return this.deps.calendarProviders[provider].authorizationUrl(state);
  }

  async completeCalendarConnect(actor: Actor, input: { provider: CalendarProviderId; code: string; state: string }): Promise<CalendarConnection> {
    let state: { u: string; o: string; p: string; t: number };
    try {
      state = JSON.parse(this.deps.cipher.decrypt(input.state));
    } catch {
      throw new DomainError("Invalid OAuth state", "invalid_state");
    }
    if (state.u !== actor.userId || state.o !== actor.organizationId || state.p !== input.provider || this.deps.clock.now().getTime() - state.t > STATE_TTL_MS) {
      throw new DomainError("Invalid OAuth state", "invalid_state");
    }
    const tokens = await this.deps.calendarProviders[input.provider].exchangeCode(input.code);
    const connection = await this.deps.calendars.upsertConnection({
      userId: actor.userId,
      organizationId: actor.organizationId,
      provider: input.provider,
      accessToken: this.deps.cipher.encrypt(tokens.accessToken),
      refreshToken: tokens.refreshToken ? this.deps.cipher.encrypt(tokens.refreshToken) : null,
      expiresAt: tokens.expiresAt,
      calendarId: "primary",
      email: tokens.email,
    });
    // Backfill: push existing deadlines to the new calendar.
    for (const bid of await this.deps.bids.listByOrg(actor.organizationId)) {
      if (["participating", "ready", "submitted"].includes(bid.status)) {
        await this.deps.jobs.enqueue("calendar.sync", { refType: "bid", refId: bid.id, organizationId: actor.organizationId, action: "upsert" });
      }
    }
    for (const doc of await this.deps.documents.listByOrg(actor.organizationId)) {
      if (doc.validUntil) await this.deps.jobs.enqueue("calendar.sync", { refType: "document", refId: doc.id, organizationId: actor.organizationId, action: "upsert" });
    }
    return connection;
  }

  async disconnectCalendar(actor: Actor, connectionId: string) {
    await this.deps.calendars.deleteConnection(actor.userId, connectionId);
  }

  private async accessToken(conn: CalendarConnection): Promise<string> {
    if (!conn.expiresAt || conn.expiresAt.getTime() - REFRESH_MARGIN_MS > this.deps.clock.now().getTime()) {
      return this.deps.cipher.decrypt(conn.accessToken);
    }
    if (!conn.refreshToken) throw new DomainError("Calendar token expired; reconnect", "calendar_expired");
    const tokens = await this.deps.calendarProviders[conn.provider].refresh(this.deps.cipher.decrypt(conn.refreshToken));
    await this.deps.calendars.updateTokens(conn.id, {
      accessToken: this.deps.cipher.encrypt(tokens.accessToken),
      refreshToken: tokens.refreshToken ? this.deps.cipher.encrypt(tokens.refreshToken) : conn.refreshToken,
      expiresAt: tokens.expiresAt,
    });
    return tokens.accessToken;
  }

  private async eventsFor(input: { refType: "bid" | "document"; refId: string; organizationId: string }): Promise<DeadlineEvent[]> {
    if (input.refType === "bid") {
      const bid = await this.deps.bids.findById(input.organizationId, input.refId);
      if (!bid) throw new NotFoundError("Bid", input.refId);
      const notice = await this.deps.notices.findById(bid.noticeId);
      if (!notice) throw new NotFoundError("Notice", bid.noticeId);
      const analysis = bid.analysisId ? await this.deps.analyses.findById(bid.analysisId) : null;
      const link = `${this.deps.config.appUrl}/bids/${bid.id}\n${noticeLink(notice)}`;
      return bidDeadlines(bid.id, notice, analysis?.extraction ?? null, link);
    }
    const doc = await this.deps.documents.findById(input.organizationId, input.refId);
    if (!doc) throw new NotFoundError("Document", input.refId);
    const event = documentExpiryEvent(doc);
    return event ? [event] : [];
  }

  /** Job (F8): upserts or deletes the events of a bid/document in every connected calendar of the org. */
  async syncCalendar(input: { refType: "bid" | "document"; refId: string; organizationId: string; action: "upsert" | "delete" }): Promise<{ upserted: number; deleted: number }> {
    const connections = await this.deps.calendars.listByOrg(input.organizationId);
    const byId = new Map(connections.map((c) => [c.id, c]));
    let upserted = 0;
    let deleted = 0;

    const existing = await this.deps.calendars.listEventsByRef(input.refType, input.refId);
    const wanted = input.action === "upsert" ? await this.eventsFor(input) : [];
    const wantedKeys = new Set(wanted.map((e) => e.key));

    // Remove events that no longer apply (cancelled bid, rectified dates removed).
    for (const event of existing) {
      if (wantedKeys.has(event.key)) continue;
      const conn = byId.get(event.connectionId);
      if (conn) {
        const token = await this.accessToken(conn);
        await this.deps.calendarProviders[conn.provider].deleteEvent(token, conn.calendarId, event.externalId);
      }
      await this.deps.calendars.deleteEvent(event.id);
      deleted++;
    }

    for (const conn of connections) {
      if (!wanted.length) break;
      const token = await this.accessToken(conn);
      for (const event of wanted) {
        const found = await this.deps.calendars.findEvent(conn.id, event.key);
        const externalId = await this.deps.calendarProviders[conn.provider].upsertEvent(token, conn.calendarId, found?.externalId ?? null, event);
        if (!found || found.externalId !== externalId) {
          if (found) await this.deps.calendars.deleteEvent(found.id);
          await this.deps.calendars.saveEvent({ connectionId: conn.id, key: event.key, refType: input.refType, refId: input.refId, externalId });
        }
        upserted++;
      }
    }
    return { upserted, deleted };
  }

  /** The user's connections in the active organization. */
  async listConnections(actor: Actor): Promise<CalendarConnection[]> {
    return this.deps.calendars.listByUser(actor.userId, actor.organizationId);
  }
}
