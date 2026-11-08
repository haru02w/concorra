"use server";

import { switchToOrganization } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import type { CompanyData } from "@/application/ports";
import { createOrganization, lookupCompany } from "@/application/use-cases/organizations";
import type { Porte } from "@/domain/organization/organization";
import { DomainError } from "@/domain/shared/errors";
import { formList, formNumber, formString, runAction, type ActionState } from "@/web/server/action";
import { getDeps } from "@/web/server/container";
import { getSession } from "@/web/server/session";

export type LookupState = { ok: boolean; error?: string; data?: CompanyData } | null;

export async function lookupAction(_state: LookupState, form: FormData): Promise<LookupState> {
  try {
    const data = await lookupCompany(getDeps(), formString(form, "cnpj"));
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
  let workosOrgId = "";
  const state = await runAction(async () => {
    const porte = formString(form, "porte");
    const org = await createOrganization(getDeps(), {
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
    workosOrgId = org.workosOrgId;
  });
  if (!state?.ok) return state;
  await switchToOrganization(workosOrgId, { returnTo: "/company" });
  return state;
}

export async function switchAction(form: FormData) {
  const session = await getSession();
  if (!session || session.demo) redirect("/");
  await switchToOrganization(formString(form, "workosOrgId"), { returnTo: "/radar" });
}
