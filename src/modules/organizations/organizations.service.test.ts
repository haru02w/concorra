import { describe, expect, it } from "vitest";
import { createServices } from "@/modules/services";
import { makeTestDeps } from "@/modules/shared/testing/in-memory";
import { memberOf, setup } from "@/modules/shared/testing/setup";

describe("createOrganization", () => {
  it("prefills from BrasilAPI and creates owner membership + free subscription", async () => {
    const deps = makeTestDeps();
    const services = createServices(deps);
    const user = await deps.users.upsert({ workosUserId: "u1", email: "a@b.c", name: null });
    const org = await services.organizations.createOrganization({ user, cnpj: "11.222.333/0001-81", profile: { expertiseText: "Limpeza" } });
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
    const services = createServices(deps);
    const user = await deps.users.upsert({ workosUserId: "u1", email: "a@b.c", name: null });
    await expect(services.organizations.createOrganization({ user, cnpj: "123", profile: {} })).rejects.toThrow(/CNPJ/);
    await services.organizations.createOrganization({ user, cnpj: "11222333000181", profile: {} });
    await expect(services.organizations.createOrganization({ user, cnpj: "11222333000181", profile: {} })).rejects.toThrow(/Já existe/);
    await expect(services.organizations.createOrganization({ user, cnpj: "11444777000161", profile: {} })).rejects.toThrow(/Razão social/);
  });

  it("looks up companies by CNPJ", async () => {
    const deps = makeTestDeps();
    const services = createServices(deps);
    expect((await services.organizations.lookupCompany("11.222.333/0001-81"))?.uf).toBe("ES");
  });
});

describe("profile and members", () => {
  it("only owners update the profile; embedding is re-queued", async () => {
    const { services, deps, actor } = await setup();
    await expect(services.organizations.updateProfile(memberOf(actor), { expertiseText: "x" })).rejects.toThrow(/owners/);
    await expect(services.organizations.updateProfile(actor, { valueMin: 10, valueMax: 1 })).rejects.toThrow();
    const org = await services.organizations.updateProfile(actor, { expertiseText: "Material de limpeza hospitalar" });
    expect(org.expertiseText).toBe("Material de limpeza hospitalar");
    expect(deps.jobs.of("org.embed-profile")).toHaveLength(1);
  });

  it("embeds the profile with experiences", async () => {
    const { services, deps, org, actor } = await setup();
    await services.experiences.addExperienceManually(actor, { object: "Fornecimento de detergente", issuer: null, quantities: null, periodStart: null, periodEnd: null });
    await services.organizations.embedProfile({ organizationId: org.id });
    expect(deps.organizations.embeddings.get(org.id)).toHaveLength(32);
    const embedCall = deps.ai.calls.embed.at(-1) as { texts: string[] };
    expect(embedCall.texts[0]).toContain("Experiência: Fornecimento de detergente");
  });

  it("enforces the member limit on invites", async () => {
    const { services, actor } = await setup({ plan: "free" });
    await expect(services.organizations.inviteMember(actor, { email: "x@y.z", role: "member" })).rejects.toThrow(/limit/);
    const pro = await setup({ plan: "pro" });
    await pro.services.organizations.inviteMember(pro.actor, { email: "X@Y.z ", role: "member" });
    expect(pro.deps.identity.invites).toEqual([expect.objectContaining({ email: "x@y.z" })]);
    await expect(pro.services.organizations.inviteMember(pro.actor, { email: "nope", role: "member" })).rejects.toThrow(/E-mail/);
  });
});
