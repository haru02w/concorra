import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor(async ({ actor }) => ({ members: await getDeps().memberships.listByOrg(actor.organizationId) }));
