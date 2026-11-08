import type { Experience } from "@/domain/organization/organization";
import { toPgVector } from "@/domain/shared/vector";
import type { Db } from "@/infrastructure/db/client";
import type * as M from "@/infrastructure/db/generated/client";

export interface ExperienceRepository {
  create(data: Omit<Experience, "id">): Promise<Experience>;
  update(id: string, patch: Partial<Omit<Experience, "id" | "organizationId">>, embedding?: number[]): Promise<Experience>;
  findById(organizationId: string, id: string): Promise<Experience | null>;
  listByOrg(organizationId: string): Promise<Experience[]>;
  delete(organizationId: string, id: string): Promise<void>;
}

// ---------- Prisma ----------

export const toExperience = (r: M.Experience): Experience => ({
  id: r.id,
  organizationId: r.organizationId,
  fileId: r.fileId,
  issuer: r.issuer,
  object: r.object,
  quantities: r.quantities,
  periodStart: r.periodStart,
  periodEnd: r.periodEnd,
});

export class PrismaExperienceRepository implements ExperienceRepository {
  constructor(private db: Db) {}
  async create(data: Omit<Experience, "id">) {
    return toExperience(await this.db.experience.create({ data }));
  }
  async update(id: string, patch: Partial<Omit<Experience, "id" | "organizationId">>, embedding?: number[]) {
    const r = await this.db.experience.update({ where: { id }, data: patch });
    if (embedding) await this.db.$executeRaw`UPDATE "Experience" SET embedding = ${toPgVector(embedding)}::vector WHERE id = ${id}`;
    return toExperience(r);
  }
  async findById(organizationId: string, id: string) {
    const r = await this.db.experience.findFirst({ where: { id, organizationId } });
    return r && toExperience(r);
  }
  async listByOrg(organizationId: string) {
    return (await this.db.experience.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } })).map(toExperience);
  }
  async delete(organizationId: string, id: string) {
    await this.db.experience.deleteMany({ where: { id, organizationId } });
  }
}
