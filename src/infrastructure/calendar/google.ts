import type { CalendarProvider, OAuthTokens } from "@/modules/shared/ports";
import type { DeadlineEvent } from "@/domain/calendar/deadlines";
import { apiRequest, failOnError, tokenRequest, type OAuthClientOptions } from "./oauth";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3/calendars";
const SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";
const TZ = "America/Sao_Paulo";

const email = (c: Record<string, unknown>) => (typeof c.email === "string" ? c.email : null);

export class GoogleCalendarProvider implements CalendarProvider {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: OAuthClientOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  authorizationUrl(state: string): string {
    const q = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${AUTH_URL}?${q}`;
  }

  exchangeCode(code: string): Promise<OAuthTokens> {
    return tokenRequest(
      this.fetch,
      TOKEN_URL,
      { code, client_id: this.options.clientId, client_secret: this.options.clientSecret, redirect_uri: this.options.redirectUri, grant_type: "authorization_code" },
      email,
    );
  }

  refresh(refreshToken: string): Promise<OAuthTokens> {
    return tokenRequest(
      this.fetch,
      TOKEN_URL,
      { refresh_token: refreshToken, client_id: this.options.clientId, client_secret: this.options.clientSecret, grant_type: "refresh_token" },
      email,
    );
  }

  private body(event: DeadlineEvent) {
    return {
      summary: event.title,
      description: event.description,
      start: { dateTime: event.start.toISOString(), timeZone: TZ },
      end: { dateTime: event.end.toISOString(), timeZone: TZ },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 24 * 60 }, { method: "popup", minutes: 60 }] },
    };
  }

  async upsertEvent(accessToken: string, calendarId: string, externalId: string | null, event: DeadlineEvent): Promise<string> {
    const base = `${API}/${encodeURIComponent(calendarId)}/events`;
    if (externalId) {
      const res = await apiRequest(this.fetch, `${base}/${encodeURIComponent(externalId)}`, accessToken, "PATCH", this.body(event));
      if (res.ok) return ((await res.json()) as { id: string }).id;
      // Deleted on the user's side: recreate below.
      if (res.status !== 404 && res.status !== 410) await failOnError(res, "Google Calendar update");
    }
    const res = await apiRequest(this.fetch, base, accessToken, "POST", this.body(event));
    await failOnError(res, "Google Calendar create");
    return ((await res.json()) as { id: string }).id;
  }

  async deleteEvent(accessToken: string, calendarId: string, externalId: string): Promise<void> {
    const res = await apiRequest(this.fetch, `${API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`, accessToken, "DELETE");
    if (res.status === 404 || res.status === 410) return;
    await failOnError(res, "Google Calendar delete");
  }
}
