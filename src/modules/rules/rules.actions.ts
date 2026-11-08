"use server";

import { revalidatePath } from "next/cache";
import { onlyDigits } from "@/domain/shared/cnpj";
import { ValidationError } from "@/domain/shared/errors";
import type { Channel, Frequency } from "@/domain/rules/rule";
import { formList, formNumber, formString, runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import type { RuleInput } from "./rules.service";

/** Decimal fraction that accepts "0,6" and "0.6" (formNumber treats "." as thousands separator). */
function fraction(form: FormData, key: string): number | null {
  const v = formString(form, key).replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ValidationError("Número inválido");
  return n;
}

function parseRule(form: FormData): RuleInput {
  const threshold = fraction(form, "semanticThreshold");
  const minScore = formNumber(form, "minScore");
  if (threshold !== null && (threshold < 0 || threshold > 1)) throw new ValidationError("A similaridade deve ficar entre 0 e 1");
  return {
    name: formString(form, "name"),
    filters: {
      keywordsInclude: formList(form, "keywordsInclude"),
      keywordsExclude: formList(form, "keywordsExclude"),
      ufs: form.getAll("ufs").map(String),
      municipiosIbge: [],
      modalidadeIds: form.getAll("modalidadeIds").map(Number).filter(Number.isFinite),
      orgaoCnpjs: formList(form, "orgaoCnpjs").map(onlyDigits).filter(Boolean),
      valueMin: formNumber(form, "valueMin"),
      valueMax: formNumber(form, "valueMax"),
    },
    semanticThreshold: threshold,
    minScore: minScore === null ? null : Math.round(minScore),
    channels: form.getAll("channels").map(String) as Channel[],
    frequency: (formString(form, "frequency") === "daily" ? "daily" : "immediate") as Frequency,
    active: form.get("active") === "on",
  };
}

export async function saveRuleAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const id = formString(form, "id");
  const result = await runAction(async () => {
    const input = parseRule(form);
    if (id) await getServices().rules.updateRule(actor, id, input);
    else await getServices().rules.createRule(actor, input);
  }, id ? "Regra atualizada." : "Regra criada.");
  revalidatePath("/rules");
  return result;
}

export async function toggleRuleAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const { rules } = getServices();
  const id = formString(form, "id");
  const result = await runAction(async () => {
    const rule = await rules.findRule(actor, id);
    if (!rule) throw new ValidationError("Regra não encontrada");
    const { id: _id, organizationId: _org, ...input } = rule;
    await rules.updateRule(actor, id, { ...input, active: !rule.active });
  });
  revalidatePath("/rules");
  return result;
}

export async function deleteRuleAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const result = await runAction(() => getServices().rules.deleteRule(actor, formString(form, "id")), "Regra excluída.");
  revalidatePath("/rules");
  return result;
}
