import type { NoticeExtraction } from "@/domain/analysis/extraction";
import type { GeneratedDocKind, VerificationIssue } from "@/domain/bid/bid";
import type { DeadlineEvent } from "@/domain/calendar/deadlines";
import type { DocumentKind } from "@/domain/documents/document";
import type { CompraRef, NoticeItem } from "@/domain/notice/notice";
import type { PlanId } from "@/domain/billing/plans";
import type { Porte, Role } from "@/domain/organization/organization";
import type { ContractItemUpsert, NoticeUpsert } from "../notices/notices.repository";
import type { JobName, JobPayloads } from "./jobs";

export interface Page<T> {
  data: T[];
  totalPages: number;
  page: number;
}

export interface PncpFile {
  sequencialDocumento: number;
  titulo: string;
  tipo: string | null;
  url: string;
}

export interface PncpGateway {
  listOpenNotices(params: { dataFinal: string; page: number; pageSize: number; modalidadeId?: number }): Promise<Page<NoticeUpsert>>;
  listUpdatedNotices(params: { dataInicial: string; dataFinal: string; modalidadeId: number; page: number }): Promise<Page<NoticeUpsert>>;
  getItems(ref: CompraRef): Promise<NoticeItem[]>;
  getFiles(ref: CompraRef): Promise<PncpFile[]>;
  download(url: string): Promise<{ bytes: Uint8Array; contentType: string; fileName: string | null }>;
  /** Contracts signed in the period, flattened into items with unit prices. */
  listContractItems(params: { dataInicial: string; dataFinal: string; page: number }): Promise<Page<ContractItemUpsert>>;
}

export interface CompanyData {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  porte: Porte;
  cnaePrincipal: string | null;
  cnaesSecundarios: string[];
  endereco: string | null;
  municipio: string | null;
  uf: string | null;
  representante: string | null;
}

export interface CompanyLookup {
  findByCnpj(cnpj: string): Promise<CompanyData | null>;
}

export interface PageText {
  fileId: string;
  fileName: string;
  page: number;
  text: string;
}

export interface DocumentExtraction {
  kind: DocumentKind | null;
  issuer: string | null;
  cnpj: string | null;
  issuedAt: string | null;
  validUntil: string | null;
}

export interface ExperienceExtraction {
  issuer: string | null;
  object: string;
  quantities: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface DraftRequest {
  kind: GeneratedDocKind;
  title: string;
  slots: string[];
  company: { razaoSocial: string; porte: Porte; expertise: string };
  notice: { objeto: string; orgaoNome: string; numeroEdital: string; modalidade: string };
  /** Relevant edital excerpts (untrusted text). */
  excerpts: string[];
  guidance: string;
}

export interface AiGateway {
  readonly modelName: string;
  embed(texts: string[], purpose: "document" | "query"): Promise<number[][]>;
  extractNotice(input: { pages: PageText[]; retryPaths?: string[]; previous?: NoticeExtraction }): Promise<NoticeExtraction>;
  classifyCnae(input: { objeto: string; cnaes: string[]; expertise: string }): Promise<{ compatible: boolean; reason: string }>;
  extractDocument(input: { text: string; fileName: string }): Promise<DocumentExtraction>;
  extractExperience(input: { text: string; fileName: string }): Promise<ExperienceExtraction>;
  /** OCR for scanned PDFs and images; returns text per page. */
  ocr(input: { bytes: Uint8Array; mediaType: string }): Promise<string[]>;
  draft(input: DraftRequest): Promise<Record<string, string>>;
  verifyDocument(input: { markdown: string; requirements: string[] }): Promise<VerificationIssue[]>;
  submissionInstructions(input: {
    portal: string | null;
    link: string | null;
    modalidade: string;
    documents: string[];
    declarations: string[];
    excerpts: string[];
  }): Promise<string>;
}

export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  presignGet(key: string, expiresInSeconds: number, downloadName?: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface PdfTextExtractor {
  /** Text per page; empty strings for pages without a text layer. */
  extractPages(bytes: Uint8Array): Promise<string[]>;
}

export interface Mailer {
  send(message: { to: string[]; subject: string; html: string; text: string }): Promise<void>;
}

export interface JobQueue {
  enqueue<K extends JobName>(name: K, data: JobPayloads[K], options?: { singletonKey?: string; startAfterSeconds?: number }): Promise<void>;
}

export interface DocumentRenderer {
  toDocx(markdown: string): Promise<Uint8Array>;
  toPdf(markdown: string): Promise<Uint8Array>;
}

export interface Archiver {
  zip(files: { name: string; bytes: Uint8Array }[]): Promise<Uint8Array>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  email: string | null;
}

export interface CalendarProvider {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  /** Creates or updates; returns the provider's event id. */
  upsertEvent(accessToken: string, calendarId: string, externalId: string | null, event: DeadlineEvent): Promise<string>;
  deleteEvent(accessToken: string, calendarId: string, externalId: string): Promise<void>;
}

export interface TokenCipher {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

export type PaymentEvent =
  | { type: "subscription.activated"; checkoutRef: string | null; subscriptionRef: string; customerRef: string | null; externalId: string | null }
  | { type: "subscription.renewed"; subscriptionRef: string }
  | { type: "subscription.payment_failed"; subscriptionRef: string }
  | { type: "subscription.cancelled"; subscriptionRef: string }
  | { type: "ignored"; name: string };

export interface PaymentGateway {
  ensureCustomer(input: { name: string; email: string; taxId: string }): Promise<string>;
  createSubscriptionCheckout(input: { planId: Exclude<PlanId, "free">; customerRef: string; externalId: string; returnUrl: string; completionUrl: string }): Promise<{ checkoutRef: string; url: string }>;
  cancelSubscription(subscriptionRef: string): Promise<void>;
  /** Authenticity (query secret) + integrity (HMAC signature). */
  verifyWebhook(input: { rawBody: string; secret: string | null; signature: string | null }): boolean;
  parseWebhook(payload: unknown): { eventId: string; event: PaymentEvent };
}

export interface IdentityProvider {
  createOrganization(name: string, externalId: string): Promise<string>;
  addMember(workosOrgId: string, workosUserId: string, role: Role): Promise<void>;
  inviteMember(input: { email: string; workosOrgId: string; role: Role; inviterUserId: string }): Promise<void>;
}

export interface Clock {
  now(): Date;
}
