import { describe, expect, it } from "vitest";
import { analyzed } from "@/modules/shared/testing/setup";

describe("calendar", () => {
  it("connects via OAuth state and syncs bid deadlines idempotently", async () => {
    const { services, deps, actor, notice } = await analyzed();
    const url = services.calendar.startCalendarConnect(actor, "google");
    const state = decodeURIComponent(new URL(url).searchParams.get("state")!);
    await expect(services.calendar.completeCalendarConnect({ ...actor, userId: "other" }, { provider: "google", code: "c", state })).rejects.toThrow(/state/);
    await services.calendar.completeCalendarConnect(actor, { provider: "google", code: "c", state });
    const bid = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" });
    const input = { refType: "bid" as const, refId: bid.id, organizationId: actor.organizationId, action: "upsert" as const };
    expect(await services.calendar.syncCalendar(input)).toEqual({ upserted: 4, deleted: 0 });
    expect(await services.calendar.syncCalendar(input)).toEqual({ upserted: 4, deleted: 0 });
    expect(deps.calendars.events.size).toBe(4);
    expect(deps.calendarProviders.google.events.size).toBe(4);
    expect(await services.calendar.syncCalendar({ ...input, action: "delete" })).toEqual({ upserted: 0, deleted: 4 });
    expect(deps.calendarProviders.google.events.size).toBe(0);
  });

  it("refreshes expired tokens", async () => {
    const { services, deps, actor, notice } = await analyzed();
    await deps.calendars.upsertConnection({ userId: actor.userId, organizationId: actor.organizationId, provider: "microsoft", accessToken: deps.cipher.encrypt("old"), refreshToken: deps.cipher.encrypt("r"), expiresAt: new Date("2026-11-08T11:00:00Z"), calendarId: "primary", email: null });
    const bid = await services.bids.decideParticipation(actor, { noticeId: notice.id, decision: "participate" });
    await services.calendar.syncCalendar({ refType: "bid", refId: bid.id, organizationId: actor.organizationId, action: "upsert" });
    expect(deps.calendarProviders.microsoft.refreshed).toBe(1);
    const [conn] = await deps.calendars.listByOrg(actor.organizationId);
    expect(deps.cipher.decrypt(conn.accessToken)).toBe("access-2");
  });
});
