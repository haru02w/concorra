import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { resolveSession, type ResolvedSession } from "@/application/use-cases/auth";
import type { Actor } from "@/application/use-cases/context";
import { workosConfigured } from "@/infrastructure/config/env";
import { getContainer } from "./container";

export const DEMO_COOKIE = "concorra_demo";
const DEMO_TTL_MS = 8 * 60 * 60 * 1000;

export function demoCookieValue(userId: string, organizationId: string): string {
  const { deps } = getContainer();
  return deps.cipher.encrypt(JSON.stringify({ u: userId, o: organizationId, exp: Date.now() + DEMO_TTL_MS }));
}

async function demoSession(value: string): Promise<ResolvedSession | null> {
  const { deps } = getContainer();
  try {
    const { u, o, exp } = JSON.parse(deps.cipher.decrypt(value)) as { u: string; o: string; exp: number };
    if (exp < Date.now()) return null;
    const [user, organization, membership] = await Promise.all([deps.users.findById(u), deps.organizations.findById(o), deps.memberships.find(o, u)]);
    if (!user || !organization || !membership) return null;
    return {
      user,
      organization,
      organizations: [{ organization, role: membership.role }],
      actor: { userId: user.id, workosUserId: user.workosUserId, email: user.email, organizationId: organization.id, role: membership.role },
    };
  } catch {
    return null;
  }
}

/** Current session: demo cookie (DEMO_MODE only) or WorkOS AuthKit. */
export const getSession = cache(async (): Promise<(ResolvedSession & { demo: boolean }) | null> => {
  await connection(); // per-request: never prerender at build time
  const { env, deps } = getContainer();
  const demo = (await cookies()).get(DEMO_COOKIE)?.value;
  if (env.DEMO_MODE && demo) {
    const session = await demoSession(demo);
    if (session) return { ...session, demo: true };
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
  return { ...session, demo: false };
});

/** For pages/actions inside the app: signed in and inside an organization. */
export async function requireActor(): Promise<{ actor: Actor; session: ResolvedSession & { demo: boolean } }> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.actor) redirect("/onboarding");
  return { actor: session.actor, session };
}
