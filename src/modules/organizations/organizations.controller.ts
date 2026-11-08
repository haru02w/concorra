import { accepted, created, notFound, parseJson, withActor, withSession } from "@/web/server/api";
import { getServices } from "@/web/server/container";
import { setActiveOrganization } from "@/web/server/session";
import { createOrganizationSchema, inviteSchema, profileSchema } from "./organizations.schemas";

/** GET /api/v1/companies/{cnpj}: BrasilAPI lookup used to prefill onboarding. */
export const lookupCompany = withSession<{ cnpj: string }>(async ({ params }) => {
  const company = await getServices().organizations.lookupCompany(params.cnpj);
  return company ? { company } : notFound("Company", params.cnpj);
});

/** POST /api/v1/organizations: creates an organization (F1) and makes it the session's active one. */
export const createOrganization = withSession(async ({ req, session }) => {
  const input = await parseJson(req, createOrganizationSchema);
  const organization = await getServices().organizations.createOrganization({
    user: session.user,
    cnpj: input.cnpj,
    profile: { ...input.profile, nomeFantasia: input.profile.nomeFantasia ?? undefined, representante: input.profile.representante ?? undefined },
  });
  await setActiveOrganization(session, organization);
  return created({ organization });
});

export const getOrganization = withActor(async ({ session, actor }) => ({ organization: session.organization, role: actor.role }));

export const updateOrganization = withActor(async ({ req, actor }) => ({
  organization: await getServices().organizations.updateProfile(actor, await parseJson(req, profileSchema)),
}));

/** LGPD: deletes the organization's data. */
export const deleteOrganization = withActor(async ({ actor }) => {
  await getServices().organizations.deleteOrganization(actor);
});

export const listMembers = withActor(async ({ actor }) => ({ members: await getServices().organizations.listMembers(actor) }));

/** Sends a WorkOS invitation. Body: { email, role }. */
export const inviteMember = withActor(async ({ req, actor }) => {
  const input = await parseJson(req, inviteSchema);
  await getServices().organizations.inviteMember(actor, input);
  return accepted({ invited: input.email });
});
