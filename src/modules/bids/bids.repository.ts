import type { DocumentGap } from "@/domain/analysis/gaps";
import type { Bid, GeneratedDocument, PackStepKey, VerificationIssue } from "@/domain/bid/bid";
import type { ProposalLine } from "@/domain/bid/templates";
import type { Notice } from "@/domain/notice/notice";
import type { Db } from "@/infrastructure/db/client";
import { Prisma } from "@/infrastructure/db/generated/client";
import { json } from "@/infrastructure/db/json";
import { NOTICE_SELECT, type PriceReference, toNotice } from "@/modules/notices/notices.repository";
import type * as M from "@/infrastructure/db/generated/client";

export interface BidRepository {
  create(data: Omit<Bid, "id" | "packStatus" | "packSteps" | "packError">): Promise<Bid>;
  findById(organizationId: string, id: string): Promise<Bid | null>;
  findByIdUnscoped(id: string): Promise<Bid | null>;
  findByNotice(organizationId: string, noticeId: string): Promise<Bid | null>;
  update(id: string, patch: Partial<Omit<Bid, "id" | "organizationId" | "noticeId">>): Promise<Bid>;
  completeStep(id: string, step: PackStepKey): Promise<void>;
  listByOrg(organizationId: string): Promise<(Bid & { notice: Notice })[]>;
  getProposalLines(bidId: string): Promise<ProposalLine[]>;
  saveProposalLines(bidId: string, lines: ProposalLine[]): Promise<void>;
  savePriceReferences(bidId: string, refs: Record<number, PriceReference[]>): Promise<void>;
  getPriceReferences(bidId: string): Promise<Record<number, PriceReference[]>>;
  saveChecklist(bidId: string, gaps: DocumentGap[]): Promise<void>;
  getChecklist(bidId: string): Promise<DocumentGap[]>;
}

export interface GeneratedDocumentRepository {
  /** Upsert by (bidId, key) so retried steps don't duplicate. */
  upsert(bidId: string, key: string, data: Omit<GeneratedDocument, "id" | "bidId">): Promise<GeneratedDocument>;
  listByBid(bidId: string): Promise<(GeneratedDocument & { key: string })[]>;
  findById(id: string): Promise<GeneratedDocument | null>;
  update(id: string, patch: Partial<Omit<GeneratedDocument, "id" | "bidId">>): Promise<GeneratedDocument>;
}

// ---------- Prisma ----------

export const toBid = (r: M.Bid): Bid => ({
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

export const toGenerated = (r: M.GeneratedDocument): GeneratedDocument & { key: string } => ({
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

export class PrismaBidRepository implements BidRepository {
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
  async savePriceReferences(bidId: string, refs: Record<number, PriceReference[]>) {
    await this.db.bid.update({ where: { id: bidId }, data: { priceReferences: json(refs) } });
  }
  async getPriceReferences(bidId: string) {
    return this.field<Record<number, PriceReference[]>>(bidId, "priceReferences");
  }
  async saveChecklist(bidId: string, gaps: DocumentGap[]) {
    await this.db.bid.update({ where: { id: bidId }, data: { checklist: json(gaps) } });
  }
  async getChecklist(bidId: string) {
    return this.field<DocumentGap[]>(bidId, "checklist");
  }
}

export class PrismaGeneratedDocumentRepository implements GeneratedDocumentRepository {
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
