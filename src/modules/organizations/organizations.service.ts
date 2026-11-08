import { normalizeCnpj } from "@/domain/shared/cnpj";
import { DomainError, ValidationError } from "@/domain/shared/errors";
import { assertWithinLimit } from "@/domain/billing/plans";
import { profileText, type Organization, type Role } from "@/domain/organization/organization";
import { l2normalize } from "@/domain/shared/vector";
import type { CompanyData, Deps, User } from "../shared/ports";
import { loadOrg, requireOwner, type Actor } from "../shared/context";

export interface CreateOrganizationInput {
  user: User;
  cnpj: string;
  profile: Partial<Pick<Organization, "razaoSocial" | "nomeFantasia" | "porte" | "expertiseText" | "ufs" | "valueMin" | "valueMax" | "representante">>;
}

export type ProfilePatch = Partial<
  Pick<Organization, "razaoSocial" | "nomeFantasia" | "porte" | "cnaePrincipal" | "cnaesSecundarios" | "endereco" | "representante" | "ufs" | "municipios" | "valueMin" | "valueMax" | "expertiseText">
>;

export class OrganizationsService {
  constructor(private readonly deps: Deps) {}

  async lookupCompany(cnpj: string): Promise<CompanyData | null> {
    return this.deps.companyLookup.findByCnpj(normalizeCnpj(cnpj));
  }

  /** F1: creates the organization (WorkOS + local), owner membership and Free subscription. */
  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    const cnpj = normalizeCnpj(input.cnpj);
    if (await this.deps.organizations.findByCnpj(cnpj)) {
      throw new DomainError("Já existe uma organização com este CNPJ. Peça um convite ao responsável.", "cnpj_taken");
    }
    const company = await this.deps.companyLookup.findByCnpj(cnpj).catch(() => null);
    const razaoSocial = input.profile.razaoSocial?.trim() || company?.razaoSocial;
    if (!razaoSocial) throw new ValidationError("Razão social é obrigatória");

    const workosOrgId = await this.deps.identity.createOrganization(razaoSocial, cnpj);
    const org = await this.deps.organizations.create({
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
    await this.deps.identity.addMember(workosOrgId, input.user.workosUserId, "owner");
    await this.deps.memberships.upsert(org.id, input.user.id, "owner");
    await this.deps.subscriptions.upsert({
      organizationId: org.id,
      planId: "free",
      pendingPlanId: null,
      status: "active",
      customerRef: null,
      checkoutRef: null,
      subscriptionRef: null,
      currentPeriodEnd: null,
    });
    await this.deps.jobs.enqueue("org.embed-profile", { organizationId: org.id });
    return org;
  }

  async updateProfile(actor: Actor, patch: ProfilePatch): Promise<Organization> {
    requireOwner(actor);
    if (patch.valueMin != null && patch.valueMax != null && patch.valueMin > patch.valueMax) {
      throw new ValidationError("Valor mínimo maior que o máximo");
    }
    const org = await this.deps.organizations.update(actor.organizationId, patch);
    await this.deps.jobs.enqueue("org.embed-profile", { organizationId: org.id }, { singletonKey: org.id });
    return org;
  }

  /** Job: recompute the organization profile embedding (expertise + CNAEs + experiences). */
  async embedProfile(input: { organizationId: string }): Promise<void> {
    const org = await loadOrg(this.deps, input.organizationId);
    const experiences = await this.deps.experiences.listByOrg(org.id);
    const text = profileText(org, experiences);
    if (!text.trim()) return;
    const [embedding] = await this.deps.ai.embed([text], "query");
    await this.deps.organizations.setProfileEmbedding(org.id, l2normalize(embedding));
  }

  async inviteMember(actor: Actor, input: { email: string; role: Role }): Promise<void> {
    requireOwner(actor);
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("E-mail inválido");
    const org = await loadOrg(this.deps, actor.organizationId);
    assertWithinLimit(org.planId, "members", await this.deps.memberships.count(org.id));
    await this.deps.identity.inviteMember({ email, workosOrgId: org.workosOrgId, role: input.role, inviterUserId: actor.workosUserId });
  }

  /** LGPD: remove every file and row of the organization. */
  async deleteOrganization(actor: Actor): Promise<void> {
    requireOwner(actor);
    const docs = await this.deps.documents.listByOrg(actor.organizationId);
    for (const doc of docs) {
      const file = await this.deps.files.findById(doc.fileId);
      if (file) await this.deps.storage.delete(file.storageKey).catch(() => undefined);
    }
    await this.deps.organizations.delete(actor.organizationId);
  }

  async listMembers(actor: Actor) {
    return this.deps.memberships.listByOrg(actor.organizationId);
  }
}
