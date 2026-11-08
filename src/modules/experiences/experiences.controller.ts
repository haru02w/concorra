import { created, notFound, parseJson, parseUpload, withActor } from "@/web/server/api";
import { getServices } from "@/web/server/container";
import { experienceSchema } from "./experiences.schemas";

export const listExperiences = withActor(async ({ actor }) => ({ experiences: await getServices().experiences.listExperiences(actor) }));

/** JSON body: manual experience. multipart/form-data (`file`): atestado upload, extracted by AI in the worker. */
export const createExperience = withActor(async ({ req, actor }) => {
  const { experiences } = getServices();
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const { upload } = await parseUpload(req);
    return created({ experience: await experiences.uploadExperience(actor, upload) });
  }
  return created({ experience: await experiences.addExperienceManually(actor, await parseJson(req, experienceSchema)) });
});

export const getExperience = withActor<{ id: string }>(async ({ actor, params }) => {
  const experience = await getServices().experiences.findExperience(actor, params.id);
  return experience ? { experience } : notFound("Experience", params.id);
});

export const deleteExperience = withActor<{ id: string }>(async ({ actor, params }) => {
  await getServices().experiences.deleteExperience(actor, params.id);
});
