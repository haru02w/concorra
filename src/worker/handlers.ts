import type { JobName, JobPayloads } from "@/modules/shared/ports";
import type { Services } from "@/modules/services";

export type Handlers = { [K in JobName]: (data: JobPayloads[K]) => Promise<unknown> };

/** Maps every pg-boss queue (docs/SPEC.md §9) to its service method. */
export function createHandlers(s: Services): Handlers {
  return {
    "pncp.sync-open": () => s.notices.syncOpenNotices(),
    "pncp.sync-updates": () => s.notices.syncUpdatedNotices(),
    "pncp.sync-contracts": () => s.notices.syncContracts(),
    "rules.match": (data) => s.rules.matchNotice(data),
    "notice.ingest-files": (data) => s.notices.ingestNoticeFiles(data),
    "notify.send": (data) => s.notifications.sendMatchNotifications(data),
    "notify.digest": () => s.notifications.sendDigest(),
    "analysis.run": (data) => s.analysis.runAnalysis(data),
    "bid.build-pack": (data) => s.bids.buildBidPack(data),
    "bid.render-doc": (data) => s.bids.renderGeneratedDocument(data),
    "docs.validate-upload": (data) => s.documents.validateUploadedDocument(data),
    "docs.expiry-watch": () => s.documents.expiryWatch(),
    "calendar.sync": (data) => s.calendar.syncCalendar(data),
    "billing.webhook": (data) => s.billing.processPaymentEvent(data),
    "experience.extract": (data) => s.experiences.extractExperience(data),
    "org.embed-profile": (data) => s.organizations.embedProfile(data),
  };
}

/** Cron schedules (America/Sao_Paulo). */
export const SCHEDULES: { name: JobName; cron: string }[] = [
  { name: "pncp.sync-open", cron: "*/10 * * * *" },
  { name: "pncp.sync-updates", cron: "20 * * * *" },
  { name: "pncp.sync-contracts", cron: "0 4 * * *" },
  { name: "notify.digest", cron: "0 8 * * *" },
  { name: "docs.expiry-watch", cron: "0 7 * * *" },
];

/** Heavy jobs (PDF parsing, LaTeX, LLM) share the configured concurrency; the rest run wider. */
export const HEAVY_JOBS: JobName[] = ["notice.ingest-files", "analysis.run", "bid.build-pack", "bid.render-doc"];
