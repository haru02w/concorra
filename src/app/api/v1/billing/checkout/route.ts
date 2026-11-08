import { z } from "zod";
import { startCheckout } from "@/application/use-cases/billing";
import { parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Opens an AbacatePay subscription checkout. Body: { planId: "pro" | "business" } → { url }. */
export const POST = withActor(async ({ req, actor }) => {
  const { planId } = await parseJson(req, z.object({ planId: z.enum(["pro", "business"]) }));
  return { url: await startCheckout(getDeps(), actor, planId) };
});
