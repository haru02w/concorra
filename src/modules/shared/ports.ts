import type * as G from "./gateways";
import type { FileRepository, KeyValueRepository, WebhookEventRepository } from "./repositories";
import type { AnalysisRepository } from "../analysis/analysis.repository";
import type { BidRepository, GeneratedDocumentRepository } from "../bids/bids.repository";
import type { SubscriptionRepository, UsageRepository } from "../billing/billing.repository";
import type { CalendarProviderId, CalendarRepository } from "../calendar/calendar.repository";
import type { DocumentRepository } from "../documents/documents.repository";
import type { ExperienceRepository } from "../experiences/experiences.repository";
import type { ContractItemRepository, NoticeFileRepository, NoticeRepository } from "../notices/notices.repository";
import type { NotificationRepository } from "../notifications/notifications.repository";
import type { MembershipRepository, OrganizationRepository, UserRepository } from "../organizations/organizations.repository";
import type { MatchRepository, RuleRepository } from "../rules/rules.repository";

/** Every port (repository, gateway, job contract) in one import. */
export type * from "./gateways";
export type * from "./repositories";
export type * from "./jobs";
export type * from "../analysis/analysis.repository";
export type * from "../bids/bids.repository";
export type * from "../billing/billing.repository";
export type * from "../calendar/calendar.repository";
export type * from "../documents/documents.repository";
export type * from "../experiences/experiences.repository";
export type * from "../notices/notices.repository";
export type * from "../notifications/notifications.repository";
export type * from "../organizations/organizations.repository";
export type * from "../rules/rules.repository";
export { JOB_NAMES } from "./jobs";

export interface AppConfig {
  appUrl: string;
  demoMode: boolean;
  emailFrom: string;
}

/** Everything a service may depend on. */
export interface Deps {
  config: AppConfig;
  clock: G.Clock;
  // repositories
  organizations: OrganizationRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  experiences: ExperienceRepository;
  notices: NoticeRepository;
  noticeFiles: NoticeFileRepository;
  contractItems: ContractItemRepository;
  rules: RuleRepository;
  matches: MatchRepository;
  analyses: AnalysisRepository;
  bids: BidRepository;
  generatedDocs: GeneratedDocumentRepository;
  documents: DocumentRepository;
  files: FileRepository;
  calendars: CalendarRepository;
  notifications: NotificationRepository;
  subscriptions: SubscriptionRepository;
  usage: UsageRepository;
  webhookEvents: WebhookEventRepository;
  kv: KeyValueRepository;
  // gateways
  pncp: G.PncpGateway;
  companyLookup: G.CompanyLookup;
  ai: G.AiGateway;
  storage: G.FileStorage;
  pdfText: G.PdfTextExtractor;
  mailer: G.Mailer;
  jobs: G.JobQueue;
  renderer: G.DocumentRenderer;
  archiver: G.Archiver;
  calendarProviders: Record<CalendarProviderId, G.CalendarProvider>;
  cipher: G.TokenCipher;
  payments: G.PaymentGateway;
  identity: G.IdentityProvider;
}
