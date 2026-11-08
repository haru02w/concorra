import { withActor } from "@/web/server/api";
import { getServices } from "@/web/server/container";

/** Search notices ranked by affinity with the organization profile. */
export const searchNotices = withActor(async ({ req, actor }) => {
  const q = req.nextUrl.searchParams;
  const page = Math.max(1, Number(q.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.get("pageSize") ?? "20") || 20));
  const { rows, total } = await getServices().notices.searchNotices(actor, {
    query: q.get("q") ?? undefined,
    uf: q.get("uf") ?? undefined,
    modalidadeId: q.get("modalidadeId") ? Number(q.get("modalidadeId")) : undefined,
    openOnly: q.get("openOnly") !== "false",
    page,
    pageSize,
  });
  return { notices: rows, total, page, pageSize };
});

/** Notice detail with the latest analysis and bid; first open triggers lazy file ingestion. */
export const getNotice = withActor<{ id: string }>(async ({ actor, params }) => {
  const { notices, analysis, bids } = getServices();
  const view = await notices.openNotice(actor, params.id);
  const [latest, bid] = await Promise.all([analysis.findLatestAnalysis(actor, params.id), bids.findBidForNotice(actor, params.id)]);
  return { ...view, analysis: latest, bid };
});
