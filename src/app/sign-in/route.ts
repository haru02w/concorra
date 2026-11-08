import { redirect } from "next/navigation";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { workosConfigured } from "@/infrastructure/config/env";
import { getContainer } from "@/web/server/container";

export async function GET() {
  const { env } = getContainer();
  if (!workosConfigured(env)) redirect(env.DEMO_MODE ? "/demo" : "/?error=auth-not-configured");
  redirect(await getSignInUrl());
}
