"use server";

import { switchOrganization as switchTo } from "@/web/server/session";

export async function switchOrganization(organizationId: string) {
  await switchTo(organizationId, "/radar");
}
