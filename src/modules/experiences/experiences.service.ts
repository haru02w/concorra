import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { Experience } from "@/domain/organization/organization";
import { l2normalize } from "@/domain/shared/vector";
import type { Deps } from "../shared/ports";
import { readFileText, storeUpload, type Actor, type Upload } from "../shared/context";

const toDate = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

export class ExperiencesService {
  constructor(private readonly deps: Deps) {}

  /** Uploads an atestado/contract; extraction runs as a job. */
  async uploadExperience(actor: Actor, upload: Upload): Promise<Experience> {
    const file = await storeUpload(this.deps, actor.organizationId, upload);
    const experience = await this.deps.experiences.create({
      organizationId: actor.organizationId,
      fileId: file.id,
      issuer: null,
      object: `Processando ${upload.name}…`,
      quantities: null,
      periodStart: null,
      periodEnd: null,
    });
    await this.deps.jobs.enqueue("experience.extract", { experienceId: experience.id, organizationId: actor.organizationId });
    return experience;
  }

  async addExperienceManually(actor: Actor, input: Pick<Experience, "object" | "issuer" | "quantities" | "periodStart" | "periodEnd">): Promise<Experience> {
    if (!input.object.trim()) throw new ValidationError("Descreva o objeto da experiência");
    const experience = await this.deps.experiences.create({ organizationId: actor.organizationId, fileId: null, ...input });
    const [embedding] = await this.deps.ai.embed([input.object], "document");
    await this.deps.experiences.update(experience.id, {}, l2normalize(embedding));
    await this.deps.jobs.enqueue("org.embed-profile", { organizationId: actor.organizationId }, { singletonKey: actor.organizationId });
    return experience;
  }

  /** Job: AI extracts issuer, object, quantities and period from the uploaded atestado. */
  async extractExperience(input: { experienceId: string; organizationId: string }): Promise<void> {
    const experience = await this.deps.experiences.findById(input.organizationId, input.experienceId);
    if (!experience) throw new NotFoundError("Experience", input.experienceId);
    if (!experience.fileId) return;
    const file = await this.deps.files.findById(experience.fileId);
    if (!file) throw new NotFoundError("File", experience.fileId);
    const { pages } = await readFileText(this.deps, file);
    const extracted = await this.deps.ai.extractExperience({ text: pages.join("\n\n"), fileName: file.name });
    const [embedding] = await this.deps.ai.embed([extracted.object], "document");
    await this.deps.experiences.update(
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
    await this.deps.jobs.enqueue("org.embed-profile", { organizationId: input.organizationId }, { singletonKey: input.organizationId });
  }

  async deleteExperience(actor: Actor, id: string): Promise<void> {
    const experience = await this.deps.experiences.findById(actor.organizationId, id);
    if (!experience) throw new NotFoundError("Experience", id);
    await this.deps.experiences.delete(actor.organizationId, id);
    if (experience.fileId) {
      const file = await this.deps.files.findById(experience.fileId);
      if (file) {
        await this.deps.storage.delete(file.storageKey).catch(() => undefined);
        await this.deps.files.delete(file.id);
      }
    }
    await this.deps.jobs.enqueue("org.embed-profile", { organizationId: actor.organizationId }, { singletonKey: actor.organizationId });
  }

  async listExperiences(actor: Actor): Promise<Experience[]> {
    return this.deps.experiences.listByOrg(actor.organizationId);
  }

  async findExperience(actor: Actor, id: string): Promise<Experience | null> {
    return this.deps.experiences.findById(actor.organizationId, id);
  }
}
