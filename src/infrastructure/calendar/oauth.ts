import type { OAuthTokens } from "@/modules/shared/ports";

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
}

/** Reads claims from an id_token received directly from the token endpoint (TLS), so no signature check. */
export function idTokenClaims(idToken: string | undefined): Record<string, unknown> {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function tokenRequest(
  fetchFn: typeof fetch,
  url: string,
  params: Record<string, string>,
  emailFrom: (claims: Record<string, unknown>) => string | null,
  now = Date.now(),
): Promise<OAuthTokens> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !body.access_token) throw new Error(`OAuth token request failed (${res.status}): ${body.error ?? ""}`);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in ? new Date(now + Number(body.expires_in) * 1000) : null,
    email: emailFrom(idTokenClaims(body.id_token)),
  };
}

export async function apiRequest(fetchFn: typeof fetch, url: string, accessToken: string, method: string, body?: unknown): Promise<Response> {
  return fetchFn(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function failOnError(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
}
