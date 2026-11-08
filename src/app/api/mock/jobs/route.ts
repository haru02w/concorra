import { z } from "zod";
import { JOB_NAMES, type JobName, type JobPayloads } from "@/application/ports";
import { accepted, parseJson, withSession } from "@/web/server/api";
import { requireMockMode } from "@/web/server/mock";

/** MOCK_EXTERNAL only: enqueue any worker job now (e.g. { "name": "pncp.sync-open" }) instead of waiting for cron. */
export const POST = withSession(async ({ req }) => {
  const { jobs } = requireMockMode();
  const { name, data } = await parseJson(req, z.object({ name: z.enum(JOB_NAMES), data: z.record(z.string(), z.unknown()).default({}) }));
  await jobs.enqueue(name as JobName, data as JobPayloads[JobName]);
  return accepted({ enqueued: name });
});
