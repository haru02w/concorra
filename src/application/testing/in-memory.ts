/**
 * In-memory implementations of every port, for use-case tests.
 * Behaviour mirrors the Prisma adapters closely enough to exercise flows.
 */
import type { NoticeExtraction } from "@/domain/analysis/extraction";
import type { Bid, GeneratedDocument } from "@/domain/bid/bid";
import type { DeadlineEvent } from "@/domain/calendar/deadlines";
import type { VaultDocument } from "@/domain/documents/document";
import type { Notice, NoticeFile, NoticeItem } from "@/domain/notice/notice";
import type { Experience, Organization } from "@/domain/organization/organization";
import type { Rule } from "@/domain/rules/rule";
import { cosineSimilarity } from "@/domain/shared/vector";
import { makeExtraction } from "@/domain/fixtures";
import type * as P from "../ports";

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

export class FakeClock implements P.Clock {
  constructor(public current = new Date("2026-11-08T12:00:00Z")) {}
  now() {
    return new Date(this.current);
  }
}

export class InMemoryOrganizations implements P.OrganizationRepository {
  rows = new Map<string, Organization>();
  embeddings = new Map<string, number[]>();
  async findById(i: string) { return this.rows.get(i) ?? null; }
  async findByWorkosOrgId(w: string) { return [...this.rows.values()].find((o) => o.workosOrgId === w) ?? null; }
  async findByCnpj(c: string) { return [...this.rows.values()].find((o) => o.cnpj === c) ?? null; }
  async create(data: Omit<Organization, "id">) { const o = { ...data, id: id("org") }; this.rows.set(o.id, o); return o; }
  async update(i: string, patch: Partial<Organization>) { const o = { ...this.rows.get(i)!, ...patch }; this.rows.set(i, o); return o; }
  async setProfileEmbedding(i: string, e: number[]) { this.embeddings.set(i, e); }
  async delete(i: string) { this.rows.delete(i); }
}

export class InMemoryUsers implements P.UserRepository {
  rows = new Map<string, P.User>();
  async upsert(data: Omit<P.User, "id">) {
    const found = [...this.rows.values()].find((u) => u.workosUserId === data.workosUserId);
    const u = { ...(found ?? { id: id("user") }), ...data };
    this.rows.set(u.id, u);
    return u;
  }
  async findById(i: string) { return this.rows.get(i) ?? null; }
}

export class InMemoryMemberships implements P.MembershipRepository {
  rows: { organizationId: string; userId: string; role: "owner" | "member" }[] = [];
  constructor(private orgs: InMemoryOrganizations, private users: InMemoryUsers) {}
  async upsert(organizationId: string, userId: string, role: "owner" | "member") {
    this.rows = this.rows.filter((r) => !(r.organizationId === organizationId && r.userId === userId));
    this.rows.push({ organizationId, userId, role });
  }
  async find(o: string, u: string) { return this.rows.find((r) => r.organizationId === o && r.userId === u) ?? null; }
  async listByUser(u: string) {
    return this.rows.filter((r) => r.userId === u).map((r) => ({ organization: this.orgs.rows.get(r.organizationId)!, role: r.role }));
  }
  async listByOrg(o: string) {
    return this.rows.filter((r) => r.organizationId === o).map((r) => ({ user: this.users.rows.get(r.userId)!, role: r.role }));
  }
  async count(o: string) { return this.rows.filter((r) => r.organizationId === o).length; }
}

export class InMemoryExperiences implements P.ExperienceRepository {
  rows = new Map<string, Experience & { embedding?: number[] }>();
  async create(data: Omit<Experience, "id">) { const e = { ...data, id: id("exp") }; this.rows.set(e.id, e); return e; }
  async update(i: string, patch: Partial<Experience>, embedding?: number[]) {
    const e = { ...this.rows.get(i)!, ...patch, ...(embedding ? { embedding } : {}) };
    this.rows.set(i, e);
    return e;
  }
  async findById(o: string, i: string) { const e = this.rows.get(i); return e?.organizationId === o ? e : null; }
  async listByOrg(o: string) { return [...this.rows.values()].filter((e) => e.organizationId === o); }
  async delete(o: string, i: string) { if (this.rows.get(i)?.organizationId === o) this.rows.delete(i); }
}

