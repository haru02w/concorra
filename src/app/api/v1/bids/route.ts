import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor(async ({ actor }) => ({ bids: await getDeps().bids.listByOrg(actor.organizationId) }));
