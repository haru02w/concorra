import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { Experience } from "@/domain/organization/organization";
import { l2normalize } from "@/domain/shared/vector";
import type { Deps } from "../ports";
import { readFileText, storeUpload, type Actor, type Upload } from "./context";

const toDate = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

/** Uploads an atestado/contract; extraction runs as a job. */
export async function uploadExperience(deps: Pick<Deps, "storage" | "files" | "experiences" | "jobs">, actor: Actor, upload: Upload): Promise<Experience> {
  const file = await storeUpload(deps, actor.organizationId, upload);
  const experience = await deps.experiences.create({
    organizationId: actor.organizationId,
    fileId: file.id,
    issuer: null,
    object: `Processando ${upload.name}…`,
    quantities: null,
    periodStart: null,
    periodEnd: null,
  });
  await deps.jobs.enqueue("experience.extract", { experienceId: experience.id, organizationId: actor.organizationId });
  return experience;
}

export async function addExperienceManually(
  deps: Pick<Deps, "experiences" | "ai" | "jobs">,
  actor: Actor,
  input: Pick<Experience, "object" | "issuer" | "quantities" | "periodStart" | "periodEnd">,
): Promise<Experience> {
  if (!input.object.trim()) throw new ValidationError("Descreva o objeto da experiência");
  const experience = await deps.experiences.create({ organizationId: actor.organizationId, fileId: null, ...input });
  const [embedding] = await deps.ai.embed([input.object], "document");
  await deps.experiences.update(experience.id, {}, l2normalize(embedding));
  await deps.jobs.enqueue("org.embed-profile", { organizationId: actor.organizationId }, { singletonKey: actor.organizationId });
  return experience;
}

/** Job: AI extracts issuer, object, quantities and period from the uploaded atestado. */
export async function extractExperience(
  deps: Pick<Deps, "experiences" | "files" | "storage" | "pdfText" | "ai" | "jobs">,
  input: { experienceId: string; organizationId: string },
): Promise<void> {
  const experience = await deps.experiences.findById(input.organizationId, input.experienceId);
  if (!experience) throw new NotFoundError("Experience", input.experienceId);
  if (!experience.fileId) return;
  const file = await deps.files.findById(experience.fileId);
  if (!file) throw new NotFoundError("File", experience.fileId);
  const { pages } = await readFileText(deps, file);
  const extracted = await deps.ai.extractExperience({ text: pages.join("\n\n"), fileName: file.name });
  const [embedding] = await deps.ai.embed([extracted.object], "document");
  await deps.experiences.update(
    experience.id,
    {
      issuer: extracted.issuer,
      object: extracted.object,
      quantities: extracted.quantities,
      periodStart: toDate(extracted.periodStart),
      periodEnd: toDate(extracted.periodEnd),
    },
    l2normalize(embedding),
  );
  await deps.jobs.enqueue("org.embed-profile", { organizationId: input.organizationId }, { singletonKey: input.organizationId });
}

export async function deleteExperience(deps: Pick<Deps, "experiences" | "files" | "storage" | "jobs">, actor: Actor, id: string): Promise<void> {
  const experience = await deps.experiences.findById(actor.organizationId, id);
  if (!experience) throw new NotFoundError("Experience", id);
  await deps.experiences.delete(actor.organizationId, id);
  if (experience.fileId) {
    const file = await deps.files.findById(experience.fileId);
    if (file) {
      await deps.storage.delete(file.storageKey).catch(() => undefined);
      await deps.files.delete(file.id);
    }
  }
  await deps.jobs.enqueue("org.embed-profile", { organizationId: actor.organizationId }, { singletonKey: actor.organizationId });
}
