import { deleteExperience } from "@/application/use-cases/experiences";
import { notFound, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor<{ id: string }>(async ({ actor, params }) => {
  const experience = await getDeps().experiences.findById(actor.organizationId, params.id);
  return experience ? { experience } : notFound("Experience", params.id);
});

export const DELETE = withActor<{ id: string }>(async ({ actor, params }) => {
  await deleteExperience(getDeps(), actor, params.id);
});
