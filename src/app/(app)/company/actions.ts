"use server";

import { revalidatePath } from "next/cache";
import { addExperienceManually, deleteExperience, uploadExperience } from "@/application/use-cases/experiences";
import { updateProfile } from "@/application/use-cases/organizations";
import type { Porte } from "@/domain/organization/organization";
import { ValidationError } from "@/domain/shared/errors";
import { formList, formNumber, formString, formUpload, runAction, type ActionState } from "@/web/server/action";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

const toDate = (v: string) => (v ? new Date(`${v}T00:00:00-03:00`) : null);
const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

export async function updateProfileAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(async () => {
    const porte = formString(form, "porte");
    await updateProfile(getDeps(), actor, {
      razaoSocial: formString(form, "razaoSocial"),
      nomeFantasia: formString(form, "nomeFantasia") || null,
      porte: (["ME", "EPP", "DEMAIS"].includes(porte) ? porte : "DEMAIS") as Porte,
      cnaePrincipal: formString(form, "cnaePrincipal") || null,
      cnaesSecundarios: lines(formString(form, "cnaesSecundarios")),
      endereco: formString(form, "endereco") || null,
      representante: formString(form, "representante") || null,
      ufs: formList(form, "ufs"),
      municipios: formList(form, "municipios"),
      valueMin: formNumber(form, "valueMin"),
      valueMax: formNumber(form, "valueMax"),
      expertiseText: formString(form, "expertiseText"),
    });
  }, "Perfil atualizado");
  revalidatePath("/company");
  return state;
}

export async function uploadExperienceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(async () => {
    const upload = await formUpload(form, "file");
    if (!upload) throw new ValidationError("Selecione um arquivo");
    await uploadExperience(getDeps(), actor, upload);
  }, "Arquivo enviado — a IA está extraindo os dados");
  revalidatePath("/company");
  return state;
}

export async function addExperienceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(
    () =>
      addExperienceManually(getDeps(), actor, {
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
  const state = await runAction(() => deleteExperience(getDeps(), actor, formString(form, "id")), "Experiência removida");
  revalidatePath("/company");
  return state;
}
