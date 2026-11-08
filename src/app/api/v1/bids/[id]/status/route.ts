import { z } from "zod";
import { cancelBid, markBidReady, markBidSubmitted } from "@/application/use-cases/bids";
import { parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Body: { status: "ready" | "submitted" | "cancelled" }. */
export const POST = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const { status } = await parseJson(req, z.object({ status: z.enum(["ready", "submitted", "cancelled"]) }));
  const deps = getDeps();
  const bid =
    status === "ready" ? await markBidReady(deps, actor, params.id) : status === "submitted" ? await markBidSubmitted(deps, actor, params.id) : await cancelBid(deps, actor, params.id);
  return { bid };
});
