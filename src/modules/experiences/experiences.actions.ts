"use server";

import { revalidatePath } from "next/cache";
import { ValidationError } from "@/domain/shared/errors";
import { formString, formUpload, runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

const toDate = (v: string) => (v ? new Date(`${v}T00:00:00-03:00`) : null);

export async function uploadExperienceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(async () => {
    const upload = await formUpload(form, "file");
    if (!upload) throw new ValidationError("Selecione um arquivo");
    await getServices().experiences.uploadExperience(actor, upload);
  }, "Arquivo enviado — a IA está extraindo os dados");
  revalidatePath("/company");
  return state;
}

export async function addExperienceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(
    () =>
      getServices().experiences.addExperienceManually(actor, {
        object: formString(form, "object"),
        issuer: formString(form, "issuer") || null,
        quantities: formString(form, "quantities") || null,
        periodStart: toDate(formString(form, "periodStart")),
        periodEnd: toDate(formString(form, "periodEnd")),
      }),
    "Experiência adicionada",
  );
  revalidatePath("/company");
  return state;
}

export async function deleteExperienceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(() => getServices().experiences.deleteExperience(actor, formString(form, "id")), "Experiência removida");
  revalidatePath("/company");
  return state;
}
