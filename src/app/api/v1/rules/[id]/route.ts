import { deleteRule, updateRule } from "@/application/use-cases/rules";
import { notFound, parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";
import { ruleSchema } from "../../schemas";

export const GET = withActor<{ id: string }>(async ({ actor, params }) => {
  const rule = await getDeps().rules.findById(actor.organizationId, params.id);
  return rule ? { rule } : notFound("Rule", params.id);
});

export const PUT = withActor<{ id: string }>(async ({ req, actor, params }) => ({
  rule: await updateRule(getDeps(), actor, params.id, await parseJson(req, ruleSchema)),
}));

export const DELETE = withActor<{ id: string }>(async ({ actor, params }) => {
  await deleteRule(getDeps(), actor, params.id);
});
