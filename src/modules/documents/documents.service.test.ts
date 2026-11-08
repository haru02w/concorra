import { describe, expect, it } from "vitest";
import { makeDoc } from "@/domain/fixtures";
import { setup } from "@/modules/shared/testing/setup";

describe("document vault", () => {
  const pdf = { name: "cnd.pdf", mime: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) };

  it("uploads, validates with AI + deterministic checks and schedules reminders", async () => {
    const { services, deps, actor } = await setup();
    const doc = await services.documents.uploadDocument(actor, { kind: "cnd_federal", upload: pdf });
    expect(doc.status).toBe("pending");
    const validated = await services.documents.validateUploadedDocument(deps.jobs.of("docs.validate-upload")[0]);
    expect(validated.status).toBe("valid");
    expect(validated.checks.every((c) => c.ok)).toBe(true);
    expect(deps.jobs.of("calendar.sync")).toEqual([expect.objectContaining({ refType: "document", refId: doc.id })]);
    expect(await services.documents.fileDownloadUrl(actor, doc.fileId)).toMatch(/^https:\/\/storage.test/);
    await expect(services.documents.fileDownloadUrl({ ...actor, organizationId: "x" }, doc.fileId)).rejects.toThrow();
    await services.documents.deleteDocument(actor, doc.id);
    expect(deps.storage.objects.size).toBe(0);
  });

  it("flags documents of another company", async () => {
    const { services, deps, actor } = await setup();
    deps.ai.documentExtraction = { ...deps.ai.documentExtraction, cnpj: "99.999.999/0001-91" };
    const doc = await services.documents.uploadDocument(actor, { kind: "cnd_federal", upload: pdf });
    expect((await services.documents.validateUploadedDocument({ documentId: doc.id })).status).toBe("invalid");
  });

  it("warns once about expiring documents", async () => {
    const { services, deps, actor } = await setup();
    await deps.documents.create({ ...makeDoc({ validUntil: new Date("2026-11-15T00:00:00Z") }), organizationId: actor.organizationId });
    expect(await services.documents.expiryWatch()).toBe(1);
    expect(deps.mailer.sent[0].subject).toMatch(/vencendo/);
    expect(await services.documents.expiryWatch()).toBe(0);
  });
});
