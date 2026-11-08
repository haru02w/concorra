import { accepted, notFound, withActor } from "@/web/server/api";
import { getServices } from "@/web/server/container";
import { requestAnalysisSchema } from "./analysis.schemas";

export const getAnalysis = withActor<{ id: string }>(async ({ actor, params }) => {
  const analysis = await getServices().analysis.findLatestAnalysis(actor, params.id);
  return analysis ? { analysis } : notFound("Analysis", params.id);
});

/** Requests an AI analysis (plan-limited); runs in the worker. Body (optional): { force?: boolean }. */
export const requestAnalysis = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const { force } = requestAnalysisSchema.parse(await req.json().catch(() => ({})));
  return accepted({ analysis: await getServices().analysis.requestAnalysisByUser(actor, params.id, { force }) });
});
