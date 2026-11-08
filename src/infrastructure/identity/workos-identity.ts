import type { WorkOS } from "@workos-inc/node";
import type { IdentityProvider } from "@/modules/shared/ports";
import type { Role } from "@/domain/organization/organization";

export type WorkOSLike = {
  organizations: Pick<WorkOS["organizations"], "createOrganization">;
  userManagement: Pick<WorkOS["userManagement"], "createOrganizationMembership" | "sendInvitation">;
};

/**
 * WorkOS environments seed only the `member` role; the owner slug (default
 * `admin`) must exist in the WorkOS dashboard (Roles).
 */
export class WorkOsIdentityProvider implements IdentityProvider {
  private readonly roleSlugs: Record<Role, string>;

  constructor(
    private readonly workos: WorkOSLike,
    options: { roleSlugs?: Partial<Record<Role, string>> } = {},
  ) {
    this.roleSlugs = { owner: "admin", member: "member", ...options.roleSlugs };
  }

  async createOrganization(name: string, externalId: string): Promise<string> {
    const org = await this.workos.organizations.createOrganization({ name, externalId });
    return org.id;
  }

  async addMember(workosOrgId: string, workosUserId: string, role: Role): Promise<void> {
    await this.workos.userManagement.createOrganizationMembership({
      organizationId: workosOrgId,
      userId: workosUserId,
      roleSlug: this.roleSlugs[role],
    });
  }

  async inviteMember(input: { email: string; workosOrgId: string; role: Role; inviterUserId: string }): Promise<void> {
    await this.workos.userManagement.sendInvitation({
      email: input.email,
      organizationId: input.workosOrgId,
      roleSlug: this.roleSlugs[input.role],
      inviterUserId: input.inviterUserId,
    });
  }
}
