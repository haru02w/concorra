import type { NoticeExtraction } from "@/domain/analysis/extraction";
import type { DocumentGap } from "@/domain/analysis/gaps";
import type { Recommendation, ScoreFactor } from "@/domain/analysis/score";
import type { Bid, GeneratedDocument, PackStepKey } from "@/domain/bid/bid";
import type { ProposalLine } from "@/domain/bid/templates";
import type { CalendarRefType } from "@/domain/calendar/deadlines";
import type { DocumentCheck, DocumentKind, DocumentStatus, VaultDocument } from "@/domain/documents/document";
import type { Notice, NoticeFile, NoticeItem, NoticePages } from "@/domain/notice/notice";
import type { Experience, Organization, Role } from "@/domain/organization/organization";
import type { Rule } from "@/domain/rules/rule";
import type { LimitedMetric, PlanId } from "@/domain/billing/plans";

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

export interface ExperienceRepository {
  create(data: Omit<Experience, "id">): Promise<Experience>;
  update(id: string, patch: Partial<Omit<Experience, "id" | "organizationId">>, embedding?: number[]): Promise<Experience>;
  findById(organizationId: string, id: string): Promise<Experience | null>;
  listByOrg(organizationId: string): Promise<Experience[]>;
  delete(organizationId: string, id: string): Promise<void>;
}

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

export interface RuleRepository {
  create(data: Omit<Rule, "id">): Promise<Rule>;
  update(organizationId: string, id: string, patch: Partial<Omit<Rule, "id" | "organizationId">>): Promise<Rule>;
  delete(organizationId: string, id: string): Promise<void>;
  findById(organizationId: string, id: string): Promise<Rule | null>;
  listByOrg(organizationId: string): Promise<Rule[]>;
  countActive(organizationId: string): Promise<number>;
  listActive(): Promise<Rule[]>;
}

export type MatchStatus = "pending_score" | "notify" | "notified" | "discarded";

export interface Match {
  id: string;
  ruleId: string;
  noticeId: string;
  organizationId: string;
  similarity: number | null;
  status: MatchStatus;
  frequency: "immediate" | "daily";
  channels: ("email" | "inapp")[];
  minScore: number | null;
  createdAt: Date;
  notifiedAt: Date | null;
}

export interface MatchRepository {
  /** Returns null when the (rule, notice) pair already matched. */
  createIfAbsent(data: Omit<Match, "id" | "createdAt" | "notifiedAt">): Promise<Match | null>;
  listByIds(ids: string[]): Promise<Match[]>;
  listForDigest(): Promise<Match[]>;
  listPendingScore(organizationId: string, noticeId: string): Promise<Match[]>;
  setStatus(ids: string[], status: MatchStatus, notifiedAt?: Date): Promise<void>;
  listByOrg(organizationId: string, limit: number): Promise<(Match & { notice: Notice; ruleName: string })[]>;
}

export type AnalysisStatus = "queued" | "ingesting" | "running" | "done" | "failed";

export interface Analysis {
  id: string;
  organizationId: string;
  noticeId: string;
  status: AnalysisStatus;
  extraction: NoticeExtraction | null;
  citationReport: { verifiedCount: number; total: number; failedPaths: string[] } | null;
  score: number | null;
  scoreFactors: ScoreFactor[] | null;
  gaps: DocumentGap[] | null;
  recommendation: Recommendation | null;
  recommendationReasons: string[] | null;
  cnaeCompatible: boolean | null;
  model: string | null;
  error: string | null;
  noticeVersion: string | null;
  createdAt: Date;
}

export interface AnalysisRepository {
  create(data: Pick<Analysis, "organizationId" | "noticeId" | "status" | "noticeVersion">): Promise<Analysis>;
  update(id: string, patch: Partial<Omit<Analysis, "id" | "organizationId" | "noticeId" | "createdAt">>): Promise<Analysis>;
  findById(id: string): Promise<Analysis | null>;
  findLatest(organizationId: string, noticeId: string): Promise<Analysis | null>;
  listByOrg(organizationId: string, limit: number): Promise<Analysis[]>;
}

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

export type CalendarProviderId = "google" | "microsoft";

export interface CalendarConnection {
  id: string;
  userId: string;
  organizationId: string;
  provider: CalendarProviderId;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  calendarId: string;
  email: string | null;
}

export interface CalendarRepository {
  upsertConnection(data: Omit<CalendarConnection, "id">): Promise<CalendarConnection>;
  updateTokens(id: string, tokens: Pick<CalendarConnection, "accessToken" | "refreshToken" | "expiresAt">): Promise<void>;
  listByOrg(organizationId: string): Promise<CalendarConnection[]>;
  listByUser(userId: string, organizationId: string): Promise<CalendarConnection[]>;
  deleteConnection(userId: string, id: string): Promise<void>;
  findEvent(connectionId: string, key: string): Promise<{ id: string; externalId: string } | null>;
  saveEvent(data: { connectionId: string; key: string; refType: CalendarRefType; refId: string; externalId: string }): Promise<void>;
  listEventsByRef(refType: CalendarRefType, refId: string): Promise<{ id: string; connectionId: string; key: string; externalId: string }[]>;
  deleteEvent(id: string): Promise<void>;
}

export type NotificationType = "match" | "digest" | "analysis_ready" | "document_expiring" | "document_validated" | "bid_pack_ready" | "billing";

export interface Notification {
  id: string;
  organizationId: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationRepository {
  create(data: Omit<Notification, "id" | "readAt" | "createdAt">): Promise<Notification>;
  listForUser(organizationId: string, userId: string, limit: number): Promise<Notification[]>;
  countUnread(organizationId: string, userId: string): Promise<number>;
  markRead(organizationId: string, userId: string, ids: string[] | "all"): Promise<void>;
}

export type SubscriptionStatus = "active" | "pending" | "cancelled";

export interface Subscription {
  organizationId: string;
  planId: PlanId;
  /** Plan being purchased in an open checkout. */
  pendingPlanId: PlanId | null;
  status: SubscriptionStatus;
  customerRef: string | null;
  checkoutRef: string | null;
  subscriptionRef: string | null;
  currentPeriodEnd: Date | null;
}

export interface SubscriptionRepository {
  findByOrg(organizationId: string): Promise<Subscription | null>;
  findByCheckoutRef(ref: string): Promise<Subscription | null>;
  findBySubscriptionRef(ref: string): Promise<Subscription | null>;
  upsert(data: Subscription): Promise<Subscription>;
}

export interface UsageRepository {
  get(organizationId: string, metric: LimitedMetric, period: string): Promise<number>;
  /** Atomically increments unless it would pass `limit` (null = unlimited). Returns false when blocked. */
  tryConsume(organizationId: string, metric: LimitedMetric, period: string, limit: number | null): Promise<boolean>;
  release(organizationId: string, metric: LimitedMetric, period: string): Promise<void>;
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
