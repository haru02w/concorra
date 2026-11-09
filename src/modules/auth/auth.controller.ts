import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { getSignInUrl, getWorkOS, handleAuth, signOut as workosSignOut } from "@workos-inc/authkit-nextjs";
import { workosConfigured } from "@/infrastructure/config/env";
import { withSession } from "@/web/server/api";
import { getContainer, getServices } from "@/web/server/container";
import { SESSION_COOKIE, setLocalSession } from "@/web/server/session";

/** GET /api/v1/me */
export const me = withSession(async ({ session }) => ({
  user: session.user,
  organization: session.organization,
  role: session.actor?.role ?? null,
  organizations: session.organizations.map((o) => ({ id: o.organization.id, razaoSocial: o.organization.razaoSocial, cnpj: o.organization.cnpj, role: o.role })),
  session: { kind: session.kind, demo: session.demo },
}));

/** GET /sign-in */
export async function signIn() {
  const { env } = getContainer();
  if (env.MOCK_EXTERNAL) redirect("/api/mock/login?email=dev@concorra.local");
  if (!workosConfigured(env)) redirect(env.DEMO_MODE ? "/demo" : "/?error=auth-not-configured");
  redirect(await getSignInUrl());
}

/** POST /sign-out */
export async function signOut() {
  const jar = await cookies();
  const wasLocal = jar.has(SESSION_COOKIE);
  jar.delete(SESSION_COOKIE);
  if (!wasLocal && workosConfigured(getContainer().env)) await workosSignOut({ returnTo: getContainer().env.APP_URL });
  redirect("/");
}

/** GET /callback: WorkOS AuthKit redirect. */
export function callback(request: NextRequest) {
  return handleAuth({ returnPathname: "/radar", baseURL: getContainer().env.APP_URL })(request);
}

/** GET /demo: no-friction demo login (Hack Brasil 7.2/7.3) into the seeded fictitious company. */
export async function demo() {
  const { env, services } = getContainer();
  if (!env.DEMO_MODE) redirect("/");
  const owner = await services.auth.demoOwner(env.DEMO_ORG_CNPJ);
  if (!owner) redirect("/?error=demo-not-seeded");
  await setLocalSession({ u: owner.user.id, o: owner.organization.id, d: true });
  redirect("/radar");
}

/** POST /api/webhooks/workos: signature-verified and recorded idempotently. */
export async function workosWebhook(request: NextRequest) {
  const { env } = getContainer();
  if (!env.WORKOS_WEBHOOK_SECRET || !env.WORKOS_API_KEY) return NextResponse.json({ error: "not configured" }, { status: 404 });
  const raw = await request.text();
  const sigHeader = request.headers.get("workos-signature");
  if (!sigHeader) return NextResponse.json({ error: "missing signature" }, { status: 401 });
  let event: { id: string };
  try {
    event = await getWorkOS().webhooks.constructEvent({ payload: JSON.parse(raw), sigHeader, secret: env.WORKOS_WEBHOOK_SECRET });
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  await getServices().auth.recordIdentityEvent(event.id, event);
  return NextResponse.json({ received: true });
}
