import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@workos-inc/authkit-nextjs";
import { workosConfigured } from "@/infrastructure/config/env";
import { getContainer } from "@/web/server/container";
import { SESSION_COOKIE } from "@/web/server/session";

export async function POST() {
  const jar = await cookies();
  const wasLocal = jar.has(SESSION_COOKIE);
  jar.delete(SESSION_COOKIE);
  if (!wasLocal && workosConfigured(getContainer().env)) await signOut({ returnTo: process.env.APP_URL });
  redirect("/");
}
