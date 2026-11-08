import { addExperienceManually, uploadExperience } from "@/application/use-cases/experiences";
import { created, parseJson, parseUpload, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";
import { experienceSchema } from "../schemas";

export const GET = withActor(async ({ actor }) => ({ experiences: await getDeps().experiences.listByOrg(actor.organizationId) }));

/** JSON body: manual experience. multipart/form-data (`file`): atestado upload, extracted by AI in the worker. */
export const POST = withActor(async ({ req, actor }) => {
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const { upload } = await parseUpload(req);
    return created({ experience: await uploadExperience(getDeps(), actor, upload) });
  }
  return created({ experience: await addExperienceManually(getDeps(), actor, await parseJson(req, experienceSchema)) });
});
