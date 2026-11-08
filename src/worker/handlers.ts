import type { Deps, JobName, JobPayloads } from "@/application/ports";
import { runAnalysis } from "@/application/use-cases/analysis";
import { buildBidPack, renderGeneratedDocument } from "@/application/use-cases/bids";
import { processPaymentEvent } from "@/application/use-cases/billing";
import { syncCalendar } from "@/application/use-cases/calendar";
import { expiryWatch, validateUploadedDocument } from "@/application/use-cases/documents";
import { extractExperience } from "@/application/use-cases/experiences";
import { sendDigest, sendMatchNotifications } from "@/application/use-cases/notifications";
import { embedProfile } from "@/application/use-cases/organizations";
import { ingestNoticeFiles, syncContracts, syncOpenNotices, syncUpdatedNotices } from "@/application/use-cases/radar";
import { matchNotice } from "@/application/use-cases/rules";

export type Handlers = { [K in JobName]: (data: JobPayloads[K]) => Promise<unknown> };

/** Maps every pg-boss queue (docs/SPEC.md §9) to its use case. */
export function createHandlers(deps: Deps): Handlers {
  return {
    "pncp.sync-open": () => syncOpenNotices(deps),
    "pncp.sync-updates": () => syncUpdatedNotices(deps),
    "pncp.sync-contracts": () => syncContracts(deps),
    "rules.match": (data) => matchNotice(deps, data),
    "notice.ingest-files": (data) => ingestNoticeFiles(deps, data),
    "notify.send": (data) => sendMatchNotifications(deps, data),
    "notify.digest": () => sendDigest(deps),
    "analysis.run": (data) => runAnalysis(deps, data),
    "bid.build-pack": (data) => buildBidPack(deps, data),
    "bid.render-doc": (data) => renderGeneratedDocument(deps, data),
    "docs.validate-upload": (data) => validateUploadedDocument(deps, data),
    "docs.expiry-watch": () => expiryWatch(deps),
    "calendar.sync": (data) => syncCalendar(deps, data),
    "billing.webhook": (data) => processPaymentEvent(deps, data),
    "experience.extract": (data) => extractExperience(deps, data),
    "org.embed-profile": (data) => embedProfile(deps, data),
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
