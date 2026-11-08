import { describe, expect, it } from "vitest";
import { createServices } from "@/modules/services";
import { makeTestDeps } from "@/modules/shared/testing/in-memory";
import { setup } from "@/modules/shared/testing/setup";

describe("resolveSession", () => {
  it("creates the local membership for invited members", async () => {
    const { services, org } = await setup();
    const session = await services.auth.resolveSession({ workosUserId: "invited", email: "m@x.y", name: "M", workosOrgId: org.workosOrgId, role: "member" });
    expect(session.actor).toEqual(expect.objectContaining({ organizationId: org.id, role: "member" }));
    expect(session.organizations).toHaveLength(1);
  });
  it("returns no actor without an organization", async () => {
    const deps = makeTestDeps();
    const services = createServices(deps);
    const session = await services.auth.resolveSession({ workosUserId: "x", email: "x@y.z", name: null, workosOrgId: null, role: null });
    expect(session.actor).toBeNull();
    expect(session.organization).toBeNull();
  });
});
