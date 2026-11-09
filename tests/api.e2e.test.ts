/** Auth, validation and webhook security over HTTP. */
import { describe, expect, inject, it } from "vitest";
import { Client } from "./client";

describe("API access control and validation", () => {
  const baseUrl = inject("baseUrl");

  it("requires a session", async () => {
    const anon = new Client(baseUrl);
    expect((await anon.get("/api/v1/me")).status).toBe(401);
    expect((await anon.get("/api/v1/rules")).data.error.code).toBe("unauthorized");
    expect((await anon.post("/api/mock/jobs", { name: "pncp.sync-open" })).status).toBe(401);
  });

  it("requires an organization for org-scoped endpoints", async () => {
    const user = new Client(baseUrl);
    await user.login("no-org@e2e.test");
    const res = await user.get("/api/v1/rules");
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe("organization_required");
  });

  it("validates input", async () => {
    const user = new Client(baseUrl);
    await user.login("validation@e2e.test");
    expect((await user.post("/api/mock/login", { email: "not-an-email" })).status).toBe(400);
    expect((await user.request("POST", "/api/v1/organizations", { json: "x" })).status).toBe(400);
    const res = await user.post("/api/v1/organizations", { cnpj: "123" });
    expect(res.status).toBe(422);
    expect(res.data.error.code).toBe("validation");
    expect((await user.post("/api/mock/jobs", { name: "unknown.job" })).status).toBe(400);
  });

  it("rejects payment webhooks without the secret or with a tampered body", async () => {
    const anon = new Client(baseUrl);
    const body = { id: "log_x", event: "checkout.completed", data: {} }; // ignored event type
    expect((await anon.post("/api/webhooks/abacatepay?webhookSecret=wrong", body)).status).toBe(401);
    const tampered = await anon.request("POST", "/api/webhooks/abacatepay?webhookSecret=e2e-webhook-secret", { json: body });
    expect(tampered.status).toBe(200); // no signature header: secret alone authenticates
    const res = await fetch(new URL("/api/webhooks/abacatepay?webhookSecret=e2e-webhook-secret", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-signature": "bad" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
  });

  it("serves pages to signed-in users and redirects others", async () => {
    const anon = new Client(baseUrl);
    expect((await anon.get("/")).status).toBe(200);
    const radar = await anon.get("/radar");
    expect([302, 307]).toContain(radar.status);
    const user = new Client(baseUrl);
    await user.login("pages@e2e.test");
    expect((await user.get("/onboarding")).status).toBe(200);
  });
});
