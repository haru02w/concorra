import { deleteDocument } from "@/application/use-cases/documents";
import { notFound, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor<{ id: string }>(async ({ actor, params }) => {
  const document = await getDeps().documents.findById(actor.organizationId, params.id);
  return document ? { document } : notFound("Document", params.id);
});

export const DELETE = withActor<{ id: string }>(async ({ actor, params }) => {
  await deleteDocument(getDeps(), actor, params.id);
});
