"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formNumber, formString, runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

function done(bidId: string) {
  revalidatePath(`/bids/${bidId}`);
  revalidatePath("/bids");
}

export async function savePrices(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    const prices: Record<number, number | null> = {};
    for (const key of form.keys()) {
      const match = /^price_(\d+)$/.exec(key);
      if (!match) continue;
      const reais = formNumber(form, key);
      prices[Number(match[1])] = reais === null ? null : Math.round(reais * 100);
    }
    await getServices().bids.updateProposalPrices(actor, bidId, prices);
    done(bidId);
  }, "Preços salvos. A proposta será regerada.");
}

export async function editDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    const markdown = form.get("markdown");
    await getServices().bids.editGeneratedDocument(actor, formString(form, "docId"), typeof markdown === "string" ? markdown : "");
    done(bidId);
  }, "Documento salvo. Revise e aprove novamente.");
}

export async function approveDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    await getServices().bids.approveGeneratedDocument(actor, formString(form, "docId"));
    done(bidId);
  }, "Documento aprovado.");
}

export async function markReady(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    await getServices().bids.markBidReady(actor, bidId);
    done(bidId);
  }, "Licitação pronta para envio.");
}

export async function markSubmitted(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    await getServices().bids.markBidSubmitted(actor, bidId);
    done(bidId);
  }, "Licitação marcada como enviada.");
}

export async function cancel(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    await getServices().bids.cancelBid(actor, bidId);
    done(bidId);
  }, "Participação cancelada.");
}

export async function participateAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const noticeId = formString(form, "noticeId");
  let bidId: string | null = null;
  const result = await runAction(async () => {
    bidId = (await getServices().bids.decideParticipation(actor, { noticeId, decision: "participate" })).id;
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
    () => getServices().bids.decideParticipation(actor, { noticeId, decision: "skip", reason: reason || undefined }),
    "Licitação descartada.",
  );
  revalidatePath(`/radar/${noticeId}`);
  return result;
}
