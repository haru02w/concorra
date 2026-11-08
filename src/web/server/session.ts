import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { refreshSession, switchToOrganization, withAuth } from "@workos-inc/authkit-nextjs";
import { resolveSession, type ResolvedSession } from "@/application/use-cases/auth";
import type { Actor } from "@/application/use-cases/context";
import type { Organization } from "@/domain/organization/organization";
import { ForbiddenError } from "@/domain/shared/errors";
import { localSessionsEnabled, workosConfigured } from "@/infrastructure/config/env";
import { getContainer } from "./container";

/** Cookie for local sessions: the demo login (DEMO_MODE) and the mock login (MOCK_EXTERNAL). */
export const SESSION_COOKIE = "concorra_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface LocalSession {
  u: string;
  o: string | null;
  /** Demo session (read-only for destructive actions). */
  d?: boolean;
  exp: number;
}

export type Session = ResolvedSession & { kind: "local" | "workos"; demo: boolean };

export async function setLocalSession(value: Omit<LocalSession, "exp">): Promise<void> {
  const { deps, env } = getContainer();
  const payload: LocalSession = { ...value, exp: Date.now() + SESSION_TTL_MS };
  (await cookies()).set(SESSION_COOKIE, deps.cipher.encrypt(JSON.stringify(payload)), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

async function readLocalSession(value: string): Promise<LocalSession | null> {
  try {
    const session = JSON.parse(getContainer().deps.cipher.decrypt(value)) as LocalSession;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

async function localSession(raw: LocalSession): Promise<Session | null> {
  const { deps } = getContainer();
  const user = await deps.users.findById(raw.u);
  if (!user) return null;
  const organizations = await deps.memberships.listByUser(user.id);
  const active = organizations.find((o) => o.organization.id === raw.o) ?? null;
  return {
    kind: "local",
    demo: !!raw.d,
    user,
    organizations,
    organization: active?.organization ?? null,
    actor: active
      ? { userId: user.id, workosUserId: user.workosUserId, email: user.email, organizationId: active.organization.id, role: active.role }
      : null,
  };
}

/** Current session: local cookie (demo/mock) or WorkOS AuthKit. */
export const getSession = cache(async (): Promise<Session | null> => {
  await connection(); // per-request: never prerender at build time
  const { env, deps } = getContainer();
  if (localSessionsEnabled(env)) {
    const raw = (await cookies()).get(SESSION_COOKIE)?.value;
    const parsed = raw ? await readLocalSession(raw) : null;
    const session = parsed ? await localSession(parsed) : null;
    if (session) return session;
  }
  if (!workosConfigured(env)) return null;
  const auth = await withAuth();
  if (!auth.user) return null;
  const session = await resolveSession(deps, {
    workosUserId: auth.user.id,
    email: auth.user.email,
    name: [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || null,
    workosOrgId: auth.organizationId ?? null,
    role: auth.role ?? null,
  });
  return { ...session, kind: "workos", demo: false };
});

/** For pages/actions inside the app: signed in and inside an organization. */
export async function requireActor(): Promise<{ actor: Actor; session: Session }> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.actor) redirect("/onboarding");
  return { actor: session.actor, session };
}

/**
 * Makes `organization` the active one for the current session (no redirect).
 * WorkOS sessions get a refreshed access token scoped to the organization.
 */
export async function setActiveOrganization(session: Session, organization: Organization): Promise<void> {
  if (!session.organizations.some((o) => o.organization.id === organization.id)) {
    // Freshly created organizations are not in the cached session yet: check membership directly.
    const membership = await getContainer().deps.memberships.find(organization.id, session.user.id);
    if (!membership) throw new ForbiddenError("Not a member of this organization");
  }
  if (session.kind === "local") await setLocalSession({ u: session.user.id, o: organization.id, d: session.demo });
  else await refreshSession({ organizationId: organization.workosOrgId, ensureSignedIn: true });
}

/** Switches organization and redirects (server actions). */
export async function switchOrganization(organizationId: string, returnTo: string): Promise<never> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const organization = await getContainer().deps.organizations.findById(organizationId);
  if (!organization) redirect("/onboarding");
  if (session.kind === "workos") await switchToOrganization(organization.workosOrgId, { returnTo });
  await setActiveOrganization(session, organization);
  redirect(returnTo);
}
