"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CompanyData } from "@/modules/shared/ports";
import type { Organization, Porte } from "@/domain/organization/organization";
import { onlyDigits } from "@/domain/shared/cnpj";
import { DomainError } from "@/domain/shared/errors";
import { formList, formNumber, formString, runAction, type ActionState } from "@/web/server/action";
import { getServices } from "@/web/server/container";
import { getSession, requireActor, setActiveOrganization, switchOrganization as switchTo } from "@/web/server/session";

const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

export type LookupState = { ok: boolean; error?: string; data?: CompanyData } | null;

export async function lookupAction(_state: LookupState, form: FormData): Promise<LookupState> {
  try {
    const data = await getServices().organizations.lookupCompany(formString(form, "cnpj"));
    return data ? { ok: true, data } : { ok: false, error: "CNPJ não encontrado na BrasilAPI. Preencha os dados manualmente." };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    return { ok: false, error: "Não foi possível consultar o CNPJ agora. Preencha manualmente." };
  }
}

export async function createOrganizationAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.demo) redirect("/radar");
  let created: Organization | null = null;
  const state = await runAction(async () => {
    const porte = formString(form, "porte");
    created = await getServices().organizations.createOrganization({
      user: session.user,
      cnpj: formString(form, "cnpj"),
      profile: {
        razaoSocial: formString(form, "razaoSocial") || undefined,
        nomeFantasia: formString(form, "nomeFantasia") || undefined,
        porte: (["ME", "EPP", "DEMAIS"].includes(porte) ? porte : undefined) as Porte | undefined,
        expertiseText: formString(form, "expertiseText"),
        ufs: formList(form, "ufs"),
        valueMin: formNumber(form, "valueMin"),
        valueMax: formNumber(form, "valueMax"),
        representante: formString(form, "representante") || undefined,
      },
    });
  });
  if (!state?.ok || !created) return state;
  await setActiveOrganization(session, created);
  redirect("/company");
}

/** Onboarding: pick one of the user's existing organizations. */
export async function switchAction(form: FormData) {
  const session = await getSession();
  if (!session || session.demo) redirect("/");
  await switchTo(formString(form, "organizationId"), "/radar");
}

/** Header organization switcher. */
export async function switchOrganization(organizationId: string) {
  await switchTo(organizationId, "/radar");
}

export async function updateProfileAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(async () => {
    const porte = formString(form, "porte");
    await getServices().organizations.updateProfile(actor, {
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

export async function inviteAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor, session } = await requireActor();
  if (session.demo) return { ok: false, error: "Indisponível na demonstração" };
  const role = formString(form, "role") === "owner" ? "owner" : "member";
  return runAction(() => getServices().organizations.inviteMember(actor, { email: formString(form, "email"), role }), "Convite enviado");
}

export async function deleteOrganizationAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor, session } = await requireActor();
  if (session.demo) return { ok: false, error: "Indisponível na demonstração" };
  if (onlyDigits(formString(form, "confirm")) !== session.organization!.cnpj) {
    return { ok: false, error: "Digite o CNPJ da organização para confirmar" };
  }
  const state = await runAction(() => getServices().organizations.deleteOrganization(actor));
  if (state?.ok) redirect("/");
  return state;
}
