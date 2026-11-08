"use server";

import { revalidatePath } from "next/cache";
import { formString, runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export async function disconnectCalendarAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(() => getServices().calendar.disconnectCalendar(actor, formString(form, "id")), "Agenda desconectada");
  revalidatePath("/settings");
  return state;
}
