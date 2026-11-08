import { normalizeCnpj } from "@/domain/shared/cnpj";
import { DomainError, ValidationError } from "@/domain/shared/errors";
import { assertWithinLimit } from "@/domain/billing/plans";
import { profileText, type Organization, type Role } from "@/domain/organization/organization";
import { l2normalize } from "@/domain/shared/vector";
import type { CompanyData, Deps, User } from "../ports";
import { loadOrg, requireOwner, type Actor } from "./context";

export async function lookupCompany(deps: Pick<Deps, "companyLookup">, cnpj: string): Promise<CompanyData | null> {
  return deps.companyLookup.findByCnpj(normalizeCnpj(cnpj));
}

export interface CreateOrganizationInput {
  user: User;
  cnpj: string;
  profile: Partial<Pick<Organization, "razaoSocial" | "nomeFantasia" | "porte" | "expertiseText" | "ufs" | "valueMin" | "valueMax" | "representante">>;
}

/** F1: creates the organization (WorkOS + local), owner membership and Free subscription. */
export async function createOrganization(
  deps: Pick<Deps, "organizations" | "memberships" | "subscriptions" | "companyLookup" | "identity" | "jobs">,
  input: CreateOrganizationInput,
): Promise<Organization> {
  const cnpj = normalizeCnpj(input.cnpj);
  if (await deps.organizations.findByCnpj(cnpj)) {
    throw new DomainError("Já existe uma organização com este CNPJ. Peça um convite ao responsável.", "cnpj_taken");
  }
  const company = await deps.companyLookup.findByCnpj(cnpj).catch(() => null);
  const razaoSocial = input.profile.razaoSocial?.trim() || company?.razaoSocial;
  if (!razaoSocial) throw new ValidationError("Razão social é obrigatória");

  const workosOrgId = await deps.identity.createOrganization(razaoSocial, cnpj);
  const org = await deps.organizations.create({
    workosOrgId,
    cnpj,
    razaoSocial,
    nomeFantasia: input.profile.nomeFantasia ?? company?.nomeFantasia ?? null,
    porte: input.profile.porte ?? company?.porte ?? "DEMAIS",
    cnaePrincipal: company?.cnaePrincipal ?? null,
    cnaesSecundarios: company?.cnaesSecundarios ?? [],
    endereco: company?.endereco ?? null,
    municipio: company?.municipio ?? null,
    uf: company?.uf ?? null,
    representante: input.profile.representante ?? company?.representante ?? null,
    ufs: input.profile.ufs ?? (company?.uf ? [company.uf] : []),
    municipios: [],
    valueMin: input.profile.valueMin ?? null,
    valueMax: input.profile.valueMax ?? null,
    expertiseText: input.profile.expertiseText ?? "",
    planId: "free",
  });
  await deps.identity.addMember(workosOrgId, input.user.workosUserId, "owner");
  await deps.memberships.upsert(org.id, input.user.id, "owner");
  await deps.subscriptions.upsert({
    organizationId: org.id,
    planId: "free",
    pendingPlanId: null,
    status: "active",
    customerRef: null,
    checkoutRef: null,
    subscriptionRef: null,
    currentPeriodEnd: null,
  });
  await deps.jobs.enqueue("org.embed-profile", { organizationId: org.id });
  return org;
}

export type ProfilePatch = Partial<
  Pick<Organization, "razaoSocial" | "nomeFantasia" | "porte" | "cnaePrincipal" | "cnaesSecundarios" | "endereco" | "representante" | "ufs" | "municipios" | "valueMin" | "valueMax" | "expertiseText">
>;

export async function updateProfile(deps: Pick<Deps, "organizations" | "jobs">, actor: Actor, patch: ProfilePatch): Promise<Organization> {
  requireOwner(actor);
  if (patch.valueMin != null && patch.valueMax != null && patch.valueMin > patch.valueMax) {
    throw new ValidationError("Valor mínimo maior que o máximo");
  }
  const org = await deps.organizations.update(actor.organizationId, patch);
  await deps.jobs.enqueue("org.embed-profile", { organizationId: org.id }, { singletonKey: org.id });
  return org;
}

/** Job: recompute the organization profile embedding (expertise + CNAEs + experiences). */
export async function embedProfile(deps: Pick<Deps, "organizations" | "experiences" | "ai">, input: { organizationId: string }): Promise<void> {
  const org = await loadOrg(deps, input.organizationId);
  const experiences = await deps.experiences.listByOrg(org.id);
  const text = profileText(org, experiences);
  if (!text.trim()) return;
  const [embedding] = await deps.ai.embed([text], "query");
  await deps.organizations.setProfileEmbedding(org.id, l2normalize(embedding));
}

export async function inviteMember(
  deps: Pick<Deps, "organizations" | "memberships" | "identity">,
  actor: Actor,
  input: { email: string; role: Role },
): Promise<void> {
  requireOwner(actor);
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("E-mail inválido");
  const org = await loadOrg(deps, actor.organizationId);
  assertWithinLimit(org.planId, "members", await deps.memberships.count(org.id));
  await deps.identity.inviteMember({ email, workosOrgId: org.workosOrgId, role: input.role, inviterUserId: actor.workosUserId });
}

/** LGPD: remove every file and row of the organization. */
export async function deleteOrganization(deps: Pick<Deps, "organizations" | "documents" | "files" | "storage">, actor: Actor): Promise<void> {
  requireOwner(actor);
  const docs = await deps.documents.listByOrg(actor.organizationId);
  for (const doc of docs) {
    const file = await deps.files.findById(doc.fileId);
    if (file) await deps.storage.delete(file.storageKey).catch(() => undefined);
  }
  await deps.organizations.delete(actor.organizationId);
}
