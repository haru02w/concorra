import { NextResponse } from "next/server";
import { NotFoundError } from "@/domain/shared/errors";
import { created, parseJson, withActor } from "@/web/server/api";
import { getServices } from "@/web/server/container";
import { getSession } from "@/web/server/session";
import { decisionSchema, markdownSchema, pricesSchema, statusSchema } from "./bids.schemas";

/** POST /api/v1/notices/{id}/decision (F5): participate (builds the bid pack) or skip. */
export const decide = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const input = await parseJson(req, decisionSchema);
  return created({ bid: await getServices().bids.decideParticipation(actor, { noticeId: params.id, ...input }) });
});

export const listBids = withActor(async ({ actor }) => ({ bids: await getServices().bids.listBids(actor) }));

/** Bid with its pack: checklist, proposal lines, price references, generated documents, calendar events. */
export const getBid = withActor<{ id: string }>(async ({ actor, params }) => {
  const { bid, notice, checklist, proposalLines, priceReferences, documents, calendarEvents } = await getServices().bids.getBidDetail(actor, params.id);
  return { bid, notice, checklist, proposalLines, priceReferences, documents, calendarEvents };
});

/** Body: { prices: { [numeroItem]: unitPriceCents | null } }. Re-renders the proposta. */
export const updatePrices = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const { prices } = await parseJson(req, pricesSchema);
  const byItem = Object.fromEntries(Object.entries(prices).map(([k, v]) => [Number(k), v]));
  return { lines: await getServices().bids.updateProposalPrices(actor, params.id, byItem) };
});

/** Body: { status: "ready" | "submitted" | "cancelled" }. */
export const updateStatus = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const { status } = await parseJson(req, statusSchema);
  const { bids } = getServices();
  const bid =
    status === "ready" ? await bids.markBidReady(actor, params.id) : status === "submitted" ? await bids.markBidSubmitted(actor, params.id) : await bids.cancelBid(actor, params.id);
  return { bid };
});

/** Edits a generated document (back to draft, re-verified and re-rendered by the worker). */
export const editGeneratedDocument = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const { markdown } = await parseJson(req, markdownSchema);
  return { document: await getServices().bids.editGeneratedDocument(actor, params.id, markdown) };
});

export const approveGeneratedDocument = withActor<{ id: string }>(async ({ actor, params }) => ({
  document: await getServices().bids.approveGeneratedDocument(actor, params.id),
}));

/** GET /api/bids/{id}/zip: the bid pack (generated DOCX/PDF, vault documents, checklist, instructions). */
export async function downloadZip(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const { name, bytes } = await getServices().bids.exportBidZip(session.actor, id);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
