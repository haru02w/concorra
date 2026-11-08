"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formString, runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export async function checkoutAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const planId = formString(form, "planId");
  if (planId !== "pro" && planId !== "business") return { ok: false, error: "Plano inválido" };
  let url = "";
  const state = await runAction(async () => {
    url = await getServices().billing.startCheckout(actor, planId);
  });
  if (state?.ok && url) redirect(url);
  return state;
}

export async function cancelAction(_state: ActionState): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(() => getServices().billing.cancelSubscription(actor), "Assinatura cancelada");
  revalidatePath("/billing");
  return state;
}
