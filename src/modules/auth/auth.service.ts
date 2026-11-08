import type { Organization, Role } from "@/domain/organization/organization";
import type { Deps, User } from "../shared/ports";
import type { Actor } from "../shared/context";

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

export class AuthService {
  constructor(private readonly deps: Deps) {}

  /**
   * Maps the identity-provider session to local user/org/membership.
   * Members invited through WorkOS get their local membership on first visit.
   */
  async resolveSession(session: IdentitySession): Promise<ResolvedSession> {
    const user = await this.deps.users.upsert({ workosUserId: session.workosUserId, email: session.email, name: session.name });
    let organization: Organization | null = null;
    let actor: Actor | null = null;
    if (session.workosOrgId) {
      organization = await this.deps.organizations.findByWorkosOrgId(session.workosOrgId);
      if (organization) {
        const existing = await this.deps.memberships.find(organization.id, user.id);
        const role = existing?.role ?? toRole(session.role);
        if (!existing) await this.deps.memberships.upsert(organization.id, user.id, role);
        actor = { userId: user.id, workosUserId: user.workosUserId, email: user.email, organizationId: organization.id, role };
      }
    }
    const organizations = await this.deps.memberships.listByUser(user.id);
    return { user, organization, actor, organizations };
  }

  /** Session from a local cookie (demo/mock login); null when the user is gone. */
  async loadLocalSession(userId: string, organizationId: string | null): Promise<ResolvedSession | null> {
    const user = await this.deps.users.findById(userId);
    if (!user) return null;
    const organizations = await this.deps.memberships.listByUser(user.id);
    const active = organizations.find((o) => o.organization.id === organizationId) ?? null;
    return {
      user,
      organizations,
      organization: active?.organization ?? null,
      actor: active
        ? { userId: user.id, workosUserId: user.workosUserId, email: user.email, organizationId: active.organization.id, role: active.role }
        : null,
    };
  }

  async isMember(organizationId: string, userId: string): Promise<boolean> {
    return !!(await this.deps.memberships.find(organizationId, userId));
  }

  async findOrganization(id: string): Promise<Organization | null> {
    return this.deps.organizations.findById(id);
  }

  /** Mock login (MOCK_EXTERNAL): upserts the user; the first organization becomes active. */
  async signInLocal(email: string, name: string | null): Promise<{ user: User; organization: Organization | null }> {
    const user = await this.deps.users.upsert({ workosUserId: `mock|${email}`, email, name });
    const organizations = await this.deps.memberships.listByUser(user.id);
    return { user, organization: organizations[0]?.organization ?? null };
  }

  /** Owner of the seeded demo organization, or null when it was not seeded. */
  async demoOwner(cnpj: string): Promise<{ user: User; organization: Organization } | null> {
    const organization = await this.deps.organizations.findByCnpj(cnpj);
    const owner = organization && (await this.deps.memberships.listByOrg(organization.id)).find((m) => m.role === "owner");
    return organization && owner ? { user: owner.user, organization } : null;
  }

  /** WorkOS events, recorded idempotently. */
  async recordIdentityEvent(id: string, event: unknown): Promise<void> {
    await this.deps.webhookEvents.recordOnce("workos", id, event);
  }
}
