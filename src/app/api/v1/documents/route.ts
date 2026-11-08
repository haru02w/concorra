import { uploadDocument } from "@/application/use-cases/documents";
import { CERTIDAO_PORTALS } from "@/domain/documents/document";
import { ApiError, created, parseUpload, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";
import { documentKindSchema } from "../schemas";

export const GET = withActor(async ({ actor }) => ({ documents: await getDeps().documents.listByOrg(actor.organizationId), portals: CERTIDAO_PORTALS }));

/** multipart/form-data: `kind` + `file` (PDF/PNG/JPEG ≤ 15 MB). Validated by AI + code in the worker. */
export const POST = withActor(async ({ req, actor }) => {
  const { form, upload } = await parseUpload(req);
  const kind = documentKindSchema.safeParse(form.get("kind"));
  if (!kind.success) throw new ApiError(400, "invalid_kind", "Field \"kind\" must be a document kind");
  return created({ document: await uploadDocument(getDeps(), actor, { kind: kind.data, upload }) });
});
