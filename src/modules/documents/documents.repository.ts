import type { DocumentCheck, DocumentKind, DocumentStatus, VaultDocument } from "@/domain/documents/document";
import type { Db } from "@/infrastructure/db/client";
import { Prisma } from "@/infrastructure/db/generated/client";
import { json, jsonOrNull } from "@/infrastructure/db/json";
import type * as M from "@/infrastructure/db/generated/client";

export interface DocumentRepository {
  create(data: Omit<VaultDocument, "id" | "fileName"> & { extracted?: unknown }): Promise<VaultDocument>;
  findById(organizationId: string, id: string): Promise<VaultDocument | null>;
  findByIdUnscoped(id: string): Promise<VaultDocument | null>;
  update(
    id: string,
    patch: Partial<{ kind: DocumentKind; issuer: string | null; cnpj: string | null; issuedAt: Date | null; validUntil: Date | null; status: DocumentStatus; checks: DocumentCheck[]; extracted: unknown; expiryNotifiedAt: Date | null }>,
  ): Promise<VaultDocument>;
  listByOrg(organizationId: string): Promise<VaultDocument[]>;
  /** Documents expiring before `before` that were not notified yet. */
  listExpiringUnnotified(before: Date): Promise<VaultDocument[]>;
  delete(organizationId: string, id: string): Promise<void>;
}

// ---------- Prisma ----------

export const toDocument = (r: M.Document & { file: { name: string } }): VaultDocument => ({
  id: r.id,
  organizationId: r.organizationId,
  kind: r.kind as DocumentKind,
  fileId: r.fileId,
  fileName: r.file.name,
  issuer: r.issuer,
  cnpj: r.cnpj,
  issuedAt: r.issuedAt,
  validUntil: r.validUntil,
  status: r.status as DocumentStatus,
  checks: r.checks as unknown as DocumentCheck[],
});

export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private db: Db) {}
  private include = { file: { select: { name: true } } } as const;
  async create(data: Omit<VaultDocument, "id" | "fileName"> & { extracted?: unknown }) {
    const r = await this.db.document.create({
      data: { ...data, checks: json(data.checks), extracted: jsonOrNull(data.extracted) },
      include: this.include,
    });
    return toDocument(r);
  }
  async findById(organizationId: string, id: string) {
    const r = await this.db.document.findFirst({ where: { id, organizationId }, include: this.include });
    return r && toDocument(r);
  }
  async findByIdUnscoped(id: string) {
    const r = await this.db.document.findUnique({ where: { id }, include: this.include });
    return r && toDocument(r);
  }
  async update(id: string, patch: Parameters<DocumentRepository["update"]>[1]) {
    const data: Prisma.DocumentUpdateInput = {
      ...patch,
      checks: patch.checks ? json(patch.checks) : undefined,
      extracted: patch.extracted === undefined ? undefined : jsonOrNull(patch.extracted),
    };
    return toDocument(await this.db.document.update({ where: { id }, data, include: this.include }));
  }
  async listByOrg(organizationId: string) {
    return (await this.db.document.findMany({ where: { organizationId }, include: this.include, orderBy: { createdAt: "desc" } })).map(toDocument);
  }
  async listExpiringUnnotified(before: Date) {
    const rows = await this.db.document.findMany({
      where: { validUntil: { lt: before }, expiryNotifiedAt: null, status: { notIn: ["invalid", "pending"] } },
      include: this.include,
    });
    return rows.map(toDocument);
  }
  async delete(organizationId: string, id: string) {
    await this.db.document.deleteMany({ where: { id, organizationId } });
  }
}
