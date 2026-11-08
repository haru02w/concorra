import type { CalendarProvider, OAuthTokens } from "@/application/ports";
import type { DeadlineEvent } from "@/domain/calendar/deadlines";
import { apiRequest, failOnError, tokenRequest, type OAuthClientOptions } from "./oauth";

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const EVENTS = "https://graph.microsoft.com/v1.0/me/events";
const SCOPE = "offline_access openid email Calendars.ReadWrite";

const email = (c: Record<string, unknown>) =>
  typeof c.email === "string" ? c.email : typeof c.preferred_username === "string" ? c.preferred_username : null;

/** Graph expects a local dateTime plus a timeZone; we send UTC without the Z suffix. */
const graphTime = (d: Date) => ({ dateTime: d.toISOString().replace(/Z$/, ""), timeZone: "UTC" });

/** Microsoft 365 / Outlook via Microsoft Graph; always uses the default calendar. */
export class MicrosoftCalendarProvider implements CalendarProvider {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: OAuthClientOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  authorizationUrl(state: string): string {
    const q = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: SCOPE,
      state,
    });
    return `${AUTH_URL}?${q}`;
  }

  exchangeCode(code: string): Promise<OAuthTokens> {
    return tokenRequest(
      this.fetch,
      TOKEN_URL,
      { code, client_id: this.options.clientId, client_secret: this.options.clientSecret, redirect_uri: this.options.redirectUri, grant_type: "authorization_code", scope: SCOPE },
      email,
    );
  }

  refresh(refreshToken: string): Promise<OAuthTokens> {
    return tokenRequest(
      this.fetch,
      TOKEN_URL,
      { refresh_token: refreshToken, client_id: this.options.clientId, client_secret: this.options.clientSecret, grant_type: "refresh_token", scope: SCOPE },
      email,
    );
  }

  private body(event: DeadlineEvent) {
    return {
      subject: event.title,
      body: { contentType: "text", content: event.description },
      start: graphTime(event.start),
      end: graphTime(event.end),
      isReminderOn: true,
      reminderMinutesBeforeStart: 1440,
    };
  }

  async upsertEvent(accessToken: string, _calendarId: string, externalId: string | null, event: DeadlineEvent): Promise<string> {
    if (externalId) {
      const res = await apiRequest(this.fetch, `${EVENTS}/${encodeURIComponent(externalId)}`, accessToken, "PATCH", this.body(event));
      if (res.ok) return ((await res.json()) as { id: string }).id;
      if (res.status !== 404 && res.status !== 410) await failOnError(res, "Outlook update");
    }
    const res = await apiRequest(this.fetch, EVENTS, accessToken, "POST", this.body(event));
    await failOnError(res, "Outlook create");
    return ((await res.json()) as { id: string }).id;
  }

  async deleteEvent(accessToken: string, _calendarId: string, externalId: string): Promise<void> {
    const res = await apiRequest(this.fetch, `${EVENTS}/${encodeURIComponent(externalId)}`, accessToken, "DELETE");
    if (res.status === 404 || res.status === 410) return;
    await failOnError(res, "Outlook delete");
  }
}
