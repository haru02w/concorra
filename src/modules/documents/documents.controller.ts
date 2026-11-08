import { NextResponse } from "next/server";
import { CERTIDAO_PORTALS } from "@/domain/documents/document";
import { NotFoundError } from "@/domain/shared/errors";
import { ApiError, created, notFound, parseUpload, withActor } from "@/web/server/api";
import { getServices } from "@/web/server/container";
import { getSession } from "@/web/server/session";
import { documentKindSchema } from "./documents.schemas";

export const listDocuments = withActor(async ({ actor }) => ({ documents: await getServices().documents.listDocuments(actor), portals: CERTIDAO_PORTALS }));

/** multipart/form-data: `kind` + `file` (PDF/PNG/JPEG ≤ 15 MB). Validated by AI + code in the worker. */
export const uploadDocument = withActor(async ({ req, actor }) => {
  const { form, upload } = await parseUpload(req);
  const kind = documentKindSchema.safeParse(form.get("kind"));
  if (!kind.success) throw new ApiError(400, "invalid_kind", "Field \"kind\" must be a document kind");
  return created({ document: await getServices().documents.uploadDocument(actor, { kind: kind.data, upload }) });
});

export const getDocument = withActor<{ id: string }>(async ({ actor, params }) => {
  const document = await getServices().documents.findDocument(actor, params.id);
  return document ? { document } : notFound("Document", params.id);
});

export const deleteDocument = withActor<{ id: string }>(async ({ actor, params }) => {
  await getServices().documents.deleteDocument(actor, params.id);
});

/** GET /api/files/{id}: org-scoped download, redirects to a short-lived presigned URL. */
export async function downloadFile(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.redirect(await getServices().documents.fileDownloadUrl(session.actor, id), 302);
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
