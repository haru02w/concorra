import { describe, expect, it } from "vitest";
import { setup } from "@/modules/shared/testing/setup";

describe("experiences", () => {
  it("uploads, extracts with AI and re-embeds the profile", async () => {
    const { services, deps, actor } = await setup();
    const exp = await services.experiences.uploadExperience(actor, { name: "atestado.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });
    expect(deps.jobs.of("experience.extract")).toEqual([{ experienceId: exp.id, organizationId: actor.organizationId }]);
    await services.experiences.extractExperience({ experienceId: exp.id, organizationId: actor.organizationId });
    const updated = await deps.experiences.findById(actor.organizationId, exp.id);
    expect(updated?.object).toBe("Fornecimento de material de limpeza");
    expect(updated?.periodStart?.toISOString().slice(0, 10)).toBe("2025-01-01");
    await services.experiences.deleteExperience(actor, exp.id);
    expect(await deps.experiences.listByOrg(actor.organizationId)).toEqual([]);
    expect(deps.storage.objects.size).toBe(0);
  });
  it("rejects unsupported uploads", async () => {
    const { services, actor } = await setup();
    await expect(services.experiences.uploadExperience(actor, { name: "x.exe", mime: "application/x-msdownload", bytes: new Uint8Array([1]) })).rejects.toThrow(/Formato/);
    await expect(services.experiences.uploadExperience(actor, { name: "x.pdf", mime: "application/pdf", bytes: new Uint8Array() })).rejects.toThrow(/vazio/);
  });
});
