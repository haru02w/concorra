import { z } from "zod";
import { updateProposalPrices } from "@/application/use-cases/bids";
import { parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Body: { prices: { [numeroItem]: unitPriceCents | null } }. Re-renders the proposta. */
export const PUT = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const { prices } = await parseJson(req, z.object({ prices: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative().nullable()) }));
  await updateProposalPrices(getDeps(), actor, params.id, Object.fromEntries(Object.entries(prices).map(([k, v]) => [Number(k), v])));
  return { lines: await getDeps().bids.getProposalLines(params.id) };
});
