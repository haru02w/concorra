import { z } from "zod";
import { requestAnalysisByUser } from "@/application/use-cases/analysis";
import { accepted, notFound, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor<{ id: string }>(async ({ actor, params }) => {
  const analysis = await getDeps().analyses.findLatest(actor.organizationId, params.id);
  return analysis ? { analysis } : notFound("Analysis", params.id);
});

/** Requests an AI analysis (plan-limited); runs in the worker. Body: { force?: boolean }. */
export const POST = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const { force } = z.object({ force: z.boolean().default(false) }).parse(await req.json().catch(() => ({})));
  return accepted({ analysis: await requestAnalysisByUser(getDeps(), actor, params.id, { force }) });
});
