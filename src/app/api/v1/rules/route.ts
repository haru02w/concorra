import { createRule } from "@/application/use-cases/rules";
import { created, parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";
import { ruleSchema } from "../schemas";

export const GET = withActor(async ({ actor }) => ({ rules: await getDeps().rules.listByOrg(actor.organizationId) }));

export const POST = withActor(async ({ req, actor }) => created({ rule: await createRule(getDeps(), actor, await parseJson(req, ruleSchema)) }));
