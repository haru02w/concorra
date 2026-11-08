import type * as P from "@/application/ports";
import type { DocumentGap } from "@/domain/analysis/gaps";
import type { NoticeExtraction } from "@/domain/analysis/extraction";
import type { Recommendation, ScoreFactor } from "@/domain/analysis/score";
import type { Bid, GeneratedDocument, PackStepKey, VerificationIssue } from "@/domain/bid/bid";
import type { ProposalLine } from "@/domain/bid/templates";
import type { CalendarRefType } from "@/domain/calendar/deadlines";
import type { DocumentCheck, DocumentKind, DocumentStatus, VaultDocument } from "@/domain/documents/document";
import type { Notice, NoticeFile, NoticeItem } from "@/domain/notice/notice";
import type { Experience, Organization, Porte, Role } from "@/domain/organization/organization";
import type { Rule, RuleFilters } from "@/domain/rules/rule";
import type { PlanId } from "@/domain/billing/plans";
import { toPgVector } from "@/domain/shared/vector";
import type { Db } from "./client";
import { Prisma } from "./generated/client";
import type * as M from "./generated/client";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const jsonOrNull = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

// ---------- mappers ----------

const toOrg = (r: M.Organization): Organization => ({
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

const toNotice = (r: Omit<M.Notice, "raw" | "createdAt" | "updatedAt"> & Partial<Pick<M.Notice, "raw">>): Notice => ({
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

const NOTICE_SELECT = {
  id: true, numeroControlePNCP: true, orgaoCnpj: true, orgaoNome: true, ano: true, sequencial: true, numeroCompra: true,
  processo: true, objeto: true, informacaoComplementar: true, modalidadeId: true, modalidadeNome: true, modoDisputa: true,
  situacao: true, valorEstimado: true, uf: true, municipioIbge: true, municipioNome: true, unidadeNome: true,
  dataPublicacao: true, dataAbertura: true, dataEncerramento: true, linkSistemaOrigem: true, linkProcessoEletronico: true,
  updatedAtPncp: true, filesIngestedAt: true,
} satisfies Prisma.NoticeSelect;

const toRule = (r: M.Rule): Rule => ({
  id: r.id,
  organizationId: r.organizationId,
  name: r.name,
  filters: r.filters as unknown as RuleFilters,
  semanticThreshold: r.semanticThreshold,
  minScore: r.minScore,
  channels: r.channels as Rule["channels"],
  frequency: r.frequency as Rule["frequency"],
  active: r.active,
});

const toMatch = (r: M.Match): P.Match => ({
  id: r.id,
  ruleId: r.ruleId,
  noticeId: r.noticeId,
  organizationId: r.organizationId,
  similarity: r.similarity,
  status: r.status as P.MatchStatus,
  frequency: r.frequency as P.Match["frequency"],
  channels: r.channels as P.Match["channels"],
  minScore: r.minScore,
  createdAt: r.createdAt,
  notifiedAt: r.notifiedAt,
});

const toAnalysis = (r: M.Analysis): P.Analysis => ({
  id: r.id,
  organizationId: r.organizationId,
  noticeId: r.noticeId,
  status: r.status as P.AnalysisStatus,
  extraction: r.extraction as unknown as NoticeExtraction | null,
  citationReport: r.citationReport as P.Analysis["citationReport"],
  score: r.score,
  scoreFactors: r.scoreFactors as unknown as ScoreFactor[] | null,
  gaps: r.gaps as unknown as DocumentGap[] | null,
  recommendation: r.recommendation as Recommendation | null,
  recommendationReasons: r.recommendationReasons as string[] | null,
  cnaeCompatible: r.cnaeCompatible,
  model: r.model,
  error: r.error,
  noticeVersion: r.noticeVersion,
  createdAt: r.createdAt,
});

const toBid = (r: M.Bid): Bid => ({
  id: r.id,
  organizationId: r.organizationId,
  noticeId: r.noticeId,
  analysisId: r.analysisId,
  status: r.status as Bid["status"],
  skipReason: r.skipReason,
  packStatus: r.packStatus as Bid["packStatus"],
  packSteps: r.packSteps as PackStepKey[],
  packError: r.packError,
});

const toGenerated = (r: M.GeneratedDocument): GeneratedDocument & { key: string } => ({
  id: r.id,
  bidId: r.bidId,
  key: r.key,
  kind: r.kind as GeneratedDocument["kind"],
  title: r.title,
  markdown: r.markdown,
  aiSlots: r.aiSlots as Record<string, string>,
  status: r.status as GeneratedDocument["status"],
  verification: r.verification as unknown as VerificationIssue[],
  docxFileId: r.docxFileId,
  pdfFileId: r.pdfFileId,
});

const toDocument = (r: M.Document & { file: { name: string } }): VaultDocument => ({
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

const toExperience = (r: M.Experience): Experience => ({
  id: r.id,
  organizationId: r.organizationId,
  fileId: r.fileId,
  issuer: r.issuer,
  object: r.object,
  quantities: r.quantities,
  periodStart: r.periodStart,
  periodEnd: r.periodEnd,
});

const toConnection = (r: M.CalendarConnection): P.CalendarConnection => ({
  id: r.id,
  userId: r.userId,
  organizationId: r.organizationId,
  provider: r.provider as P.CalendarProviderId,
  accessToken: r.accessToken,
  refreshToken: r.refreshToken,
  expiresAt: r.expiresAt,
  calendarId: r.calendarId,
  email: r.email,
});

const toSubscription = (r: M.Subscription): P.Subscription => ({
  organizationId: r.organizationId,
  planId: r.planId as PlanId,
  pendingPlanId: r.pendingPlanId as PlanId | null,
  status: r.status as P.SubscriptionStatus,
  customerRef: r.customerRef,
  checkoutRef: r.checkoutRef,
  subscriptionRef: r.subscriptionRef,
  currentPeriodEnd: r.currentPeriodEnd,
});

const toNotification = (r: M.Notification): P.Notification => ({
  id: r.id,
  organizationId: r.organizationId,
  userId: r.userId,
  type: r.type as P.NotificationType,
  title: r.title,
  body: r.body,
  link: r.link,
  readAt: r.readAt,
  createdAt: r.createdAt,
});

// ---------- repositories ----------

export class PrismaOrganizationRepository implements P.OrganizationRepository {
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

export class PrismaUserRepository implements P.UserRepository {
  constructor(private db: Db) {}
  async upsert(data: Omit<P.User, "id">) {
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

export class PrismaMembershipRepository implements P.MembershipRepository {
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

export class PrismaExperienceRepository implements P.ExperienceRepository {
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

export class PrismaNoticeRepository implements P.NoticeRepository {
  constructor(private db: Db) {}

  async upsert(data: P.NoticeUpsert) {
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
  async search(params: P.NoticeSearch) {
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

export class PrismaNoticeFileRepository implements P.NoticeFileRepository {
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

export class PrismaContractItemRepository implements P.ContractItemRepository {
  constructor(private db: Db) {}
  async upsertMany(items: P.ContractItemUpsert[], embeddings: number[][]) {
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
  async similar(embedding: number[], limit: number): Promise<P.PriceReference[]> {
    const rows = await this.db.$queryRaw<(Omit<P.PriceReference, "data"> & { dataAssinatura: Date | null })[]>`
      SELECT descricao, unidade, quantidade, "valorUnitario", "orgaoNome", uf, "dataAssinatura", "numeroControlePNCP",
             1 - (embedding <=> ${toPgVector(embedding)}::vector) AS similarity
      FROM "ContractItem" WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${toPgVector(embedding)}::vector
      LIMIT ${limit}`;
    return rows.map(({ dataAssinatura, ...r }) => ({ ...r, data: dataAssinatura }));
  }
}

export class PrismaRuleRepository implements P.RuleRepository {
  constructor(private db: Db) {}
  async create(data: Omit<Rule, "id">) {
    return toRule(await this.db.rule.create({ data: { ...data, filters: json(data.filters) } }));
  }
  async update(organizationId: string, id: string, patch: Partial<Omit<Rule, "id" | "organizationId">>) {
    await this.db.rule.updateMany({ where: { id, organizationId }, data: { ...patch, filters: patch.filters ? json(patch.filters) : undefined } });
    return toRule(await this.db.rule.findUniqueOrThrow({ where: { id } }));
  }
  async delete(organizationId: string, id: string) {
    await this.db.rule.deleteMany({ where: { id, organizationId } });
  }
  async findById(organizationId: string, id: string) {
    const r = await this.db.rule.findFirst({ where: { id, organizationId } });
    return r && toRule(r);
  }
  async listByOrg(organizationId: string) {
    return (await this.db.rule.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } })).map(toRule);
  }
  async countActive(organizationId: string) {
    return this.db.rule.count({ where: { organizationId, active: true } });
  }
  async listActive() {
    return (await this.db.rule.findMany({ where: { active: true } })).map(toRule);
  }
}

export class PrismaMatchRepository implements P.MatchRepository {
  constructor(private db: Db) {}
  async createIfAbsent(data: Omit<P.Match, "id" | "createdAt" | "notifiedAt">) {
    try {
      return toMatch(await this.db.match.create({ data }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    }
  }
  async listByIds(ids: string[]) {
    return (await this.db.match.findMany({ where: { id: { in: ids } } })).map(toMatch);
  }
  async listForDigest() {
    return (await this.db.match.findMany({ where: { status: "notify", frequency: "daily" } })).map(toMatch);
  }
  async listPendingScore(organizationId: string, noticeId: string) {
    return (await this.db.match.findMany({ where: { organizationId, noticeId, status: "pending_score" } })).map(toMatch);
  }
  async setStatus(ids: string[], status: P.MatchStatus, notifiedAt?: Date) {
    if (!ids.length) return;
    await this.db.match.updateMany({ where: { id: { in: ids } }, data: { status, ...(notifiedAt ? { notifiedAt } : {}) } });
  }
  async listByOrg(organizationId: string, limit: number) {
    const rows = await this.db.match.findMany({
      where: { organizationId, status: { not: "discarded" } },
      include: { notice: { select: NOTICE_SELECT }, rule: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({ ...toMatch(r), notice: toNotice(r.notice), ruleName: r.rule.name }));
  }
}

export class PrismaAnalysisRepository implements P.AnalysisRepository {
  constructor(private db: Db) {}
  async create(data: Pick<P.Analysis, "organizationId" | "noticeId" | "status" | "noticeVersion">) {
    return toAnalysis(await this.db.analysis.create({ data }));
  }
  async update(id: string, patch: Partial<Omit<P.Analysis, "id" | "organizationId" | "noticeId" | "createdAt">>) {
    const data: Prisma.AnalysisUpdateInput = {
      ...patch,
      extraction: patch.extraction === undefined ? undefined : jsonOrNull(patch.extraction),
      citationReport: patch.citationReport === undefined ? undefined : jsonOrNull(patch.citationReport),
      scoreFactors: patch.scoreFactors === undefined ? undefined : jsonOrNull(patch.scoreFactors),
      gaps: patch.gaps === undefined ? undefined : jsonOrNull(patch.gaps),
      recommendationReasons: patch.recommendationReasons === undefined ? undefined : jsonOrNull(patch.recommendationReasons),
    };
    return toAnalysis(await this.db.analysis.update({ where: { id }, data }));
  }
  async findById(id: string) {
    const r = await this.db.analysis.findUnique({ where: { id } });
    return r && toAnalysis(r);
  }
  async findLatest(organizationId: string, noticeId: string) {
    const r = await this.db.analysis.findFirst({ where: { organizationId, noticeId }, orderBy: { createdAt: "desc" } });
    return r && toAnalysis(r);
  }
  async listByOrg(organizationId: string, limit: number) {
    return (await this.db.analysis.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: limit })).map(toAnalysis);
  }
}

export class PrismaBidRepository implements P.BidRepository {
  constructor(private db: Db) {}
  async create(data: Omit<Bid, "id" | "packStatus" | "packSteps" | "packError">) {
    return toBid(await this.db.bid.create({ data }));
  }
  async findById(organizationId: string, id: string) {
    const r = await this.db.bid.findFirst({ where: { id, organizationId } });
    return r && toBid(r);
  }
  async findByIdUnscoped(id: string) {
    const r = await this.db.bid.findUnique({ where: { id } });
    return r && toBid(r);
  }
  async findByNotice(organizationId: string, noticeId: string) {
    const r = await this.db.bid.findUnique({ where: { organizationId_noticeId: { organizationId, noticeId } } });
    return r && toBid(r);
  }
  async update(id: string, patch: Partial<Omit<Bid, "id" | "organizationId" | "noticeId">>) {
    return toBid(await this.db.bid.update({ where: { id }, data: patch }));
  }
  async completeStep(id: string, step: PackStepKey) {
    await this.db.$transaction(async (tx) => {
      const bid = await tx.bid.findUniqueOrThrow({ where: { id }, select: { packSteps: true } });
      if (!bid.packSteps.includes(step)) await tx.bid.update({ where: { id }, data: { packSteps: { push: step } } });
    });
  }
  async listByOrg(organizationId: string) {
    const rows = await this.db.bid.findMany({ where: { organizationId }, include: { notice: { select: NOTICE_SELECT } }, orderBy: { updatedAt: "desc" } });
    return rows.map((r) => ({ ...toBid(r), notice: toNotice(r.notice) }));
  }
  private async field<T>(id: string, key: "proposalLines" | "priceReferences" | "checklist"): Promise<T> {
    const r = await this.db.bid.findUniqueOrThrow({ where: { id }, select: { [key]: true } as Record<typeof key, true> });
    return (r as Record<string, unknown>)[key] as T;
  }
  async getProposalLines(bidId: string) {
    return this.field<ProposalLine[]>(bidId, "proposalLines");
  }
  async saveProposalLines(bidId: string, lines: ProposalLine[]) {
    await this.db.bid.update({ where: { id: bidId }, data: { proposalLines: json(lines) } });
  }
  async savePriceReferences(bidId: string, refs: Record<number, P.PriceReference[]>) {
    await this.db.bid.update({ where: { id: bidId }, data: { priceReferences: json(refs) } });
  }
  async getPriceReferences(bidId: string) {
    return this.field<Record<number, P.PriceReference[]>>(bidId, "priceReferences");
  }
  async saveChecklist(bidId: string, gaps: DocumentGap[]) {
    await this.db.bid.update({ where: { id: bidId }, data: { checklist: json(gaps) } });
  }
  async getChecklist(bidId: string) {
    return this.field<DocumentGap[]>(bidId, "checklist");
  }
}

export class PrismaGeneratedDocumentRepository implements P.GeneratedDocumentRepository {
  constructor(private db: Db) {}
  async upsert(bidId: string, key: string, data: Omit<GeneratedDocument, "id" | "bidId">) {
    const fields = { ...data, aiSlots: json(data.aiSlots), verification: json(data.verification) };
    return toGenerated(
      await this.db.generatedDocument.upsert({ where: { bidId_key: { bidId, key } }, create: { ...fields, bidId, key }, update: fields }),
    );
  }
  async listByBid(bidId: string) {
    return (await this.db.generatedDocument.findMany({ where: { bidId }, orderBy: { createdAt: "asc" } })).map(toGenerated);
  }
  async findById(id: string) {
    const r = await this.db.generatedDocument.findUnique({ where: { id } });
    return r && toGenerated(r);
  }
  async update(id: string, patch: Partial<Omit<GeneratedDocument, "id" | "bidId">>) {
    const data: Prisma.GeneratedDocumentUpdateInput = {
      ...patch,
      aiSlots: patch.aiSlots ? json(patch.aiSlots) : undefined,
      verification: patch.verification ? json(patch.verification) : undefined,
    };
    return toGenerated(await this.db.generatedDocument.update({ where: { id }, data }));
  }
}

export class PrismaDocumentRepository implements P.DocumentRepository {
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
  async update(id: string, patch: Parameters<P.DocumentRepository["update"]>[1]) {
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

export class PrismaFileRepository implements P.FileRepository {
  constructor(private db: Db) {}
  async create(data: Omit<P.StoredFile, "id">) {
    return this.db.file.create({ data, select: { id: true, organizationId: true, storageKey: true, name: true, mime: true, size: true, sha256: true } });
  }
  async findById(id: string) {
    return this.db.file.findUnique({ where: { id }, select: { id: true, organizationId: true, storageKey: true, name: true, mime: true, size: true, sha256: true } });
  }
  async delete(id: string) {
    await this.db.file.deleteMany({ where: { id } });
  }
}

export class PrismaCalendarRepository implements P.CalendarRepository {
  constructor(private db: Db) {}
  async upsertConnection(data: Omit<P.CalendarConnection, "id">) {
    return toConnection(
      await this.db.calendarConnection.upsert({
        where: { userId_organizationId_provider: { userId: data.userId, organizationId: data.organizationId, provider: data.provider } },
        create: data,
        update: data,
      }),
    );
  }
  async updateTokens(id: string, tokens: Pick<P.CalendarConnection, "accessToken" | "refreshToken" | "expiresAt">) {
    await this.db.calendarConnection.update({ where: { id }, data: tokens });
  }
  async listByOrg(organizationId: string) {
    return (await this.db.calendarConnection.findMany({ where: { organizationId } })).map(toConnection);
  }
  async listByUser(userId: string, organizationId: string) {
    return (await this.db.calendarConnection.findMany({ where: { userId, organizationId } })).map(toConnection);
  }
  async deleteConnection(userId: string, id: string) {
    await this.db.calendarConnection.deleteMany({ where: { id, userId } });
  }
  async findEvent(connectionId: string, key: string) {
    return this.db.calendarEvent.findUnique({ where: { connectionId_key: { connectionId, key } }, select: { id: true, externalId: true } });
  }
  async saveEvent(data: { connectionId: string; key: string; refType: CalendarRefType; refId: string; externalId: string }) {
    await this.db.calendarEvent.upsert({
      where: { connectionId_key: { connectionId: data.connectionId, key: data.key } },
      create: data,
      update: { externalId: data.externalId },
    });
  }
  async listEventsByRef(refType: CalendarRefType, refId: string) {
    return this.db.calendarEvent.findMany({ where: { refType, refId }, select: { id: true, connectionId: true, key: true, externalId: true } });
  }
  async deleteEvent(id: string) {
    await this.db.calendarEvent.deleteMany({ where: { id } });
  }
}

export class PrismaNotificationRepository implements P.NotificationRepository {
  constructor(private db: Db) {}
  async create(data: Omit<P.Notification, "id" | "readAt" | "createdAt">) {
    return toNotification(await this.db.notification.create({ data }));
  }
  async listForUser(organizationId: string, userId: string, limit: number) {
    const rows = await this.db.notification.findMany({
      where: { organizationId, OR: [{ userId }, { userId: null }] },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toNotification);
  }
  async countUnread(organizationId: string, userId: string) {
    return this.db.notification.count({ where: { organizationId, readAt: null, OR: [{ userId }, { userId: null }] } });
  }
  async markRead(organizationId: string, userId: string, ids: string[] | "all") {
    await this.db.notification.updateMany({
      where: { organizationId, userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
      data: { readAt: new Date() },
    });
  }
}

export class PrismaSubscriptionRepository implements P.SubscriptionRepository {
  constructor(private db: Db) {}
  async findByOrg(organizationId: string) {
    const r = await this.db.subscription.findUnique({ where: { organizationId } });
    return r && toSubscription(r);
  }
  async findByCheckoutRef(checkoutRef: string) {
    const r = await this.db.subscription.findFirst({ where: { checkoutRef } });
    return r && toSubscription(r);
  }
  async findBySubscriptionRef(subscriptionRef: string) {
    const r = await this.db.subscription.findFirst({ where: { subscriptionRef } });
    return r && toSubscription(r);
  }
  async upsert(data: P.Subscription) {
    return toSubscription(await this.db.subscription.upsert({ where: { organizationId: data.organizationId }, create: data, update: data }));
  }
}

export class PrismaUsageRepository implements P.UsageRepository {
  constructor(private db: Db) {}
  async get(organizationId: string, metric: string, period: string) {
    const r = await this.db.usageCounter.findUnique({ where: { organizationId_metric_period: { organizationId, metric, period } } });
    return r?.count ?? 0;
  }
  /** Single statement: increments only while below the limit (no race between check and increment). */
  async tryConsume(organizationId: string, metric: string, period: string, limit: number | null) {
    const max = limit ?? 2_147_483_647;
    if (max <= 0) return false;
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "UsageCounter" (id, "organizationId", metric, period, count)
      VALUES (${crypto.randomUUID()}, ${organizationId}, ${metric}, ${period}, 1)
      ON CONFLICT ("organizationId", metric, period)
      DO UPDATE SET count = "UsageCounter".count + 1 WHERE "UsageCounter".count < ${max}
      RETURNING count`;
    return rows.length > 0;
  }
  async release(organizationId: string, metric: string, period: string) {
    await this.db.usageCounter.updateMany({ where: { organizationId, metric, period, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
  }
}

export class PrismaWebhookEventRepository implements P.WebhookEventRepository {
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

export class PrismaKeyValueRepository implements P.KeyValueRepository {
  constructor(private db: Db) {}
  async get(key: string) {
    return (await this.db.keyValue.findUnique({ where: { key } }))?.value ?? null;
  }
  async set(key: string, value: string) {
    await this.db.keyValue.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

export function createRepositories(db: Db) {
  return {
    organizations: new PrismaOrganizationRepository(db),
    users: new PrismaUserRepository(db),
    memberships: new PrismaMembershipRepository(db),
    experiences: new PrismaExperienceRepository(db),
    notices: new PrismaNoticeRepository(db),
    noticeFiles: new PrismaNoticeFileRepository(db),
    contractItems: new PrismaContractItemRepository(db),
    rules: new PrismaRuleRepository(db),
    matches: new PrismaMatchRepository(db),
    analyses: new PrismaAnalysisRepository(db),
    bids: new PrismaBidRepository(db),
    generatedDocs: new PrismaGeneratedDocumentRepository(db),
    documents: new PrismaDocumentRepository(db),
    files: new PrismaFileRepository(db),
    calendars: new PrismaCalendarRepository(db),
    notifications: new PrismaNotificationRepository(db),
    subscriptions: new PrismaSubscriptionRepository(db),
    usage: new PrismaUsageRepository(db),
    webhookEvents: new PrismaWebhookEventRepository(db),
    kv: new PrismaKeyValueRepository(db),
  };
}
