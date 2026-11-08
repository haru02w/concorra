"use server";

import { switchToOrganization } from "@workos-inc/authkit-nextjs";

export async function switchOrganization(workosOrgId: string) {
  await switchToOrganization(workosOrgId, { returnTo: "/radar" });
}
