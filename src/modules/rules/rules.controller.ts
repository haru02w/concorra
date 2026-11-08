import { created, notFound, parseJson, withActor } from "@/web/server/api";
import { getServices } from "@/web/server/container";
import { ruleSchema } from "./rules.schemas";

export const listRules = withActor(async ({ actor }) => ({ rules: await getServices().rules.listRules(actor) }));

export const createRule = withActor(async ({ req, actor }) => created({ rule: await getServices().rules.createRule(actor, await parseJson(req, ruleSchema)) }));

export const getRule = withActor<{ id: string }>(async ({ actor, params }) => {
  const rule = await getServices().rules.findRule(actor, params.id);
  return rule ? { rule } : notFound("Rule", params.id);
});

export const updateRule = withActor<{ id: string }>(async ({ req, actor, params }) => ({
  rule: await getServices().rules.updateRule(actor, params.id, await parseJson(req, ruleSchema)),
}));

export const deleteRule = withActor<{ id: string }>(async ({ actor, params }) => {
  await getServices().rules.deleteRule(actor, params.id);
});

export const listMatches = withActor(async ({ actor }) => ({ matches: await getServices().rules.listMatches(actor, 100) }));
