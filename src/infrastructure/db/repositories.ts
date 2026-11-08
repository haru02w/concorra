import { PrismaAnalysisRepository } from "@/modules/analysis/analysis.repository";
import { PrismaBidRepository, PrismaGeneratedDocumentRepository } from "@/modules/bids/bids.repository";
import { PrismaCalendarRepository } from "@/modules/calendar/calendar.repository";
import { PrismaContractItemRepository, PrismaNoticeFileRepository, PrismaNoticeRepository } from "@/modules/notices/notices.repository";
import { PrismaDocumentRepository } from "@/modules/documents/documents.repository";
import { PrismaExperienceRepository } from "@/modules/experiences/experiences.repository";
import { PrismaFileRepository, PrismaKeyValueRepository, PrismaWebhookEventRepository } from "@/modules/shared/repositories";
import { PrismaMatchRepository, PrismaRuleRepository } from "@/modules/rules/rules.repository";
import { PrismaMembershipRepository, PrismaOrganizationRepository, PrismaUserRepository } from "@/modules/organizations/organizations.repository";
import { PrismaNotificationRepository } from "@/modules/notifications/notifications.repository";
import { PrismaSubscriptionRepository, PrismaUsageRepository } from "@/modules/billing/billing.repository";
import type { Db } from "./client";

/** Every Prisma repository; each lives in its feature module. */
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
