import type { Notice, NoticeFile, NoticeItem, NoticePages } from "@/domain/notice/notice";
import { toPgVector } from "@/domain/shared/vector";
import type { Db } from "@/infrastructure/db/client";
import { Prisma } from "@/infrastructure/db/generated/client";
import { json } from "@/infrastructure/db/json";
import type * as M from "@/infrastructure/db/generated/client";

export type NoticeUpsert = Omit<Notice, "id" | "filesIngestedAt"> & { raw: unknown };

export interface NoticeSearch {
  query?: string;
  uf?: string;
  modalidadeId?: number;
  openOnly?: boolean;
  /** Rank by similarity to this organization's profile. */
  rankForOrganizationId?: string;
  page: number;
  pageSize: number;
}

export interface NoticeRepository {
  /** Insert or update by numeroControlePNCP; `changed` is false when updatedAtPncp did not move. */
  upsert(data: NoticeUpsert): Promise<{ notice: Notice; created: boolean; changed: boolean }>;
  findById(id: string): Promise<Notice | null>;
  findByControle(numeroControlePNCP: string): Promise<Notice | null>;
  listItems(noticeId: string): Promise<NoticeItem[]>;
  replaceItems(noticeId: string, items: NoticeItem[], embeddings: number[][] | null): Promise<void>;
  setEmbedding(noticeId: string, embedding: number[]): Promise<void>;
  /** Cosine similarity between notice and org profile embeddings, null if either is missing. */
  similarityToOrg(noticeId: string, organizationId: string): Promise<number | null>;
  search(params: NoticeSearch): Promise<{ rows: (Notice & { similarity: number | null })[]; total: number }>;
  markFilesIngested(noticeId: string, at: Date): Promise<void>;
}

export interface NoticeFileRepository {
  upsertMany(noticeId: string, files: Pick<NoticeFile, "sequencialDocumento" | "tipo" | "titulo" | "url">[]): Promise<NoticeFile[]>;
  listByNotice(noticeId: string): Promise<NoticeFile[]>;
  update(id: string, patch: Partial<Pick<NoticeFile, "storageKey" | "pageCount" | "ocr">>): Promise<void>;
  savePages(fileId: string, pages: string[]): Promise<void>;
  saveChunks(fileId: string, chunks: { page: number; text: string; embedding: number[] }[]): Promise<void>;
  loadPages(noticeId: string): Promise<NoticePages>;
  searchChunks(noticeId: string, embedding: number[], limit: number): Promise<{ fileId: string; page: number; text: string }[]>;
}

export interface PriceReference {
  descricao: string;
  unidade: string | null;
  quantidade: number | null;
  valorUnitario: number;
  orgaoNome: string | null;
  uf: string | null;
  data: Date | null;
  numeroControlePNCP: string;
  similarity: number;
}

export interface ContractItemUpsert {
  numeroControlePNCP: string;
  numeroItem: number;
  orgaoCnpj: string;
  orgaoNome: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number | null;
  valorUnitario: number;
  dataAssinatura: Date | null;
  uf: string | null;
}

export interface ContractItemRepository {
  upsertMany(items: ContractItemUpsert[], embeddings: number[][]): Promise<number>;
  similar(embedding: number[], limit: number): Promise<PriceReference[]>;
}

// ---------- Prisma ----------

export const toNotice = (r: Omit<M.Notice, "raw" | "createdAt" | "updatedAt"> & Partial<Pick<M.Notice, "raw">>): Notice => ({
  id: r.id,
  numeroControlePNCP: r.numeroControlePNCP,
  orgaoCnpj: r.orgaoCnpj,
  orgaoNome: r.orgaoNome,
  ano: r.ano,
  sequencial: r.sequencial,
  numeroCompra: r.numeroCompra,
  processo: r.processo,
  objeto: r.objeto,
  informacaoComplementar: r.informacaoComplementar,
  modalidadeId: r.modalidadeId,
  modalidadeNome: r.modalidadeNome,
  modoDisputa: r.modoDisputa,
  situacao: r.situacao,
  valorEstimado: r.valorEstimado,
  uf: r.uf,
  municipioIbge: r.municipioIbge,
  municipioNome: r.municipioNome,
  unidadeNome: r.unidadeNome,
  dataPublicacao: r.dataPublicacao,
  dataAbertura: r.dataAbertura,
  dataEncerramento: r.dataEncerramento,
  linkSistemaOrigem: r.linkSistemaOrigem,
  linkProcessoEletronico: r.linkProcessoEletronico,
  updatedAtPncp: r.updatedAtPncp,
  filesIngestedAt: r.filesIngestedAt,
});

export const NOTICE_SELECT = {
  id: true, numeroControlePNCP: true, orgaoCnpj: true, orgaoNome: true, ano: true, sequencial: true, numeroCompra: true,
  processo: true, objeto: true, informacaoComplementar: true, modalidadeId: true, modalidadeNome: true, modoDisputa: true,
  situacao: true, valorEstimado: true, uf: true, municipioIbge: true, municipioNome: true, unidadeNome: true,
  dataPublicacao: true, dataAbertura: true, dataEncerramento: true, linkSistemaOrigem: true, linkProcessoEletronico: true,
  updatedAtPncp: true, filesIngestedAt: true,
} satisfies Prisma.NoticeSelect;

