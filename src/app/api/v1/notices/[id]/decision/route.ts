import { z } from "zod";
import { decideParticipation } from "@/application/use-cases/bids";
import { created, parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** F5: participate (builds the bid pack) or skip. */
export const POST = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const input = await parseJson(req, z.object({ decision: z.enum(["participate", "skip"]), reason: z.string().optional() }));
  return created({ bid: await decideParticipation(getDeps(), actor, { noticeId: params.id, ...input }) });
});
