"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestAnalysisByUser } from "@/application/use-cases/analysis";
import { decideParticipation } from "@/application/use-cases/bids";
import { formString, runAction, type ActionState } from "@/web/server/action";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export async function requestAnalysisAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const noticeId = formString(form, "noticeId");
  const result = await runAction(
    () => requestAnalysisByUser(getDeps(), actor, noticeId, { force: formString(form, "force") === "1" }),
    "Análise solicitada. Isso leva alguns minutos.",
  );
  revalidatePath(`/radar/${noticeId}`);
  return result;
}

export async function participateAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const noticeId = formString(form, "noticeId");
  let bidId: string | null = null;
  const result = await runAction(async () => {
    bidId = (await decideParticipation(getDeps(), actor, { noticeId, decision: "participate" })).id;
  });
  if (bidId) {
    revalidatePath(`/radar/${noticeId}`);
    redirect(`/bids/${bidId}`);
  }
  return result;
}

export async function skipAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const noticeId = formString(form, "noticeId");
  const reason = formString(form, "reason");
  const result = await runAction(
    () => decideParticipation(getDeps(), actor, { noticeId, decision: "skip", reason: reason || undefined }),
    "Licitação descartada.",
  );
  revalidatePath(`/radar/${noticeId}`);
  return result;
}
