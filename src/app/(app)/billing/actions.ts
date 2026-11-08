"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelSubscription, startCheckout } from "@/application/use-cases/billing";
import { formString, runAction, type ActionState } from "@/web/server/action";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export async function checkoutAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const planId = formString(form, "planId");
  if (planId !== "pro" && planId !== "business") return { ok: false, error: "Plano inválido" };
  let url = "";
  const state = await runAction(async () => {
    url = await startCheckout(getDeps(), actor, planId);
  });
  if (state?.ok && url) redirect(url);
  return state;
}

export async function cancelAction(_state: ActionState): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(() => cancelSubscription(getDeps(), actor), "Assinatura cancelada");
  revalidatePath("/billing");
  return state;
}
