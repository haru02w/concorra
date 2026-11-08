"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { disconnectCalendar } from "@/application/use-cases/calendar";
import { deleteOrganization, inviteMember } from "@/application/use-cases/organizations";
import { onlyDigits } from "@/domain/shared/cnpj";
import { formString, runAction, type ActionState } from "@/web/server/action";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export async function inviteAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor, session } = await requireActor();
  if (session.demo) return { ok: false, error: "Indisponível na demonstração" };
  const role = formString(form, "role") === "owner" ? "owner" : "member";
  return runAction(() => inviteMember(getDeps(), actor, { email: formString(form, "email"), role }), "Convite enviado");
}

export async function disconnectCalendarAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await requireActor();
  const state = await runAction(() => disconnectCalendar(getDeps(), actor, formString(form, "id")), "Agenda desconectada");
  revalidatePath("/settings");
  return state;
}

export async function deleteOrganizationAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { actor, session } = await requireActor();
  if (session.demo) return { ok: false, error: "Indisponível na demonstração" };
  if (onlyDigits(formString(form, "confirm")) !== session.organization!.cnpj) {
    return { ok: false, error: "Digite o CNPJ da organização para confirmar" };
  }
  const state = await runAction(() => deleteOrganization(getDeps(), actor));
  if (state?.ok) redirect("/");
  return state;
}
