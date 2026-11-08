import { deleteOrganization, updateProfile } from "@/application/use-cases/organizations";
import { parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";
import { profileSchema } from "../schemas";

export const GET = withActor(async ({ session, actor }) => ({ organization: session.organization, role: actor.role }));

export const PATCH = withActor(async ({ req, actor }) => ({ organization: await updateProfile(getDeps(), actor, await parseJson(req, profileSchema)) }));

/** LGPD: deletes the organization's data. */
export const DELETE = withActor(async ({ actor }) => {
  await deleteOrganization(getDeps(), actor);
});
