import { getUsageSummary } from "@/application/use-cases/billing";
import { PLANS } from "@/domain/billing/plans";
import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor(async ({ actor }) => ({ ...(await getUsageSummary(getDeps(), actor.organizationId)), plans: Object.values(PLANS) }));
