import { describe, expect, it, vi } from "vitest";
import type { DeadlineEvent } from "@/domain/calendar/deadlines";
import { GoogleCalendarProvider } from "./google";
import { MicrosoftCalendarProvider } from "./microsoft";

const event: DeadlineEvent = {
  key: "bid:b1:proposta",
  refType: "bid",
  refId: "b1",
  title: "Encerramento de propostas",
  description: "Objeto",
  start: new Date("2026-11-20T12:00:00Z"),
  end: new Date("2026-11-20T13:00:00Z"),
};

const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

type Handler = (url: string, init: RequestInit) => Response;
function mock(handler: Handler) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {}));
  return fn;
}
const opts = (fetchFn: ReturnType<typeof mock>) => ({ clientId: "cid", clientSecret: "secret", redirectUri: "https://app/cb", fetch: fetchFn as unknown as typeof fetch });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("GoogleCalendarProvider", () => {
  it("builds the consent URL", () => {
    const url = new URL(new GoogleCalendarProvider(opts(mock(() => json({})))).authorizationUrl("st"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "cid", access_type: "offline", prompt: "consent", state: "st", response_type: "code" });
    expect(url.searchParams.get("scope")).toContain("calendar.events");
  });

  it("exchanges codes and reads the email from the id_token", async () => {
    const fetchFn = mock(() => json({ access_token: "at", refresh_token: "rt", expires_in: 3600, id_token: idToken({ email: "u@g.com" }) }));
    const tokens = await new GoogleCalendarProvider(opts(fetchFn)).exchangeCode("code");
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt", email: "u@g.com" });
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(String(init?.body)).toContain("grant_type=authorization_code");
  });

  it("throws on token errors", async () => {
    await expect(new GoogleCalendarProvider(opts(mock(() => json({ error: "invalid_grant" }, 400)))).refresh("rt")).rejects.toThrow(/invalid_grant/);
  });

  it("creates, updates (recreating when gone) and deletes events", async () => {
    const calls: string[] = [];
    const fetchFn = mock((url, init) => {
      calls.push(`${init.method} ${url}`);
      if (init.method === "PATCH" && url.endsWith("/gone")) return new Response("", { status: 410 });
      if (init.method === "DELETE") return new Response(null, { status: url.endsWith("/missing") ? 404 : 204 });
      return json({ id: init.method === "PATCH" ? "e1" : "new" });
    });
    const google = new GoogleCalendarProvider(opts(fetchFn));
    expect(await google.upsertEvent("tok", "primary", null, event)).toBe("new");
    const body = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ summary: event.title, start: { dateTime: "2026-11-20T12:00:00.000Z", timeZone: "America/Sao_Paulo" } });
    expect(body.reminders.overrides).toHaveLength(2);
    expect(fetchFn.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(await google.upsertEvent("tok", "primary", "e1", event)).toBe("e1");
    expect(await google.upsertEvent("tok", "primary", "gone", event)).toBe("new");
    await google.deleteEvent("tok", "primary", "e1");
    await google.deleteEvent("tok", "primary", "missing");
    expect(calls).toEqual([
      "POST https://www.googleapis.com/calendar/v3/calendars/primary/events",
      "PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/e1",
      "PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/gone",
      "POST https://www.googleapis.com/calendar/v3/calendars/primary/events",
      "DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/e1",
      "DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/missing",
    ]);
  });

  it("surfaces API errors", async () => {
    const google = new GoogleCalendarProvider(opts(mock(() => new Response("forbidden", { status: 403 }))));
    await expect(google.upsertEvent("tok", "primary", null, event)).rejects.toThrow(/403/);
    await expect(google.deleteEvent("tok", "primary", "x")).rejects.toThrow(/403/);
  });
});

describe("MicrosoftCalendarProvider", () => {
  it("builds the consent URL and exchanges codes", async () => {
    const fetchFn = mock(() => json({ access_token: "at", expires_in: 3600, id_token: idToken({ preferred_username: "u@outlook.com" }) }));
    const ms = new MicrosoftCalendarProvider(opts(fetchFn));
    const url = new URL(ms.authorizationUrl("st"));
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("offline_access openid email Calendars.ReadWrite");
    const tokens = await ms.exchangeCode("code");
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: null, email: "u@outlook.com" });
    expect(String(fetchFn.mock.calls[0][0])).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
  });

  it("upserts and deletes events on the default calendar", async () => {
    const calls: string[] = [];
    const fetchFn = mock((url, init) => {
      calls.push(`${init.method} ${url}`);
      if (init.method === "PATCH") return new Response("", { status: 404 });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return json({ id: "ms1" });
    });
    const ms = new MicrosoftCalendarProvider(opts(fetchFn));
    expect(await ms.upsertEvent("tok", "primary", "old", event)).toBe("ms1");
    const body = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(body).toEqual({
      subject: event.title,
      body: { contentType: "text", content: "Objeto" },
      start: { dateTime: "2026-11-20T12:00:00.000", timeZone: "UTC" },
      end: { dateTime: "2026-11-20T13:00:00.000", timeZone: "UTC" },
      isReminderOn: true,
      reminderMinutesBeforeStart: 1440,
    });
    await ms.deleteEvent("tok", "primary", "ms1");
    expect(calls).toEqual([
      "PATCH https://graph.microsoft.com/v1.0/me/events/old",
      "POST https://graph.microsoft.com/v1.0/me/events",
      "DELETE https://graph.microsoft.com/v1.0/me/events/ms1",
    ]);
  });
});
