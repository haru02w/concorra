/**
 * Full company journey over HTTP (REST API + route handlers), with the real
 * worker processing jobs and every external API mocked.
 */
import { beforeAll, describe, expect, inject, it } from "vitest";
import { buildPdf } from "@/infrastructure/mock/pdf";
import { Client, today, waitFor } from "./client";

const CNPJ = "11.222.333/0001-81";
const pdf = (text: string) => ({ name: "doc.pdf", type: "application/pdf", bytes: buildPdf([text]) });

describe("company journey", () => {
  const owner = new Client(inject("baseUrl"));
  let noticeId = "";
  let bidId = "";
  let pdfFileId = "";

  beforeAll(async () => {
    const me = await owner.login("owner@e2e.test", "Owner E2E");
    expect(me.organization).toBeNull();
  });

  it("onboards: CNPJ lookup → organization on the Free plan", async () => {
    const lookup = await owner.get(`/api/v1/companies/${CNPJ.replace(/\D/g, "")}`);
    expect(lookup.status).toBe(200);
    expect(lookup.data.company.razaoSocial).toMatch(/FICTÍCIA/);
    expect((await owner.get("/api/v1/companies/40400000000101")).status).toBe(404);

    const created = await owner.post("/api/v1/organizations", {
      cnpj: CNPJ,
      profile: { expertiseText: "Fornecimento de material de limpeza e higiene para escolas e hospitais", ufs: ["ES", "MG", "RJ", "SP", "BA", "PR", "RS", "DF"] },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    expect(created.data.organization.porte).toBe("EPP");

    const me = await owner.get("/api/v1/me");
    expect(me.data.organization.planId).toBe("free");
    expect(me.data.role).toBe("owner");
    expect((await owner.post("/api/v1/organizations", { cnpj: CNPJ })).status).toBe(409);
  });

  it("updates the profile and adds experience", async () => {
    const patched = await owner.patch("/api/v1/organization", { valueMin: 1000, valueMax: 2_000_000 });
    expect(patched.status).toBe(200);
    expect(patched.data.organization.valueMax).toBe(2_000_000);
    const exp = await owner.post("/api/v1/experiences", { object: "Fornecimento de material de limpeza para 40 escolas", issuer: "Prefeitura Fictícia" });
    expect(exp.status).toBe(201);
    const uploaded = await owner.upload("/api/v1/experiences", {}, pdf("ATESTADO DE CAPACIDADE TÉCNICA\nPrefeitura Municipal Fictícia\nFornecimento de 10.000 unidades de papel higiênico entre 01/01/2025 e 31/12/2025."));
    expect(uploaded.status).toBe(201);
    await waitFor(async () => {
      const { data } = await owner.get(`/api/v1/experiences/${uploaded.data.experience.id}`);
      return data.experience.issuer === "Prefeitura Municipal Fictícia";
    }, "atestado extraction");
  });

  it("creates rules within the plan limit", async () => {
    expect((await owner.post("/api/v1/rules", { name: "Limpeza", filters: { keywordsInclude: ["limpeza", "higiene"] } })).status).toBe(201);
    expect((await owner.post("/api/v1/rules", { name: "Papelaria", filters: { keywordsInclude: ["papelaria"] }, frequency: "daily" })).status).toBe(201);
    const third = await owner.post("/api/v1/rules", { name: "Excesso", filters: { ufs: ["SP"] } });
    expect(third.status).toBe(402);
    expect(third.data.error).toMatchObject({ code: "limit_exceeded", metric: "rules", limit: 2 });
    expect((await owner.post("/api/v1/rules", { name: "Sem filtro", active: false })).status).toBe(422);
    expect((await owner.post("/api/v1/rules", { filters: {} })).status).toBe(400);
  });

  it("syncs PNCP, matches rules, notifies and auto-analyzes", async () => {
    expect((await owner.post("/api/mock/jobs", { name: "pncp.sync-open" })).status).toBe(202);
    const notices = await waitFor(async () => {
      const { data } = await owner.get("/api/v1/notices?pageSize=50");
      return data.total >= 24 && data;
    }, "PNCP sync");
    expect(notices.notices[0].similarity).not.toBeNull(); // ranked by profile affinity

    const matches = await waitFor(async () => {
      const { data } = await owner.get("/api/v1/matches");
      return data.matches.length > 0 && data.matches;
    }, "rule matches");
    expect(matches.every((m: { notice: { objeto: string } }) => /limpeza|higiene|papelaria/i.test(m.notice.objeto))).toBe(true);

    await waitFor(async () => {
      const { data } = await owner.get("/api/mock/outbox?kind=mail");
      return data.items.some((m: { to: string[]; subject: string }) => m.to.includes("owner@e2e.test") && /licita/i.test(m.subject));
    }, "match email");

    const analysis = await waitFor(async () => {
      for (const m of matches as { noticeId: string }[]) {
        const { status, data } = await owner.get(`/api/v1/notices/${m.noticeId}/analysis`);
        if (status === 200 && data.analysis.status === "done") {
          noticeId = m.noticeId;
          return data.analysis;
        }
      }
      return null;
    }, "an analysis to finish");
    expect(analysis.score).toBeGreaterThan(0);
    expect(analysis.citationReport.failedPaths).toEqual([]);
    expect(analysis.citationReport.verifiedCount).toBeGreaterThan(5);
    expect(analysis.extraction.requirements.length).toBeGreaterThanOrEqual(5);
    expect(analysis.gaps.some((g: { status: string }) => g.status === "missing")).toBe(true);
    expect(["participate", "review", "skip"]).toContain(analysis.recommendation);

    const detail = await owner.get(`/api/v1/notices/${noticeId}`);
    expect(detail.data.items.length).toBeGreaterThan(0);
    expect(detail.data.files[0].pageCount).toBe(5);
  });

  it("blocks bid packs on Free, upgrades through the AbacatePay checkout", async () => {
    const blocked = await owner.post(`/api/v1/notices/${noticeId}/decision`, { decision: "participate" });
    expect(blocked.status).toBe(402);

    const checkout = await owner.post("/api/v1/billing/checkout", { planId: "pro" });
    expect(checkout.status).toBe(200);
    const paid = await owner.get(new URL(checkout.data.url).pathname + new URL(checkout.data.url).search);
    expect([302, 303, 307]).toContain(paid.status);
    expect(paid.headers.get("location")).toContain("/billing?checkout=done");

    await waitFor(async () => (await owner.get("/api/v1/billing")).data.plan.id === "pro", "plan upgrade via webhook");
    const payments = (await owner.get("/api/mock/outbox?kind=payments")).data.items;
    expect(payments.map((p: { path: string }) => p.path)).toEqual(expect.arrayContaining(["/v2/customers/create", "/v2/subscriptions/create"]));
  });

  it("validates vault documents with AI + deterministic checks", async () => {
    const valid = await owner.upload("/api/v1/documents", { kind: "cnd_federal" }, pdf(`CERTIDÃO NEGATIVA DE DÉBITOS RELATIVOS AOS TRIBUTOS FEDERAIS\nCNPJ: ${CNPJ}\nEmitida em ${today()}. Válida até ${today(150)}.\nEmissor: Receita Federal`));
    expect(valid.status).toBe(201);
    expect(valid.data.document.status).toBe("pending");
    const wrong = await owner.upload("/api/v1/documents", { kind: "crf_fgts" }, pdf(`CERTIFICADO DE REGULARIDADE DO FGTS - CRF\nCNPJ: 97.000.000/0001-23\nVálida até ${today(30)}.\nEmissor: Caixa`));
    expect((await owner.upload("/api/v1/documents", { kind: "nope" }, pdf("x"))).status).toBe(400);

    const docs = await waitFor(async () => {
      const { data } = await owner.get("/api/v1/documents");
      return data.documents.every((d: { status: string }) => d.status !== "pending") && data.documents;
    }, "document validation");
    const byId = new Map(docs.map((d: { id: string }) => [d.id, d]));
    expect(byId.get(valid.data.document.id)).toMatchObject({ status: "valid", cnpj: CNPJ });
    expect(byId.get(wrong.data.document.id)).toMatchObject({ status: "invalid" });
  });

  it("connects Google Calendar through OAuth", async () => {
    const connect = await owner.get("/api/calendar/google/connect");
    expect([302, 307]).toContain(connect.status);
    const location = new URL(connect.headers.get("location")!);
    expect(location.hostname).toBe("accounts.google.com");
    const callback = await owner.get(`/api/calendar/google/callback?code=mock-code&state=${encodeURIComponent(location.searchParams.get("state")!)}`);
    expect(callback.headers.get("location")).toContain("calendar=connected");
    const { data } = await owner.get("/api/v1/calendars");
    expect(data.calendars).toEqual([expect.objectContaining({ provider: "google", email: "agenda.mock@gmail.test" })]);
    expect(JSON.stringify(data)).not.toContain("access");
  });

  it("participates: builds the bid pack and pushes deadlines to the calendar", async () => {
    const decided = await owner.post(`/api/v1/notices/${noticeId}/decision`, { decision: "participate" });
    expect(decided.status, JSON.stringify(decided.data)).toBe(201);
    bidId = decided.data.bid.id;

    const view = await waitFor(async () => {
      const { data } = await owner.get(`/api/v1/bids/${bidId}`);
      if (data.bid.packStatus === "failed") throw new Error(data.bid.packError);
      return data.bid.packStatus === "done" && data.calendarEvents > 0 && data;
    }, "bid pack", 180_000);
    const kinds = view.documents.map((d: { kind: string }) => d.kind);
    expect(kinds).toEqual(expect.arrayContaining(["declaration", "proposal", "cover_letter", "instructions"]));
    for (const doc of view.documents.filter((d: { kind: string }) => d.kind !== "instructions")) {
      expect(doc.docxFileId && doc.pdfFileId, doc.title).toBeTruthy();
    }
    const federal = view.checklist.find((g: { documentKind: string }) => g.documentKind === "cnd_federal");
    expect(federal.status).toBe("have");
    expect(view.checklist.find((g: { documentKind: string }) => g.documentKind === "crf_fgts").status).toBe("missing");
    expect(view.proposalLines.every((l: { unitPriceCents: number | null }) => l.unitPriceCents === null)).toBe(true);
    expect(Object.keys(view.priceReferences).length).toBe(view.proposalLines.length);
    const calendar = (await owner.get("/api/mock/outbox?kind=calendar")).data.items;
    expect(calendar.some((c: { provider: string; method: string }) => c.provider === "google" && c.method === "POST")).toBe(true);
  });

  it("prices, approves, marks ready and submitted", async () => {
    const { data: view } = await owner.get(`/api/v1/bids/${bidId}`);
    const prices = Object.fromEntries(view.proposalLines.map((l: { numeroItem: number }) => [String(l.numeroItem), 1234]));
    const priced = await owner.put(`/api/v1/bids/${bidId}/prices`, { prices });
    expect(priced.status).toBe(200);
    expect(priced.data.lines.every((l: { unitPriceCents: number }) => l.unitPriceCents === 1234)).toBe(true);
    expect((await owner.put(`/api/v1/bids/${bidId}/prices`, { prices: { "1": -1 } })).status).toBe(400);

    expect((await owner.post(`/api/v1/bids/${bidId}/status`, { status: "ready" })).status).toBe(409); // drafts not approved

    const { data: after } = await owner.get(`/api/v1/bids/${bidId}`);
    const proposal = after.documents.find((d: { kind: string }) => d.kind === "proposal");
    expect(proposal.markdown).toMatch(/R\$\s12,34/);
    expect(proposal.status).toBe("draft");

    const declaration = after.documents.find((d: { kind: string }) => d.kind === "declaration");
    const edited = await owner.patch(`/api/v1/generated-documents/${declaration.id}`, { markdown: `${declaration.markdown}\n\nObservação revisada.` });
    expect(edited.data.document.markdown).toContain("Observação revisada.");

    for (const doc of after.documents.filter((d: { kind: string }) => d.kind !== "instructions")) {
      const approved = await owner.post(`/api/v1/generated-documents/${doc.id}/approve`);
      expect(approved.status, JSON.stringify(approved.data)).toBe(200);
    }
    expect((await owner.post(`/api/v1/bids/${bidId}/status`, { status: "ready" })).data.bid.status).toBe("ready");
    expect((await owner.post(`/api/v1/bids/${bidId}/status`, { status: "submitted" })).data.bid.status).toBe("submitted");
  });

  it("downloads files and the ZIP pack", async () => {
    // Edits re-render DOCX/PDF in the worker (replacing files): wait until the file ids settle.
    let previous = "";
    let stable = 0;
    const view = await waitFor(async () => {
      const { data } = await owner.get(`/api/v1/bids/${bidId}`);
      const ids = data.documents.map((d: { pdfFileId: string | null }) => d.pdfFileId).join(",");
      stable = ids === previous ? stable + 1 : 0;
      previous = ids;
      return stable >= 3 && data;
    }, "re-rendered documents");
    pdfFileId = view.documents.find((d: { kind: string }) => d.kind === "proposal").pdfFileId;
    const file = await owner.get(`/api/files/${pdfFileId}`);
    expect([302, 307]).toContain(file.status);
    const bytes = new Uint8Array(await (await fetch(file.headers.get("location")!)).arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");

    const zip = await owner.get(`/api/bids/${bidId}/zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    const zipBytes = new Uint8Array(await zip.res.arrayBuffer());
    expect(Buffer.from(zipBytes.slice(0, 2)).toString()).toBe("PK");
    expect(zipBytes.length).toBeGreaterThan(5000);
  });

  it("lists and reads notifications", async () => {
    const { data } = await owner.get("/api/v1/notifications");
    expect(data.notifications.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(["match", "analysis_ready", "bid_pack_ready", "billing"]));
    expect(data.unread).toBeGreaterThan(0);
    expect((await owner.post("/api/v1/notifications/read", { ids: "all" })).status).toBe(204);
    expect((await owner.get("/api/v1/notifications")).data.unread).toBe(0);
  });

  it("invites a member through WorkOS", async () => {
    expect((await owner.post("/api/v1/members/invite", { email: "colega@e2e.test" })).status).toBe(202);
    const workos = (await owner.get("/api/mock/outbox?kind=workos")).data.items;
    expect(workos).toEqual(expect.arrayContaining([expect.objectContaining({ op: "sendInvitation", email: "colega@e2e.test" })]));
  });

  it("isolates organizations", async () => {
    const intruder = new Client(inject("baseUrl"));
    await intruder.login("intruder@e2e.test");
    expect((await intruder.post("/api/v1/organizations", { cnpj: "97000001000178" })).status).toBe(201);
    expect((await intruder.get(`/api/v1/bids/${bidId}`)).status).toBe(404);
    expect((await intruder.get(`/api/files/${pdfFileId}`)).status).toBe(404);
    expect((await intruder.get(`/api/bids/${bidId}/zip`)).status).toBe(404);
    expect((await intruder.get(`/api/v1/notices/${noticeId}/analysis`)).status).toBe(404);
    const { data } = await owner.get(`/api/v1/bids/${bidId}`);
    expect((await intruder.post(`/api/v1/generated-documents/${data.documents[0].id}/approve`)).status).toBe(404);
  });

  it("cancels the subscription back to Free", async () => {
    expect((await owner.post("/api/v1/billing/cancel")).status).toBe(204);
    expect((await owner.get("/api/v1/billing")).data.plan.id).toBe("free");
  });
});
