import { cancelSubscription } from "@/application/use-cases/billing";
import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const POST = withActor(async ({ actor }) => {
  await cancelSubscription(getDeps(), actor);
});