export class PrismaNoticeRepository implements NoticeRepository {
  constructor(private db: Db) {}

  async upsert(data: NoticeUpsert) {
    const existing = await this.db.notice.findUnique({ where: { numeroControlePNCP: data.numeroControlePNCP }, select: { id: true, updatedAtPncp: true } });
    const { raw, ...fields } = data;
    if (!existing) {
      const r = await this.db.notice.create({ data: { ...fields, raw: json(raw) }, select: NOTICE_SELECT });
      return { notice: toNotice(r), created: true, changed: true };
    }
    const changed = existing.updatedAtPncp?.getTime() !== data.updatedAtPncp?.getTime();
    const r = await this.db.notice.update({ where: { id: existing.id }, data: changed ? { ...fields, raw: json(raw) } : {}, select: NOTICE_SELECT });
    return { notice: toNotice(r), created: false, changed };
  }
  async findById(id: string) {
    const r = await this.db.notice.findUnique({ where: { id }, select: NOTICE_SELECT });
    return r && toNotice(r);
  }
  async findByControle(numeroControlePNCP: string) {
    const r = await this.db.notice.findUnique({ where: { numeroControlePNCP }, select: NOTICE_SELECT });
    return r && toNotice(r);
  }
  async listItems(noticeId: string): Promise<NoticeItem[]> {
    return this.db.noticeItem.findMany({
      where: { noticeId },
      orderBy: { numeroItem: "asc" },
      select: { numeroItem: true, descricao: true, quantidade: true, unidade: true, valorUnitario: true, valorTotal: true },
    });
  }
  async replaceItems(noticeId: string, items: NoticeItem[], embeddings: number[][] | null) {
    await this.db.$transaction(async (tx) => {
      await tx.noticeItem.deleteMany({ where: { noticeId } });
      if (!items.length) return;
      await tx.noticeItem.createMany({ data: items.map((i) => ({ ...i, noticeId })) });
      if (embeddings) {
        for (const [idx, item] of items.entries()) {
          if (!embeddings[idx]) continue;
          await tx.$executeRaw`UPDATE "NoticeItem" SET embedding = ${toPgVector(embeddings[idx])}::vector WHERE "noticeId" = ${noticeId} AND "numeroItem" = ${item.numeroItem}`;
        }
      }
    });
  }
  async setEmbedding(noticeId: string, embedding: number[]) {
    await this.db.$executeRaw`UPDATE "Notice" SET embedding = ${toPgVector(embedding)}::vector WHERE id = ${noticeId}`;
  }
  async similarityToOrg(noticeId: string, organizationId: string) {
    const rows = await this.db.$queryRaw<{ similarity: number | null }[]>`
      SELECT 1 - (n.embedding <=> o."profileEmbedding") AS similarity
      FROM "Notice" n, "Organization" o
      WHERE n.id = ${noticeId} AND o.id = ${organizationId}
        AND n.embedding IS NOT NULL AND o."profileEmbedding" IS NOT NULL`;
    return rows[0]?.similarity ?? null;
  }
  async search(params: NoticeSearch) {
    const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (params.query?.trim()) {
      where.push(Prisma.sql`to_tsvector('portuguese', n.objeto) @@ websearch_to_tsquery('portuguese', ${params.query.trim()})`);
    }
    if (params.uf) where.push(Prisma.sql`n.uf = ${params.uf}`);
    if (params.modalidadeId) where.push(Prisma.sql`n."modalidadeId" = ${params.modalidadeId}`);
    if (params.openOnly) where.push(Prisma.sql`n."dataEncerramento" > now()`);
    const condition = Prisma.join(where, " AND ");
    const orgId = params.rankForOrganizationId ?? null;
    const offset = (params.page - 1) * params.pageSize;
    const rows = await this.db.$queryRaw<(Notice & { similarity: number | null })[]>`
      SELECT n.id, n."numeroControlePNCP", n."orgaoCnpj", n."orgaoNome", n.ano, n.sequencial, n."numeroCompra", n.processo,
             n.objeto, n."informacaoComplementar", n."modalidadeId", n."modalidadeNome", n."modoDisputa", n.situacao,
             n."valorEstimado", n.uf, n."municipioIbge", n."municipioNome", n."unidadeNome", n."dataPublicacao",
             n."dataAbertura", n."dataEncerramento", n."linkSistemaOrigem", n."linkProcessoEletronico", n."updatedAtPncp",
             n."filesIngestedAt",
             CASE WHEN n.embedding IS NOT NULL AND o."profileEmbedding" IS NOT NULL
                  THEN 1 - (n.embedding <=> o."profileEmbedding") END AS similarity
      FROM "Notice" n LEFT JOIN "Organization" o ON o.id = ${orgId}
      WHERE ${condition}
      ORDER BY similarity DESC NULLS LAST, n."dataPublicacao" DESC NULLS LAST
      LIMIT ${params.pageSize} OFFSET ${offset}`;
    const [{ count }] = await this.db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "Notice" n WHERE ${condition}`;
    return { rows: rows.map((r) => ({ ...toNotice(r), similarity: r.similarity })), total: Number(count) };
  }
  async markFilesIngested(noticeId: string, at: Date) {
    await this.db.notice.update({ where: { id: noticeId }, data: { filesIngestedAt: at } });
  }
}

export class PrismaNoticeFileRepository implements NoticeFileRepository {
  constructor(private db: Db) {}
  async upsertMany(noticeId: string, files: Pick<NoticeFile, "sequencialDocumento" | "tipo" | "titulo" | "url">[]) {
    const out: NoticeFile[] = [];
    for (const f of files) {
      out.push(
        await this.db.noticeFile.upsert({
          where: { noticeId_sequencialDocumento: { noticeId, sequencialDocumento: f.sequencialDocumento } },
          create: { ...f, noticeId },
          update: { tipo: f.tipo, titulo: f.titulo, url: f.url },
        }),
      );
    }
    return out;
  }
  async listByNotice(noticeId: string) {
    return this.db.noticeFile.findMany({ where: { noticeId }, orderBy: { sequencialDocumento: "asc" } });
  }
  async update(id: string, patch: Partial<Pick<NoticeFile, "storageKey" | "pageCount" | "ocr">>) {
    await this.db.noticeFile.update({ where: { id }, data: patch });
  }
  async savePages(fileId: string, pages: string[]) {
    await this.db.$transaction([
      this.db.noticePage.deleteMany({ where: { noticeFileId: fileId } }),
      this.db.noticePage.createMany({ data: pages.map((text, i) => ({ noticeFileId: fileId, page: i + 1, text: text.replaceAll("\u0000", "") })) }),
    ]);
  }
  async saveChunks(fileId: string, chunks: { page: number; text: string; embedding: number[] }[]) {
    await this.db.$transaction(async (tx) => {
      await tx.noticeChunk.deleteMany({ where: { noticeFileId: fileId } });
      for (const c of chunks) {
        await tx.$executeRaw`INSERT INTO "NoticeChunk" (id, "noticeFileId", page, text, embedding)
          VALUES (${crypto.randomUUID()}, ${fileId}, ${c.page}, ${c.text.replaceAll("\u0000", "")}, ${toPgVector(c.embedding)}::vector)`;
      }
    });
  }
  async loadPages(noticeId: string) {
    const rows = await this.db.noticePage.findMany({ where: { file: { noticeId } }, orderBy: [{ noticeFileId: "asc" }, { page: "asc" }] });
    const out = new Map<string, string[]>();
    for (const r of rows) {
      const pages = out.get(r.noticeFileId) ?? [];
      pages[r.page - 1] = r.text;
      out.set(r.noticeFileId, pages);
    }
    return out;
  }
  async searchChunks(noticeId: string, embedding: number[], limit: number) {
    return this.db.$queryRaw<{ fileId: string; page: number; text: string }[]>`
      SELECT c."noticeFileId" AS "fileId", c.page, c.text
      FROM "NoticeChunk" c JOIN "NoticeFile" f ON f.id = c."noticeFileId"
      WHERE f."noticeId" = ${noticeId} AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${toPgVector(embedding)}::vector
      LIMIT ${limit}`;
  }
}

export class PrismaContractItemRepository implements ContractItemRepository {
  constructor(private db: Db) {}
  async upsertMany(items: ContractItemUpsert[], embeddings: number[][]) {
    let count = 0;
    for (const [i, item] of items.entries()) {
      await this.db.$executeRaw`
        INSERT INTO "ContractItem" (id, "numeroControlePNCP", "numeroItem", "orgaoCnpj", "orgaoNome", descricao, unidade,
          quantidade, "valorUnitario", "dataAssinatura", uf, embedding)
        VALUES (${crypto.randomUUID()}, ${item.numeroControlePNCP}, ${item.numeroItem}, ${item.orgaoCnpj}, ${item.orgaoNome},
          ${item.descricao}, ${item.unidade}, ${item.quantidade}, ${item.valorUnitario}, ${item.dataAssinatura}, ${item.uf},
          ${toPgVector(embeddings[i])}::vector)
        ON CONFLICT ("numeroControlePNCP", "numeroItem") DO UPDATE SET
          descricao = EXCLUDED.descricao, "valorUnitario" = EXCLUDED."valorUnitario", embedding = EXCLUDED.embedding`;
      count++;
    }
    return count;
  }
  async similar(embedding: number[], limit: number): Promise<PriceReference[]> {
    const rows = await this.db.$queryRaw<(Omit<PriceReference, "data"> & { dataAssinatura: Date | null })[]>`
      SELECT descricao, unidade, quantidade, "valorUnitario", "orgaoNome", uf, "dataAssinatura", "numeroControlePNCP",
             1 - (embedding <=> ${toPgVector(embedding)}::vector) AS similarity
      FROM "ContractItem" WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${toPgVector(embedding)}::vector
      LIMIT ${limit}`;
    return rows.map(({ dataAssinatura, ...r }) => ({ ...r, data: dataAssinatura }));
  }
}
