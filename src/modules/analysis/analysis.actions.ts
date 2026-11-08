"use server";

import { revalidatePath } from "next/cache";
import { formString, runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export async function requestAnalysisAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const noticeId = formString(form, "noticeId");
  const result = await runAction(
    () => getServices().analysis.requestAnalysisByUser(actor, noticeId, { force: formString(form, "force") === "1" }),
    "Análise solicitada. Isso leva alguns minutos.",
  );
  revalidatePath(`/radar/${noticeId}`);
  return result;
}
