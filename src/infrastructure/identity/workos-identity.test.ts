import { describe, expect, it, vi } from "vitest";
import { WorkOsIdentityProvider } from "./workos-identity";

function fakeWorkos() {
  return {
    organizations: { createOrganization: vi.fn(async () => ({ id: "org_123" })) },
    userManagement: {
      createOrganizationMembership: vi.fn(async () => ({})),
      sendInvitation: vi.fn(async () => ({})),
    },
  };
}

describe("WorkOsIdentityProvider", () => {
  it("creates orgs, memberships and invitations with mapped role slugs", async () => {
    const workos = fakeWorkos();
    const identity = new WorkOsIdentityProvider(workos as never);
    expect(await identity.createOrganization("Limpa Bem", "11222333000181")).toBe("org_123");
    expect(workos.organizations.createOrganization).toHaveBeenCalledWith({ name: "Limpa Bem", externalId: "11222333000181" });
    await identity.addMember("org_123", "user_1", "owner");
    expect(workos.userManagement.createOrganizationMembership).toHaveBeenCalledWith({ organizationId: "org_123", userId: "user_1", roleSlug: "admin" });
    await identity.inviteMember({ email: "m@x.y", workosOrgId: "org_123", role: "member", inviterUserId: "user_1" });
    expect(workos.userManagement.sendInvitation).toHaveBeenCalledWith({ email: "m@x.y", organizationId: "org_123", roleSlug: "member", inviterUserId: "user_1" });
  });

  it("accepts custom role slugs", async () => {
    const workos = fakeWorkos();
    await new WorkOsIdentityProvider(workos as never, { roleSlugs: { owner: "owner" } }).addMember("o", "u", "owner");
    expect(workos.userManagement.createOrganizationMembership).toHaveBeenCalledWith(expect.objectContaining({ roleSlug: "owner" }));
  });
});
