import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor(async ({ actor }) => ({ matches: await getDeps().matches.listByOrg(actor.organizationId, 100) }));
