import { notFound, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Bid with its pack: checklist, proposal lines, price references, generated documents, calendar events. */
export const GET = withActor<{ id: string }>(async ({ actor, params }) => {
  const deps = getDeps();
  const bid = await deps.bids.findById(actor.organizationId, params.id);
  if (!bid) notFound("Bid", params.id);
  const [notice, checklist, proposalLines, priceReferences, documents, events] = await Promise.all([
    deps.notices.findById(bid.noticeId),
    deps.bids.getChecklist(bid.id),
    deps.bids.getProposalLines(bid.id),
    deps.bids.getPriceReferences(bid.id),
    deps.generatedDocs.listByBid(bid.id),
    deps.calendars.listEventsByRef("bid", bid.id),
  ]);
  return { bid, notice, checklist, proposalLines, priceReferences, documents, calendarEvents: events.length };
});
