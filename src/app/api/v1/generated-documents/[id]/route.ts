import { z } from "zod";
import { editGeneratedDocument } from "@/application/use-cases/bids";
import { parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Edits a generated document (back to draft, re-verified and re-rendered by the worker). */
export const PATCH = withActor<{ id: string }>(async ({ req, actor, params }) => {
  const { markdown } = await parseJson(req, z.object({ markdown: z.string() }));
  const deps = getDeps();
  await editGeneratedDocument(deps, actor, params.id, markdown);
  return { document: await deps.generatedDocs.findById(params.id) };
});
