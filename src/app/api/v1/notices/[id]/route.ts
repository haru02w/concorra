import { openNotice } from "@/application/use-cases/radar";
import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Notice detail; first open triggers lazy file ingestion. */
export const GET = withActor<{ id: string }>(async ({ actor, params }) => {
  const deps = getDeps();
  const view = await openNotice(deps, actor, params.id);
  const [analysis, bid] = await Promise.all([deps.analyses.findLatest(actor.organizationId, params.id), deps.bids.findByNotice(actor.organizationId, params.id)]);
  return { ...view, analysis, bid };
});
