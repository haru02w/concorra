import type { CalendarRefType } from "@/domain/calendar/deadlines";

/** pg-boss queue names (letters, digits, '-', '_' and '.' only) and their payloads. */
export interface JobPayloads {
  "pncp.sync-open": Record<string, never>;
  "pncp.sync-updates": Record<string, never>;
  "pncp.sync-contracts": Record<string, never>;
  "rules.match": { noticeId: string };
  "notice.ingest-files": { noticeId: string; analysisId?: string };
  "notify.send": { matchIds: string[] };
  "notify.digest": Record<string, never>;
  "analysis.run": { analysisId: string };
  "bid.build-pack": { bidId: string };
  "bid.render-doc": { generatedDocumentId: string };
  "docs.validate-upload": { documentId: string };
  "docs.expiry-watch": Record<string, never>;
  "calendar.sync": { refType: CalendarRefType; refId: string; organizationId: string; action: "upsert" | "delete" };
  "billing.webhook": { webhookEventId: string };
  "experience.extract": { experienceId: string; organizationId: string };
  "org.embed-profile": { organizationId: string };
}

export type JobName = keyof JobPayloads;

export const JOB_NAMES = [
  "pncp.sync-open",
  "pncp.sync-updates",
  "pncp.sync-contracts",
  "rules.match",
  "notice.ingest-files",
  "notify.send",
  "notify.digest",
  "analysis.run",
  "bid.build-pack",
  "bid.render-doc",
  "docs.validate-upload",
  "docs.expiry-watch",
  "calendar.sync",
  "billing.webhook",
  "experience.extract",
  "org.embed-profile",
] as const satisfies readonly JobName[];
