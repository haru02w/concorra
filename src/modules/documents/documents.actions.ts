"use server";

import { revalidatePath } from "next/cache";
import { DOCUMENT_KINDS, type DocumentKind } from "@/domain/documents/document";
import { ValidationError } from "@/domain/shared/errors";
import { formString, formUpload, runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export async function upload(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  return runAction(async () => {
    const kind = formString(form, "kind");
    if (!DOCUMENT_KINDS.includes(kind as DocumentKind)) throw new ValidationError("Escolha o tipo do documento");
    const file = await formUpload(form, "file");
    if (!file) throw new ValidationError("Selecione um arquivo");
    await getServices().documents.uploadDocument(actor, { kind: kind as DocumentKind, upload: file });
    revalidatePath("/documents");
  }, "Documento enviado. A validação por IA começou.");
}

export async function remove(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  return runAction(async () => {
    await getServices().documents.deleteDocument(actor, formString(form, "documentId"));
    revalidatePath("/documents");
  }, "Documento excluído.");
}
