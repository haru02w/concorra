import type * as G from "./gateways";
import type * as R from "./repositories";

export type * from "./gateways";
export type * from "./repositories";
export type * from "./jobs";

export interface AppConfig {
  appUrl: string;
  demoMode: boolean;
  emailFrom: string;
}

/** Everything a use case may depend on. Use cases take `Pick<Deps, ...>`. */
export interface Deps {
  config: AppConfig;
  clock: G.Clock;
  // repositories
  organizations: R.OrganizationRepository;
  users: R.UserRepository;
  memberships: R.MembershipRepository;
  experiences: R.ExperienceRepository;
  notices: R.NoticeRepository;
  noticeFiles: R.NoticeFileRepository;
  contractItems: R.ContractItemRepository;
  rules: R.RuleRepository;
  matches: R.MatchRepository;
  analyses: R.AnalysisRepository;
  bids: R.BidRepository;
  generatedDocs: R.GeneratedDocumentRepository;
  documents: R.DocumentRepository;
  files: R.FileRepository;
  calendars: R.CalendarRepository;
  notifications: R.NotificationRepository;
  subscriptions: R.SubscriptionRepository;
  usage: R.UsageRepository;
  webhookEvents: R.WebhookEventRepository;
  kv: R.KeyValueRepository;
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
  calendarProviders: Record<R.CalendarProviderId, G.CalendarProvider>;
  cipher: G.TokenCipher;
  payments: G.PaymentGateway;
  identity: G.IdentityProvider;
}
