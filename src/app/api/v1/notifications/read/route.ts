import { z } from "zod";
import { markNotificationsRead } from "@/application/use-cases/notifications";
import { parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Body: { ids: string[] } or { ids: "all" }. */
export const POST = withActor(async ({ req, actor }) => {
  const { ids } = await parseJson(req, z.object({ ids: z.union([z.literal("all"), z.array(z.string())]) }));
  await markNotificationsRead(getDeps(), actor, ids);
});
