import { describe, expect, it } from "vitest";
import { makeDoc, makeExtraction, makeNotice } from "../fixtures";
import { bidDeadlines, documentExpiryEvent } from "../calendar/deadlines";
import { validateDocument, validityStatus } from "../documents/document";
import { assertWithinLimit, PLANS } from "../billing/plans";
import { assertTransition, canMarkReady, nextPackStep } from "./bid";
import { declarationTemplate, listAiSlots, PROPOSAL_TEMPLATE, proposalTable, renderTemplate } from "./templates";
import { verifyGeneratedDocument } from "./verification";

const ctx = {
  razaoSocial: "LIMPA BEM COMERCIO LTDA",
  cnpj: "11222333000181",
  endereco: "Rua das Flores, 100",
  representante: "Maria Exemplo",
  orgaoNome: "MUNICIPIO DE VARGEM ALTA",
  numeroEdital: "90005/2026",
  processo: "2026-123",
  objeto: "Material de limpeza",
  cidade: "Vitória",
  data: "8 de novembro de 2026",
};

describe("bid lifecycle", () => {
  it("allows valid transitions only", () => {
    expect(() => assertTransition("participating", "ready")).not.toThrow();
    expect(() => assertTransition("submitted", "ready")).toThrow();
    expect(() => assertTransition("skipped", "participating")).not.toThrow();
  });
  it("resumes pack steps", () => {
    expect(nextPackStep([])).toBe("checklist");
    expect(nextPackStep(["checklist", "prices"])).toBe("drafts");
    expect(nextPackStep(["checklist", "prices", "drafts", "verify", "render", "instructions"])).toBeNull();
  });
  it("is ready only with every doc approved and no errors", () => {
    expect(canMarkReady([]).ok).toBe(false);
    expect(canMarkReady([{ status: "draft", verification: [] }]).ok).toBe(false);
    expect(canMarkReady([{ status: "approved", verification: [{ severity: "error", message: "x" }] }]).ok).toBe(false);
    expect(canMarkReady([{ status: "approved", verification: [{ severity: "warning", message: "x" }] }]).ok).toBe(true);
  });
});

describe("templates", () => {
  it("renders code and AI slots", () => {
    const tpl = declarationTemplate("Declaração de não emprego de menor");
    expect(listAiSlots(tpl)).toEqual(["body"]);
    const md = renderTemplate(tpl, ctx, { body: "Declaramos que não empregamos menores." });
    expect(md).toContain("11.222.333/0001-81");
    expect(md).toContain("# DECLARAÇÃO DE NÃO EMPREGO DE MENOR");
    expect(md).toContain("Declaramos");
  });
  it("throws when slots are missing", () => {
    expect(() => renderTemplate(declarationTemplate("X"), ctx)).toThrow(/ai:body|body/);
  });
  it("builds the proposal table without inventing prices", () => {
    const { table, totalCents } = proposalTable([
      { numeroItem: 1, descricao: "Detergente | neutro", unidade: "UN", quantidade: 10, unitPriceCents: 250 },
      { numeroItem: 2, descricao: "Sabão", unidade: null, quantidade: 5, unitPriceCents: null },
    ]);
    expect(totalCents).toBeNull();
    expect(table).toContain("A PREENCHER");
    expect(table).toContain("Detergente / neutro");
    expect(proposalTable([{ numeroItem: 1, descricao: "x", unidade: "UN", quantidade: 3, unitPriceCents: 100 }]).totalCents).toBe(300);
    expect(listAiSlots(PROPOSAL_TEMPLATE)).toEqual(["intro", "validity", "conditions"]);
  });
  it("verifies generated documents deterministically", () => {
    const md = renderTemplate(declarationTemplate("X"), ctx, { body: "Texto." });
    expect(verifyGeneratedDocument(md, ctx)).toEqual([]);
    const wrong = md.replace("11.222.333/0001-81", "99.999.999/0001-99");
    const issues = verifyGeneratedDocument(wrong, ctx);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
    expect(issues.some((i) => i.message.includes("Outro CNPJ"))).toBe(true);
  });
});

describe("documents", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  it("validates CNPJ, kind and validity", () => {
    const ok = validateDocument({ orgCnpj: "11222333000181", extractedCnpj: "11.222.333/0001-81", validUntil: new Date("2027-01-01"), kind: "cndt", extractedKind: "cndt", now });
    expect(ok.status).toBe("valid");
    const wrongCnpj = validateDocument({ orgCnpj: "11222333000181", extractedCnpj: "99999999000199", validUntil: null, kind: "cndt", extractedKind: null, now });
    expect(wrongCnpj.status).toBe("invalid");
    const expired = validateDocument({ orgCnpj: "11222333000181", extractedCnpj: "11222333000181", validUntil: new Date("2026-01-01"), kind: "cndt", extractedKind: "cndt", now });
    expect(expired.status).toBe("expired");
  });
  it("flags expiring documents", () => {
    expect(validityStatus(new Date("2026-11-15"), now)).toBe("expiring");
    expect(validityStatus(null, now)).toBe("valid");
  });
});

describe("calendar deadlines", () => {
  it("creates bid deadline events with stable keys", () => {
    const events = bidDeadlines("bid-1", makeNotice(), makeExtraction(), "https://x");
    expect(events.map((e) => e.key)).toEqual([
      "bid:bid-1:esclarecimentos",
      "bid:bid-1:impugnacao",
      "bid:bid-1:proposta",
      "bid:bid-1:sessao",
    ]);
    expect(events[0].start.toISOString()).toBe("2026-11-15T21:00:00.000Z");
  });
  it("works without extraction", () => {
    expect(bidDeadlines("bid-1", makeNotice(), null, "").map((e) => e.key)).toEqual(["bid:bid-1:proposta"]);
  });
  it("creates expiry reminders 7 days before", () => {
    const ev = documentExpiryEvent(makeDoc({ validUntil: new Date("2026-12-10T00:00:00Z") }));
    expect(ev?.start.toISOString().slice(0, 10)).toBe("2026-12-03");
    expect(documentExpiryEvent(makeDoc({ validUntil: null }))).toBeNull();
  });
});

describe("plans", () => {
  it("enforces limits", () => {
    expect(() => assertWithinLimit("free", "rules", 1)).not.toThrow();
    expect(() => assertWithinLimit("free", "rules", 2)).toThrow(/limit/);
    expect(() => assertWithinLimit("free", "bidPacks", 0)).toThrow();
    expect(() => assertWithinLimit("business", "rules", 10_000)).not.toThrow();
    expect(PLANS.pro.priceCents).toBe(9900);
  });
});