export class InMemoryNotices implements P.NoticeRepository {
  rows = new Map<string, Notice>();
  items = new Map<string, NoticeItem[]>();
  embeddings = new Map<string, number[]>();
  constructor(private orgs: InMemoryOrganizations) {}
  async upsert(data: P.NoticeUpsert) {
    const existing = [...this.rows.values()].find((n) => n.numeroControlePNCP === data.numeroControlePNCP);
    const { raw: _raw, ...fields } = data;
    if (existing) {
      const changed = existing.updatedAtPncp?.getTime() !== data.updatedAtPncp?.getTime();
      const notice = { ...existing, ...fields };
      this.rows.set(existing.id, notice);
      return { notice, created: false, changed };
    }
    const notice: Notice = { ...fields, id: id("notice"), filesIngestedAt: null };
    this.rows.set(notice.id, notice);
    return { notice, created: true, changed: true };
  }
  async findById(i: string) { return this.rows.get(i) ?? null; }
  async findByControle(n: string) { return [...this.rows.values()].find((x) => x.numeroControlePNCP === n) ?? null; }
  async listItems(i: string) { return this.items.get(i) ?? []; }
  async replaceItems(i: string, items: NoticeItem[], _embeddings: number[][] | null) { this.items.set(i, items); }
  async setEmbedding(i: string, e: number[]) { this.embeddings.set(i, e); }
  async similarityToOrg(n: string, o: string) {
    const a = this.embeddings.get(n);
    const b = this.orgs.embeddings.get(o);
    return a && b ? cosineSimilarity(a, b) : null;
  }
  async search(params: P.NoticeSearch) {
    let rows = [...this.rows.values()];
    if (params.query) rows = rows.filter((n) => n.objeto.toLowerCase().includes(params.query!.toLowerCase()));
    if (params.uf) rows = rows.filter((n) => n.uf === params.uf);
    const start = (params.page - 1) * params.pageSize;
    return { rows: rows.slice(start, start + params.pageSize).map((n) => ({ ...n, similarity: null })), total: rows.length };
  }
  async markFilesIngested(i: string, at: Date) { this.rows.set(i, { ...this.rows.get(i)!, filesIngestedAt: at }); }
}

export class InMemoryNoticeFiles implements P.NoticeFileRepository {
  rows = new Map<string, NoticeFile>();
  pages = new Map<string, string[]>();
  chunks = new Map<string, { page: number; text: string; embedding: number[] }[]>();
  async upsertMany(noticeId: string, files: Pick<NoticeFile, "sequencialDocumento" | "tipo" | "titulo" | "url">[]) {
    return files.map((f) => {
      const existing = [...this.rows.values()].find((r) => r.noticeId === noticeId && r.sequencialDocumento === f.sequencialDocumento);
      const row: NoticeFile = existing ? { ...existing, ...f } : { ...f, id: id("nfile"), noticeId, storageKey: null, pageCount: null, ocr: false };
      this.rows.set(row.id, row);
      return row;
    });
  }
  async listByNotice(n: string) { return [...this.rows.values()].filter((f) => f.noticeId === n); }
  async update(i: string, patch: Partial<NoticeFile>) { this.rows.set(i, { ...this.rows.get(i)!, ...patch }); }
  async savePages(f: string, pages: string[]) { this.pages.set(f, pages); }
  async saveChunks(f: string, chunks: { page: number; text: string; embedding: number[] }[]) { this.chunks.set(f, chunks); }
  async loadPages(n: string) {
    const out = new Map<string, string[]>();
    for (const f of await this.listByNotice(n)) if (this.pages.has(f.id)) out.set(f.id, this.pages.get(f.id)!);
    return out;
  }
  async searchChunks(n: string, _e: number[], limit: number) {
    const files = await this.listByNotice(n);
    return files.flatMap((f) => (this.chunks.get(f.id) ?? []).map((c) => ({ fileId: f.id, page: c.page, text: c.text }))).slice(0, limit);
  }
}

