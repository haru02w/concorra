import type { Db } from "@/infrastructure/db/client";
import { Prisma } from "@/infrastructure/db/generated/client";
import { json } from "@/infrastructure/db/json";

export interface StoredFile {
  id: string;
  organizationId: string | null;
  storageKey: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface FileRepository {
  create(data: Omit<StoredFile, "id">): Promise<StoredFile>;
  findById(id: string): Promise<StoredFile | null>;
  delete(id: string): Promise<void>;
}

export interface WebhookEventRepository {
  /** Returns the stored id, or null if this (provider, externalId) was already recorded. */
  recordOnce(provider: string, externalId: string, payload: unknown): Promise<string | null>;
  find(id: string): Promise<{ id: string; provider: string; payload: unknown; processedAt: Date | null } | null>;
  markProcessed(id: string): Promise<void>;
}

export interface KeyValueRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// ---------- Prisma ----------

export class PrismaFileRepository implements FileRepository {
  constructor(private db: Db) {}
  async create(data: Omit<StoredFile, "id">) {
    return this.db.file.create({ data, select: { id: true, organizationId: true, storageKey: true, name: true, mime: true, size: true, sha256: true } });
  }
  async findById(id: string) {
    return this.db.file.findUnique({ where: { id }, select: { id: true, organizationId: true, storageKey: true, name: true, mime: true, size: true, sha256: true } });
  }
  async delete(id: string) {
    await this.db.file.deleteMany({ where: { id } });
  }
}

export class PrismaWebhookEventRepository implements WebhookEventRepository {
  constructor(private db: Db) {}
  async recordOnce(provider: string, externalId: string, payload: unknown) {
    try {
      return (await this.db.webhookEvent.create({ data: { provider, externalId, payload: json(payload) } })).id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    }
  }
  async find(id: string) {
    return this.db.webhookEvent.findUnique({ where: { id }, select: { id: true, provider: true, payload: true, processedAt: true } });
  }
  async markProcessed(id: string) {
    await this.db.webhookEvent.update({ where: { id }, data: { processedAt: new Date() } });
  }
}

export class PrismaKeyValueRepository implements KeyValueRepository {
  constructor(private db: Db) {}
  async get(key: string) {
    return (await this.db.keyValue.findUnique({ where: { key } }))?.value ?? null;
  }
  async set(key: string, value: string) {
    await this.db.keyValue.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}
