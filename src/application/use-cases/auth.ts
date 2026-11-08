import type { Organization, Role } from "@/domain/organization/organization";
import type { Deps, User } from "../ports";
import type { Actor } from "./context";

export interface IdentitySession {
  workosUserId: string;
  email: string;
  name: string | null;
  workosOrgId: string | null;
  role: string | null;
}

export interface ResolvedSession {
  user: User;
  organization: Organization | null;
  actor: Actor | null;
  organizations: { organization: Organization; role: Role }[];
}

function toRole(value: string | null): Role {
  return value === "owner" || value === "admin" ? "owner" : "member";
}

/**
 * Maps the identity-provider session to local user/org/membership.
 * Members invited through WorkOS get their local membership on first visit.
 */
export async function resolveSession(
  deps: Pick<Deps, "users" | "organizations" | "memberships">,
  session: IdentitySession,
): Promise<ResolvedSession> {
  const user = await deps.users.upsert({ workosUserId: session.workosUserId, email: session.email, name: session.name });
  let organization: Organization | null = null;
  let actor: Actor | null = null;
  if (session.workosOrgId) {
    organization = await deps.organizations.findByWorkosOrgId(session.workosOrgId);
    if (organization) {
      const existing = await deps.memberships.find(organization.id, user.id);
      const role = existing?.role ?? toRole(session.role);
      if (!existing) await deps.memberships.upsert(organization.id, user.id, role);
      actor = { userId: user.id, workosUserId: user.workosUserId, email: user.email, organizationId: organization.id, role };
    }
  }
  const organizations = await deps.memberships.listByUser(user.id);
  return { user, organization, actor, organizations };
}
