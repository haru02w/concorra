import { approveGeneratedDocument } from "@/application/use-cases/bids";
import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const POST = withActor<{ id: string }>(async ({ actor, params }) => {
  const deps = getDeps();
  await approveGeneratedDocument(deps, actor, params.id);
  return { document: await deps.generatedDocs.findById(params.id) };
});
