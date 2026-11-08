import { searchNotices } from "@/application/use-cases/radar";
import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Search notices ranked by affinity with the organization profile. */
export const GET = withActor(async ({ req, actor }) => {
  const q = req.nextUrl.searchParams;
  const page = Math.max(1, Number(q.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.get("pageSize") ?? "20") || 20));
  const { rows, total } = await searchNotices(getDeps(), actor, {
    query: q.get("q") ?? undefined,
    uf: q.get("uf") ?? undefined,
    modalidadeId: q.get("modalidadeId") ? Number(q.get("modalidadeId")) : undefined,
    openOnly: q.get("openOnly") !== "false",
    page,
    pageSize,
  });
  return { notices: rows, total, page, pageSize };
});
