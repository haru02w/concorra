"use server";

import { revalidatePath } from "next/cache";
import {
  approveGeneratedDocument,
  cancelBid,
  editGeneratedDocument,
  markBidReady,
  markBidSubmitted,
  updateProposalPrices,
} from "@/application/use-cases/bids";
import { formNumber, formString, runAction, type ActionState } from "@/web/server/action";
import { getDeps } from "@/web/server/container";
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
    await updateProposalPrices(getDeps(), actor, bidId, prices);
    done(bidId);
  }, "Preços salvos. A proposta será regerada.");
}

export async function editDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    const markdown = form.get("markdown");
    await editGeneratedDocument(getDeps(), actor, formString(form, "docId"), typeof markdown === "string" ? markdown : "");
    done(bidId);
  }, "Documento salvo. Revise e aprove novamente.");
}

export async function approveDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    await approveGeneratedDocument(getDeps(), actor, formString(form, "docId"));
    done(bidId);
  }, "Documento aprovado.");
}

export async function markReady(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    await markBidReady(getDeps(), actor, bidId);
    done(bidId);
  }, "Licitação pronta para envio.");
}

export async function markSubmitted(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    await markBidSubmitted(getDeps(), actor, bidId);
    done(bidId);
  }, "Licitação marcada como enviada.");
}

export async function cancel(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const bidId = formString(form, "bidId");
  return runAction(async () => {
    await cancelBid(getDeps(), actor, bidId);
    done(bidId);
  }, "Participação cancelada.");
}
