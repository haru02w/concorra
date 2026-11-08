import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContainer } from "@/web/server/container";
import { DEMO_COOKIE, demoCookieValue } from "@/web/server/session";

/** No-friction demo login (Hack Brasil 7.2/7.3): signs into the seeded fictitious company. */
export async function GET() {
  const { env, deps } = getContainer();
  if (!env.DEMO_MODE) redirect("/");
  const org = await deps.organizations.findByCnpj(env.DEMO_ORG_CNPJ);
  const owner = org && (await deps.memberships.listByOrg(org.id)).find((m) => m.role === "owner");
  if (!org || !owner) redirect("/?error=demo-not-seeded");
  (await cookies()).set(DEMO_COOKIE, demoCookieValue(owner.user.id, org.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https://"),
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  redirect("/radar");
}
