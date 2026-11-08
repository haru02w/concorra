import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@workos-inc/authkit-nextjs";
import { workosConfigured } from "@/infrastructure/config/env";
import { getContainer } from "@/web/server/container";
import { DEMO_COOKIE } from "@/web/server/session";

export async function POST() {
  const jar = await cookies();
  const wasDemo = jar.has(DEMO_COOKIE);
  jar.delete(DEMO_COOKIE);
  if (!wasDemo && workosConfigured(getContainer().env)) await signOut({ returnTo: process.env.APP_URL });
  redirect("/");
}
