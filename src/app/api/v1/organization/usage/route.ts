import { getUsageSummary } from "@/application/use-cases/billing";
import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor(async ({ actor }) => getUsageSummary(getDeps(), actor.organizationId));
