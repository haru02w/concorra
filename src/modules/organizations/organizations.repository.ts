import type { PlanId } from "@/domain/billing/plans";
import type { Organization, Porte, Role } from "@/domain/organization/organization";
import { toPgVector } from "@/domain/shared/vector";
import type { Db } from "@/infrastructure/db/client";
import type * as M from "@/infrastructure/db/generated/client";

export interface User {
  id: string;
  workosUserId: string;
  email: string;
  name: string | null;
}

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  findByWorkosOrgId(workosOrgId: string): Promise<Organization | null>;
  findByCnpj(cnpj: string): Promise<Organization | null>;
  create(data: Omit<Organization, "id">): Promise<Organization>;
  update(id: string, patch: Partial<Omit<Organization, "id" | "workosOrgId">>): Promise<Organization>;
  setProfileEmbedding(id: string, embedding: number[]): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface UserRepository {
  upsert(data: Omit<User, "id">): Promise<User>;
  findById(id: string): Promise<User | null>;
}

export interface MembershipRepository {
  upsert(organizationId: string, userId: string, role: Role): Promise<void>;
  find(organizationId: string, userId: string): Promise<{ role: Role } | null>;
  listByUser(userId: string): Promise<{ organization: Organization; role: Role }[]>;
  listByOrg(organizationId: string): Promise<{ user: User; role: Role }[]>;
  count(organizationId: string): Promise<number>;
}

// ---------- Prisma ----------

export const toOrg = (r: M.Organization): Organization => ({
  id: r.id,
  workosOrgId: r.workosOrgId,
  cnpj: r.cnpj,
  razaoSocial: r.razaoSocial,
  nomeFantasia: r.nomeFantasia,
  porte: r.porte as Porte,
  cnaePrincipal: r.cnaePrincipal,
  cnaesSecundarios: r.cnaesSecundarios,
  endereco: r.endereco,
  municipio: r.municipio,
  uf: r.uf,
  representante: r.representante,
  ufs: r.ufs,
  municipios: r.municipios,
  valueMin: r.valueMin,
  valueMax: r.valueMax,
  expertiseText: r.expertiseText,
  planId: r.planId as PlanId,
});

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private db: Db) {}
  async findById(id: string) {
    const r = await this.db.organization.findUnique({ where: { id } });
    return r && toOrg(r);
  }
  async findByWorkosOrgId(workosOrgId: string) {
    const r = await this.db.organization.findUnique({ where: { workosOrgId } });
    return r && toOrg(r);
  }
  async findByCnpj(cnpj: string) {
    const r = await this.db.organization.findUnique({ where: { cnpj } });
    return r && toOrg(r);
  }
  async create(data: Omit<Organization, "id">) {
    return toOrg(await this.db.organization.create({ data }));
  }
  async update(id: string, patch: Partial<Omit<Organization, "id" | "workosOrgId">>) {
    return toOrg(await this.db.organization.update({ where: { id }, data: patch }));
  }
  async setProfileEmbedding(id: string, embedding: number[]) {
    await this.db.$executeRaw`UPDATE "Organization" SET "profileEmbedding" = ${toPgVector(embedding)}::vector WHERE id = ${id}`;
  }
  async delete(id: string) {
    await this.db.organization.delete({ where: { id } });
  }
}

export class PrismaUserRepository implements UserRepository {
  constructor(private db: Db) {}
  async upsert(data: Omit<User, "id">) {
    return this.db.user.upsert({
      where: { workosUserId: data.workosUserId },
      create: data,
      update: { email: data.email, name: data.name },
      select: { id: true, workosUserId: true, email: true, name: true },
    });
  }
  async findById(id: string) {
    return this.db.user.findUnique({ where: { id }, select: { id: true, workosUserId: true, email: true, name: true } });
  }
}

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private db: Db) {}
  async upsert(organizationId: string, userId: string, role: Role) {
    await this.db.membership.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId, role },
      update: { role },
    });
  }
  async find(organizationId: string, userId: string) {
    const r = await this.db.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    return r && { role: r.role as Role };
  }
  async listByUser(userId: string) {
    const rows = await this.db.membership.findMany({ where: { userId }, include: { organization: true }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ organization: toOrg(r.organization), role: r.role as Role }));
  }
  async listByOrg(organizationId: string) {
    const rows = await this.db.membership.findMany({ where: { organizationId }, include: { user: true }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ user: { id: r.user.id, workosUserId: r.user.workosUserId, email: r.user.email, name: r.user.name }, role: r.role as Role }));
  }
  async count(organizationId: string) {
    return this.db.membership.count({ where: { organizationId } });
  }
}