export class InMemoryContractItems implements P.ContractItemRepository {
  rows: (P.ContractItemUpsert & { embedding: number[] })[] = [];
  async upsertMany(items: P.ContractItemUpsert[], embeddings: number[][]) {
    items.forEach((it, i) => this.rows.push({ ...it, embedding: embeddings[i] }));
    return items.length;
  }
  async similar(e: number[], limit: number): Promise<P.PriceReference[]> {
    return this.rows
      .map((r) => ({ descricao: r.descricao, unidade: r.unidade, quantidade: r.quantidade, valorUnitario: r.valorUnitario, orgaoNome: r.orgaoNome, uf: r.uf, data: r.dataAssinatura, numeroControlePNCP: r.numeroControlePNCP, similarity: cosineSimilarity(e, r.embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}

export class InMemoryRules implements P.RuleRepository {
  rows = new Map<string, Rule>();
  async create(data: Omit<Rule, "id">) { const r = { ...data, id: id("rule") }; this.rows.set(r.id, r); return r; }
  async update(o: string, i: string, patch: Partial<Rule>) { const r = { ...this.rows.get(i)!, ...patch }; this.rows.set(i, r); return r; }
  async delete(_o: string, i: string) { this.rows.delete(i); }
  async findById(o: string, i: string) { const r = this.rows.get(i); return r?.organizationId === o ? r : null; }
  async listByOrg(o: string) { return [...this.rows.values()].filter((r) => r.organizationId === o); }
  async countActive(o: string) { return (await this.listByOrg(o)).filter((r) => r.active).length; }
  async listActive() { return [...this.rows.values()].filter((r) => r.active); }
}

export class InMemoryMatches implements P.MatchRepository {
  rows = new Map<string, P.Match>();
  constructor(private notices: InMemoryNotices, private rules: InMemoryRules, private clock: P.Clock) {}
  async createIfAbsent(data: Omit<P.Match, "id" | "createdAt" | "notifiedAt">) {
    if ([...this.rows.values()].some((m) => m.ruleId === data.ruleId && m.noticeId === data.noticeId)) return null;
    const m: P.Match = { ...data, id: id("match"), createdAt: this.clock.now(), notifiedAt: null };
    this.rows.set(m.id, m);
    return m;
  }
  async listByIds(ids: string[]) { return ids.map((i) => this.rows.get(i)).filter((m): m is P.Match => !!m); }
  async listForDigest() { return [...this.rows.values()].filter((m) => m.status === "notify" && m.frequency === "daily"); }
  async listPendingScore(o: string, n: string) { return [...this.rows.values()].filter((m) => m.organizationId === o && m.noticeId === n && m.status === "pending_score"); }
  async setStatus(ids: string[], status: P.MatchStatus, notifiedAt?: Date) {
    for (const i of ids) this.rows.set(i, { ...this.rows.get(i)!, status, notifiedAt: notifiedAt ?? this.rows.get(i)!.notifiedAt });
  }
  async listByOrg(o: string, limit: number) {
    return [...this.rows.values()].filter((m) => m.organizationId === o).slice(0, limit).map((m) => ({ ...m, notice: this.notices.rows.get(m.noticeId)!, ruleName: this.rules.rows.get(m.ruleId)?.name ?? "" }));
  }
}

export class InMemoryAnalyses implements P.AnalysisRepository {
  rows = new Map<string, P.Analysis>();
  constructor(private clock: P.Clock) {}
  async create(data: Pick<P.Analysis, "organizationId" | "noticeId" | "status" | "noticeVersion">) {
    const a: P.Analysis = { ...data, id: id("analysis"), extraction: null, citationReport: null, score: null, scoreFactors: null, gaps: null, recommendation: null, recommendationReasons: null, cnaeCompatible: null, model: null, error: null, createdAt: new Date(this.clock.now().getTime() + seq) };
    this.rows.set(a.id, a);
    return a;
  }
  async update(i: string, patch: Partial<P.Analysis>) { const a = { ...this.rows.get(i)!, ...patch }; this.rows.set(i, a); return a; }
  async findById(i: string) { return this.rows.get(i) ?? null; }
  async findLatest(o: string, n: string) {
    return [...this.rows.values()].filter((a) => a.organizationId === o && a.noticeId === n).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }
  async listByOrg(o: string) { return [...this.rows.values()].filter((a) => a.organizationId === o); }
}

export class InMemoryBids implements P.BidRepository {
  rows = new Map<string, Bid>();
  lines = new Map<string, import("@/domain/bid/templates").ProposalLine[]>();
  prices = new Map<string, Record<number, P.PriceReference[]>>();
  checklists = new Map<string, import("@/domain/analysis/gaps").DocumentGap[]>();
  constructor(private notices: InMemoryNotices) {}
  async create(data: Omit<Bid, "id" | "packStatus" | "packSteps" | "packError">) {
    const b: Bid = { ...data, id: id("bid"), packStatus: "idle", packSteps: [], packError: null };
    this.rows.set(b.id, b);
    return b;
  }
  async findById(o: string, i: string) { const b = this.rows.get(i); return b?.organizationId === o ? b : null; }
  async findByIdUnscoped(i: string) { return this.rows.get(i) ?? null; }
  async findByNotice(o: string, n: string) { return [...this.rows.values()].find((b) => b.organizationId === o && b.noticeId === n) ?? null; }
  async update(i: string, patch: Partial<Bid>) { const b = { ...this.rows.get(i)!, ...patch }; this.rows.set(i, b); return b; }
  async completeStep(i: string, step: Bid["packSteps"][number]) { const b = this.rows.get(i)!; if (!b.packSteps.includes(step)) this.rows.set(i, { ...b, packSteps: [...b.packSteps, step] }); }
  async listByOrg(o: string) { return [...this.rows.values()].filter((b) => b.organizationId === o).map((b) => ({ ...b, notice: this.notices.rows.get(b.noticeId)! })); }
  async getProposalLines(b: string) { return this.lines.get(b) ?? []; }
  async saveProposalLines(b: string, l: import("@/domain/bid/templates").ProposalLine[]) { this.lines.set(b, l); }
  async savePriceReferences(b: string, r: Record<number, P.PriceReference[]>) { this.prices.set(b, r); }
  async getPriceReferences(b: string) { return this.prices.get(b) ?? {}; }
  async saveChecklist(b: string, g: import("@/domain/analysis/gaps").DocumentGap[]) { this.checklists.set(b, g); }
  async getChecklist(b: string) { return this.checklists.get(b) ?? []; }
}

export class InMemoryGeneratedDocs implements P.GeneratedDocumentRepository {
  rows = new Map<string, GeneratedDocument & { key: string }>();
  async upsert(bidId: string, key: string, data: Omit<GeneratedDocument, "id" | "bidId">) {
    const existing = [...this.rows.values()].find((d) => d.bidId === bidId && d.key === key);
    const d = { ...(existing ?? { id: id("gdoc"), bidId, key }), ...data };
    this.rows.set(d.id, d);
    return d;
  }
  async listByBid(b: string) { return [...this.rows.values()].filter((d) => d.bidId === b); }
  async findById(i: string) { return this.rows.get(i) ?? null; }
  async update(i: string, patch: Partial<GeneratedDocument>) { const d = { ...this.rows.get(i)!, ...patch }; this.rows.set(i, d); return d; }
}

export class InMemoryDocuments implements P.DocumentRepository {
  rows = new Map<string, VaultDocument & { expiryNotifiedAt?: Date | null; extracted?: unknown }>();
  async create(data: Omit<VaultDocument, "id" | "fileName"> & { extracted?: unknown }) {
    const d = { ...data, id: id("doc"), fileName: `${data.kind}.pdf` };
    this.rows.set(d.id, d);
    return d;
  }
  async findById(o: string, i: string) { const d = this.rows.get(i); return d?.organizationId === o ? d : null; }
  async findByIdUnscoped(i: string) { return this.rows.get(i) ?? null; }
  async update(i: string, patch: Record<string, unknown>) { const d = { ...this.rows.get(i)!, ...patch }; this.rows.set(i, d); return d; }
  async listByOrg(o: string) { return [...this.rows.values()].filter((d) => d.organizationId === o); }
  async listExpiringUnnotified(before: Date) {
    return [...this.rows.values()].filter((d) => d.validUntil && d.validUntil < before && !d.expiryNotifiedAt && d.status !== "invalid");
  }
  async delete(o: string, i: string) { if (this.rows.get(i)?.organizationId === o) this.rows.delete(i); }
}

export class InMemoryFiles implements P.FileRepository {
  rows = new Map<string, P.StoredFile>();
  async create(data: Omit<P.StoredFile, "id">) { const f = { ...data, id: id("file") }; this.rows.set(f.id, f); return f; }
  async findById(i: string) { return this.rows.get(i) ?? null; }
  async delete(i: string) { this.rows.delete(i); }
}

export class InMemoryCalendars implements P.CalendarRepository {
  connections = new Map<string, P.CalendarConnection>();
  events = new Map<string, { id: string; connectionId: string; key: string; refType: "bid" | "document"; refId: string; externalId: string }>();
  async upsertConnection(data: Omit<P.CalendarConnection, "id">) {
    const existing = [...this.connections.values()].find((c) => c.userId === data.userId && c.provider === data.provider && c.organizationId === data.organizationId);
    const c = { ...(existing ?? { id: id("cal") }), ...data };
    this.connections.set(c.id, c);
    return c;
  }
  async updateTokens(i: string, t: Pick<P.CalendarConnection, "accessToken" | "refreshToken" | "expiresAt">) { this.connections.set(i, { ...this.connections.get(i)!, ...t }); }
  async listByOrg(o: string) { return [...this.connections.values()].filter((c) => c.organizationId === o); }
  async listByUser(u: string, o: string) { return [...this.connections.values()].filter((c) => c.userId === u && c.organizationId === o); }
  async deleteConnection(u: string, i: string) { if (this.connections.get(i)?.userId === u) this.connections.delete(i); }
  async findEvent(c: string, k: string) { return [...this.events.values()].find((e) => e.connectionId === c && e.key === k) ?? null; }
  async saveEvent(data: { connectionId: string; key: string; refType: "bid" | "document"; refId: string; externalId: string }) { const e = { ...data, id: id("calev") }; this.events.set(e.id, e); }
  async listEventsByRef(t: string, r: string) { return [...this.events.values()].filter((e) => e.refType === t && e.refId === r); }
  async deleteEvent(i: string) { this.events.delete(i); }
}

export class InMemoryNotifications implements P.NotificationRepository {
  rows: P.Notification[] = [];
  constructor(private clock: P.Clock) {}
  async create(data: Omit<P.Notification, "id" | "readAt" | "createdAt">) { const n = { ...data, id: id("notif"), readAt: null, createdAt: this.clock.now() }; this.rows.push(n); return n; }
  async listForUser(o: string, u: string, limit: number) { return this.rows.filter((n) => n.organizationId === o && (n.userId === u || n.userId === null)).slice(0, limit); }
  async countUnread(o: string, u: string) { return (await this.listForUser(o, u, 1000)).filter((n) => !n.readAt).length; }
  async markRead(o: string, u: string, ids: string[] | "all") {
    for (const n of this.rows) if (n.organizationId === o && n.userId === u && (ids === "all" || ids.includes(n.id))) n.readAt = this.clock.now();
  }
}

export class InMemorySubscriptions implements P.SubscriptionRepository {
  rows = new Map<string, P.Subscription>();
  async findByOrg(o: string) { return this.rows.get(o) ?? null; }
  async findByCheckoutRef(r: string) { return [...this.rows.values()].find((s) => s.checkoutRef === r) ?? null; }
  async findBySubscriptionRef(r: string) { return [...this.rows.values()].find((s) => s.subscriptionRef === r) ?? null; }
  async upsert(data: P.Subscription) { this.rows.set(data.organizationId, data); return data; }
}

export class InMemoryUsage implements P.UsageRepository {
  rows = new Map<string, number>();
  private k = (o: string, m: string, p: string) => `${o}:${m}:${p}`;
  async get(o: string, m: string, p: string) { return this.rows.get(this.k(o, m, p)) ?? 0; }
  async tryConsume(o: string, m: string, p: string, limit: number | null) {
    const current = await this.get(o, m, p);
    if (limit !== null && current + 1 > limit) return false;
    this.rows.set(this.k(o, m, p), current + 1);
    return true;
  }
  async release(o: string, m: string, p: string) { this.rows.set(this.k(o, m, p), Math.max(0, (await this.get(o, m, p)) - 1)); }
}

export class InMemoryWebhookEvents implements P.WebhookEventRepository {
  rows = new Map<string, { id: string; provider: string; externalId: string; payload: unknown; processedAt: Date | null }>();
  async recordOnce(provider: string, externalId: string, payload: unknown) {
    if ([...this.rows.values()].some((r) => r.provider === provider && r.externalId === externalId)) return null;
    const r = { id: id("wh"), provider, externalId, payload, processedAt: null };
    this.rows.set(r.id, r);
    return r.id;
  }
  async find(i: string) { return this.rows.get(i) ?? null; }
  async markProcessed(i: string) { this.rows.get(i)!.processedAt = new Date(); }
}

export class InMemoryKv implements P.KeyValueRepository {
  rows = new Map<string, string>();
  async get(k: string) { return this.rows.get(k) ?? null; }
  async set(k: string, v: string) { this.rows.set(k, v); }
}

// ---------- gateways ----------

/** Deterministic bag-of-words embedding so similarity behaves sensibly in tests. */
export function fakeEmbedding(text: string, dims = 32): number[] {
  const v = new Array(dims).fill(0);
  for (const token of text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\W+/).filter((t) => t.length > 2)) {
    let h = 0;
    for (const ch of token) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % dims] += 1;
  }
  return v;
}

export class FakeAi implements P.AiGateway {
  modelName = "fake-model";
  calls: Record<string, unknown[]> = {};
  extraction: NoticeExtraction = makeExtraction();
  retryExtraction: NoticeExtraction | null = null;
  documentExtraction: P.DocumentExtraction = { kind: "cnd_federal", issuer: "Receita Federal", cnpj: "11222333000181", issuedAt: "2026-10-01", validUntil: "2027-03-30" };
  private record(name: string, input: unknown) { (this.calls[name] ??= []).push(input); }
  async embed(texts: string[], purpose: "document" | "query") { this.record("embed", { texts, purpose }); return texts.map((t) => fakeEmbedding(t)); }
  async extractNotice(input: { pages: P.PageText[]; retryPaths?: string[]; previous?: NoticeExtraction }) {
    this.record("extractNotice", input);
    return structuredClone(input.retryPaths && this.retryExtraction ? this.retryExtraction : this.extraction);
  }
  async classifyCnae(input: unknown) { this.record("classifyCnae", input); return { compatible: true, reason: "Objeto compatível com o CNAE principal" }; }
  async extractDocument(input: unknown) { this.record("extractDocument", input); return this.documentExtraction; }
  async extractExperience(input: unknown) { this.record("extractExperience", input); return { issuer: "Prefeitura X", object: "Fornecimento de material de limpeza", quantities: "10.000 unidades", periodStart: "2025-01-01", periodEnd: "2025-12-31" }; }
  async ocr(input: unknown) { this.record("ocr", input); return ["Texto OCR página 1"]; }
  async draft(input: P.DraftRequest) { this.record("draft", input); return Object.fromEntries(input.slots.map((s) => [s, `Texto ${s} para ${input.title}.`])); }
  async verifyDocument(input: unknown) { this.record("verifyDocument", input); return []; }
  async submissionInstructions(input: unknown) { this.record("submissionInstructions", input); return "# Instruções\n\n1. Acesse o portal."; }
}

export class FakePncp implements P.PncpGateway {
  open: P.NoticeUpsert[][] = [];
  updated: Record<number, P.NoticeUpsert[]> = {};
  items: NoticeItem[] = [];
  files: P.PncpFile[] = [];
  downloads = new Map<string, { bytes: Uint8Array; contentType: string; fileName: string | null }>();
  contracts: P.ContractItemUpsert[][] = [];
  async listOpenNotices(p: { page: number }) { return { data: this.open[p.page - 1] ?? [], totalPages: Math.max(1, this.open.length), page: p.page }; }
  async listUpdatedNotices(p: { modalidadeId: number; page: number }) { return { data: p.page === 1 ? this.updated[p.modalidadeId] ?? [] : [], totalPages: 1, page: p.page }; }
  async getItems() { return this.items; }
  async getFiles() { return this.files; }
  async download(url: string) { return this.downloads.get(url) ?? { bytes: new TextEncoder().encode("%PDF-1.4 fake"), contentType: "application/pdf", fileName: "edital.pdf" }; }
  async listContractItems(p: { page: number }) { return { data: this.contracts[p.page - 1] ?? [], totalPages: Math.max(1, this.contracts.length), page: p.page }; }
}

export class FakeStorage implements P.FileStorage {
  objects = new Map<string, Uint8Array>();
  async put(k: string, b: Uint8Array) { this.objects.set(k, b); }
  async get(k: string) { const b = this.objects.get(k); if (!b) throw new Error(`missing object ${k}`); return b; }
  async presignGet(k: string) { return `https://storage.test/${k}?sig=1`; }
  async delete(k: string) { this.objects.delete(k); }
}

export class FakePdfText implements P.PdfTextExtractor {
  pages: string[] = ["EDITAL. Objeto: aquisição de material de limpeza.", "Habilitação: prova de regularidade com a fazenda federal."];
  async extractPages() { return this.pages; }
}

export class FakeMailer implements P.Mailer {
  sent: { to: string[]; subject: string; html: string; text: string }[] = [];
  async send(m: { to: string[]; subject: string; html: string; text: string }) { this.sent.push(m); }
}

export class FakeJobs implements P.JobQueue {
  queued: { name: P.JobName; data: unknown; options?: unknown }[] = [];
  async enqueue<K extends P.JobName>(name: K, data: P.JobPayloads[K], options?: unknown) { this.queued.push({ name, data, options }); }
  of<K extends P.JobName>(name: K) { return this.queued.filter((j) => j.name === name).map((j) => j.data as P.JobPayloads[K]); }
  clear() { this.queued = []; }
}

export class FakeRenderer implements P.DocumentRenderer {
  async toDocx(md: string) { return new TextEncoder().encode(`DOCX:${md.length}`); }
  async toPdf(md: string) { return new TextEncoder().encode(`%PDF:${md.length}`); }
}

export class FakeArchiver implements P.Archiver {
  last: { name: string; bytes: Uint8Array }[] = [];
  async zip(files: { name: string; bytes: Uint8Array }[]) { this.last = files; return new Uint8Array([0x50, 0x4b]); }
}

export class FakeCalendarProvider implements P.CalendarProvider {
  events = new Map<string, DeadlineEvent>();
  deleted: string[] = [];
  refreshed = 0;
  authorizationUrl(state: string) { return `https://oauth.test/authorize?state=${encodeURIComponent(state)}`; }
  async exchangeCode() { return { accessToken: "access", refreshToken: "refresh", expiresAt: new Date("2026-11-08T13:00:00Z"), email: "a@b.c" }; }
  async refresh() { this.refreshed++; return { accessToken: "access-2", refreshToken: null, expiresAt: new Date("2026-11-09T13:00:00Z"), email: null }; }
  async upsertEvent(_t: string, _c: string, externalId: string | null, event: DeadlineEvent) { const eid = externalId ?? `ext-${event.key}`; this.events.set(eid, event); return eid; }
  async deleteEvent(_t: string, _c: string, externalId: string) { this.deleted.push(externalId); this.events.delete(externalId); }
}

export class FakeCipher implements P.TokenCipher {
  encrypt(p: string) { return `enc(${Buffer.from(p).toString("base64")})`; }
  decrypt(c: string) { const m = /^enc\((.*)\)$/.exec(c); if (!m) throw new Error("bad cipher"); return Buffer.from(m[1], "base64").toString(); }
}

export class FakePayments implements P.PaymentGateway {
  customers = 0;
  checkouts: unknown[] = [];
  cancelled: string[] = [];
  async ensureCustomer() { this.customers++; return "cust_1"; }
  async createSubscriptionCheckout(input: unknown) { this.checkouts.push(input); return { checkoutRef: "bill_1", url: "https://pay.test/bill_1" }; }
  async cancelSubscription(ref: string) { this.cancelled.push(ref); }
  verifyWebhook(input: { secret: string | null }) { return input.secret === "whsec"; }
  parseWebhook(payload: unknown) {
    const p = payload as { id: string; event: string; data: { subscriptionRef?: string; checkoutRef?: string; externalId?: string } };
    const map: Record<string, P.PaymentEvent> = {
      "subscription.completed": { type: "subscription.activated", checkoutRef: p.data.checkoutRef ?? null, subscriptionRef: p.data.subscriptionRef ?? "", customerRef: "cust_1", externalId: p.data.externalId ?? null },
      "subscription.renewed": { type: "subscription.renewed", subscriptionRef: p.data.subscriptionRef ?? "" },
      "subscription.cancelled": { type: "subscription.cancelled", subscriptionRef: p.data.subscriptionRef ?? "" },
      "subscription.payment_failed": { type: "subscription.payment_failed", subscriptionRef: p.data.subscriptionRef ?? "" },
    };
    return { eventId: p.id, event: map[p.event] ?? { type: "ignored" as const, name: p.event } };
  }
}

export class FakeIdentity implements P.IdentityProvider {
  orgs: string[] = [];
  members: { org: string; user: string; role: string }[] = [];
  invites: unknown[] = [];
  async createOrganization(name: string) { this.orgs.push(name); return `org_wos_${this.orgs.length}`; }
  async addMember(org: string, user: string, role: string) { this.members.push({ org, user, role }); }
  async inviteMember(input: unknown) { this.invites.push(input); }
}

export class FakeCompanyLookup implements P.CompanyLookup {
  async findByCnpj(cnpj: string): Promise<P.CompanyData | null> {
    if (cnpj !== "11222333000181") return null;
    return { cnpj, razaoSocial: "LIMPA BEM COMERCIO LTDA", nomeFantasia: "Limpa Bem", porte: "EPP", cnaePrincipal: "4649-4/08 - Comércio atacadista de produtos de limpeza", cnaesSecundarios: [], endereco: "Rua das Flores, 100", municipio: "Vitória", uf: "ES", representante: "Maria Exemplo" };
  }
}

export function makeTestDeps() {
  const clock = new FakeClock();
  const organizations = new InMemoryOrganizations();
  const users = new InMemoryUsers();
  const notices = new InMemoryNotices(organizations);
  const rules = new InMemoryRules();
  const deps = {
    config: { appUrl: "https://app.test", demoMode: false, emailFrom: "Concorra <no-reply@test>" },
    clock,
    organizations,
    users,
    memberships: new InMemoryMemberships(organizations, users),
    experiences: new InMemoryExperiences(),
    notices,
    noticeFiles: new InMemoryNoticeFiles(),
    contractItems: new InMemoryContractItems(),
    rules,
    matches: new InMemoryMatches(notices, rules, clock),
    analyses: new InMemoryAnalyses(clock),
    bids: new InMemoryBids(notices),
    generatedDocs: new InMemoryGeneratedDocs(),
    documents: new InMemoryDocuments(),
    files: new InMemoryFiles(),
    calendars: new InMemoryCalendars(),
    notifications: new InMemoryNotifications(clock),
    subscriptions: new InMemorySubscriptions(),
    usage: new InMemoryUsage(),
    webhookEvents: new InMemoryWebhookEvents(),
    kv: new InMemoryKv(),
    pncp: new FakePncp(),
    companyLookup: new FakeCompanyLookup(),
    ai: new FakeAi(),
    storage: new FakeStorage(),
    pdfText: new FakePdfText(),
    mailer: new FakeMailer(),
    jobs: new FakeJobs(),
    renderer: new FakeRenderer(),
    archiver: new FakeArchiver(),
    calendarProviders: { google: new FakeCalendarProvider(), microsoft: new FakeCalendarProvider() },
    cipher: new FakeCipher(),
    payments: new FakePayments(),
    identity: new FakeIdentity(),
  } satisfies P.Deps;
  return deps;
}

export type TestDeps = ReturnType<typeof makeTestDeps>;
