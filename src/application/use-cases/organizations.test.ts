import { describe, expect, it } from "vitest";
import { makeTestDeps } from "../testing/in-memory";
import { memberOf, setup } from "../testing/setup";
import { resolveSession } from "./auth";
import { createOrganization, embedProfile, inviteMember, lookupCompany, updateProfile } from "./organizations";
import { addExperienceManually, deleteExperience, extractExperience, uploadExperience } from "./experiences";

describe("createOrganization", () => {
  it("prefills from BrasilAPI and creates owner membership + free subscription", async () => {
    const deps = makeTestDeps();
    const user = await deps.users.upsert({ workosUserId: "u1", email: "a@b.c", name: null });
    const org = await createOrganization(deps, { user, cnpj: "11.222.333/0001-81", profile: { expertiseText: "Limpeza" } });
    expect(org.razaoSocial).toBe("LIMPA BEM COMERCIO LTDA");
    expect(org.porte).toBe("EPP");
    expect(org.ufs).toEqual(["ES"]);
    expect(org.planId).toBe("free");
    expect(await deps.memberships.find(org.id, user.id)).toEqual(expect.objectContaining({ role: "owner" }));
    expect(deps.identity.members).toEqual([{ org: org.workosOrgId, user: "u1", role: "owner" }]);
    expect((await deps.subscriptions.findByOrg(org.id))?.planId).toBe("free");
    expect(deps.jobs.of("org.embed-profile")).toEqual([{ organizationId: org.id }]);
  });

  it("rejects invalid or duplicate CNPJs and requires a name when lookup fails", async () => {
    const deps = makeTestDeps();
    const user = await deps.users.upsert({ workosUserId: "u1", email: "a@b.c", name: null });
    await expect(createOrganization(deps, { user, cnpj: "123", profile: {} })).rejects.toThrow(/CNPJ/);
    await createOrganization(deps, { user, cnpj: "11222333000181", profile: {} });
    await expect(createOrganization(deps, { user, cnpj: "11222333000181", profile: {} })).rejects.toThrow(/Já existe/);
    await expect(createOrganization(deps, { user, cnpj: "11444777000161", profile: {} })).rejects.toThrow(/Razão social/);
  });

  it("looks up companies by CNPJ", async () => {
    const deps = makeTestDeps();
    expect((await lookupCompany(deps, "11.222.333/0001-81"))?.uf).toBe("ES");
  });
});

describe("profile and members", () => {
  it("only owners update the profile; embedding is re-queued", async () => {
    const { deps, actor } = await setup();
    await expect(updateProfile(deps, memberOf(actor), { expertiseText: "x" })).rejects.toThrow(/owners/);
    await expect(updateProfile(deps, actor, { valueMin: 10, valueMax: 1 })).rejects.toThrow();
    const org = await updateProfile(deps, actor, { expertiseText: "Material de limpeza hospitalar" });
    expect(org.expertiseText).toBe("Material de limpeza hospitalar");
    expect(deps.jobs.of("org.embed-profile")).toHaveLength(1);
  });

  it("embeds the profile with experiences", async () => {
    const { deps, org, actor } = await setup();
    await addExperienceManually(deps, actor, { object: "Fornecimento de detergente", issuer: null, quantities: null, periodStart: null, periodEnd: null });
    await embedProfile(deps, { organizationId: org.id });
    expect(deps.organizations.embeddings.get(org.id)).toHaveLength(32);
    const embedCall = deps.ai.calls.embed.at(-1) as { texts: string[] };
    expect(embedCall.texts[0]).toContain("Experiência: Fornecimento de detergente");
  });

  it("enforces the member limit on invites", async () => {
    const { deps, actor } = await setup({ plan: "free" });
    await expect(inviteMember(deps, actor, { email: "x@y.z", role: "member" })).rejects.toThrow(/limit/);
    const pro = await setup({ plan: "pro" });
    await inviteMember(pro.deps, pro.actor, { email: "X@Y.z ", role: "member" });
    expect(pro.deps.identity.invites).toEqual([expect.objectContaining({ email: "x@y.z" })]);
    await expect(inviteMember(pro.deps, pro.actor, { email: "nope", role: "member" })).rejects.toThrow(/E-mail/);
  });
});

describe("resolveSession", () => {
  it("creates the local membership for invited members", async () => {
    const { deps, org } = await setup();
    const session = await resolveSession(deps, { workosUserId: "invited", email: "m@x.y", name: "M", workosOrgId: org.workosOrgId, role: "member" });
    expect(session.actor).toEqual(expect.objectContaining({ organizationId: org.id, role: "member" }));
    expect(session.organizations).toHaveLength(1);
  });
  it("returns no actor without an organization", async () => {
    const deps = makeTestDeps();
    const session = await resolveSession(deps, { workosUserId: "x", email: "x@y.z", name: null, workosOrgId: null, role: null });
    expect(session.actor).toBeNull();
    expect(session.organization).toBeNull();
  });
});

describe("experiences", () => {
  it("uploads, extracts with AI and re-embeds the profile", async () => {
    const { deps, actor } = await setup();
    const exp = await uploadExperience(deps, actor, { name: "atestado.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });
    expect(deps.jobs.of("experience.extract")).toEqual([{ experienceId: exp.id, organizationId: actor.organizationId }]);
    await extractExperience(deps, { experienceId: exp.id, organizationId: actor.organizationId });
    const updated = await deps.experiences.findById(actor.organizationId, exp.id);
    expect(updated?.object).toBe("Fornecimento de material de limpeza");
    expect(updated?.periodStart?.toISOString().slice(0, 10)).toBe("2025-01-01");
    await deleteExperience(deps, actor, exp.id);
    expect(await deps.experiences.listByOrg(actor.organizationId)).toEqual([]);
    expect(deps.storage.objects.size).toBe(0);
  });
  it("rejects unsupported uploads", async () => {
    const { deps, actor } = await setup();
    await expect(uploadExperience(deps, actor, { name: "x.exe", mime: "application/x-msdownload", bytes: new Uint8Array([1]) })).rejects.toThrow(/Formato/);
    await expect(uploadExperience(deps, actor, { name: "x.pdf", mime: "application/pdf", bytes: new Uint8Array() })).rejects.toThrow(/vazio/);
  });
});
