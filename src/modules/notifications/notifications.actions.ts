"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export async function markAllReadAction(_state: ActionState): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(() => getServices().notifications.markNotificationsRead(actor, "all"));
  revalidatePath("/", "layout");
  return state;
}
