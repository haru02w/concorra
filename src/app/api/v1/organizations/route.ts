import { createOrganization } from "@/application/use-cases/organizations";
import { created, parseJson, withSession } from "@/web/server/api";
import { getDeps } from "@/web/server/container";
import { setActiveOrganization } from "@/web/server/session";
import { createOrganizationSchema } from "../schemas";

/** Creates an organization (F1) and makes it the session's active one. */
export const POST = withSession(async ({ req, session }) => {
  const input = await parseJson(req, createOrganizationSchema);
  const organization = await createOrganization(getDeps(), {
    user: session.user,
    cnpj: input.cnpj,
    profile: { ...input.profile, nomeFantasia: input.profile.nomeFantasia ?? undefined, representante: input.profile.representante ?? undefined },
  });
  await setActiveOrganization(session, organization);
  return created({ organization });
});
