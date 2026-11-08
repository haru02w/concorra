import { describe, expect, it } from "vitest";
import { applyCitationChecks } from "@/domain/analysis/citations";
import { cosineSimilarity } from "@/domain/shared/vector";
import { createGeminiAiGateway } from "../ai/gemini-gateway";
import { BrasilApiCompanyLookup } from "../brasilapi/brasilapi";
import { GoogleCalendarProvider } from "../calendar/google";
import { MicrosoftCalendarProvider } from "../calendar/microsoft";
import { AbacatePayGateway } from "../payments/abacatepay";
import { UnpdfTextExtractor } from "../pdf/unpdf-extractor";
import { PncpHttpGateway } from "../pncp/pncp-gateway";
import { createMockFetch } from "./mock-fetch";
import { buildPdf } from "./pdf";
import { MOCK_NOTICE_COUNT } from "./pncp-fixtures";

const pdfText = new UnpdfTextExtractor();
const fetch = createMockFetch({ appUrl: "http://app.test", pdfText });
const pncp = new PncpHttpGateway({ fetch, minGapMs: 0 });
const ai = createGeminiAiGateway({ apiKey: "mock", fetch });

async function firstNotice(scanned = false) {
  const page = await pncp.listOpenNotices({ dataFinal: "20991231", page: 1, pageSize: 50 });
  // index 4 is the first "scanned" edital
  return page.data[scanned ? 4 : 0];
}

describe("mock PNCP", () => {
  it("lists open notices with items, files and contract prices", async () => {
    const page = await pncp.listOpenNotices({ dataFinal: "20991231", page: 1, pageSize: 50 });
    expect(page.data).toHaveLength(MOCK_NOTICE_COUNT);
    const notice = page.data[0];
    expect(notice.dataEncerramento!.getTime()).toBeGreaterThan(Date.now());
    expect((await pncp.getItems(notice)).length).toBeGreaterThan(0);
    const files = await pncp.getFiles(notice);
    const pdf = await pncp.download(files[0].url);
    expect(pdf.contentType).toBe("application/pdf");
    const pages = await pdfText.extractPages(pdf.bytes);
    expect(pages.join("\n")).toContain("DA HABILITAÇÃO");
    const contracts = await pncp.listContractItems({ dataInicial: "20260101", dataFinal: "20991231", page: 1 });
    expect(contracts.data.every((c) => c.valorUnitario > 0)).toBe(true);
    await expect(pncp.listOpenNotices({ dataFinal: "20991231", page: 1, pageSize: 5 })).rejects.toThrow(/400/);
  });

  it("filters by modalidade and paginates updates", async () => {
    const updated = await pncp.listUpdatedNotices({ dataInicial: "20260101", dataFinal: "20991231", modalidadeId: 6, page: 1 });
    expect(updated.data.length).toBeGreaterThan(0);
    expect(updated.data.every((n) => n.modalidadeId === 6)).toBe(true);
    expect((await pncp.listUpdatedNotices({ dataInicial: "20260101", dataFinal: "20991231", modalidadeId: 13, page: 1 })).data).toEqual([]);
  });
});

describe("mock Gemini through the real AI adapter", () => {
  it("extracts an edital with verifiable citations", async () => {
    const notice = await firstNotice();
    const files = await pncp.getFiles(notice);
    const texts = await pdfText.extractPages((await pncp.download(files[0].url)).bytes);
    const pages = texts.map((text, i) => ({ fileId: "f1", fileName: "Edital", page: i + 1, text }));
    const extraction = await ai.extractNotice({ pages });
    const report = applyCitationChecks(extraction, new Map([["f1", texts]]));
    expect(report.failedPaths).toEqual([]);
    expect(report.verifiedCount).toBeGreaterThan(8);
    expect(extraction.objeto.value).toMatch(/limpeza/i);
    expect(extraction.requirements.map((r) => r.documentKind)).toEqual(
      expect.arrayContaining(["contrato_social", "cnd_federal", "crf_fgts", "cndt", "falencia", "atestado"]),
    );
    expect(extraction.declarations.map((d) => d.title)).toContain("Declaração de não emprego de menor");
    expect(extraction.dates.esclarecimentos.value).toMatch(/^\d{4}-\d{2}-\d{2}T18:00:00$/);
    expect(extraction.dates.sessao.value).toMatch(/T09:00:00$/);
    expect(extraction.submissionPortal).toBe("Compras.gov.br");
  });

  it("OCRs scanned PDFs", async () => {
    const notice = await firstNotice(true);
    const pdf = await pncp.download((await pncp.getFiles(notice))[0].url);
    expect((await pdfText.extractPages(pdf.bytes)).join("").trim()).toBe("");
    const pages = await ai.ocr({ bytes: pdf.bytes, mediaType: "application/pdf" });
    expect(pages).toHaveLength(5);
    expect(pages[2]).toContain("FGTS");
  });

  it("embeds deterministically at 768 dims with meaningful similarity", async () => {
    const [a, b, c] = await ai.embed(["material de limpeza e higiene", "produtos de limpeza e higiene pessoal", "obras de pavimentação asfáltica"], "document");
    expect(a).toHaveLength(768);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
    expect((await ai.embed(["material de limpeza e higiene"], "query"))[0]).toEqual(a);
  });

  it("classifies, reads documents, drafts, verifies and writes instructions", async () => {
    expect((await ai.classifyCnae({ objeto: "Aquisição de material de limpeza", cnaes: ["4649-4/08 - Comércio de produtos de limpeza"], expertise: "" })).compatible).toBe(true);
    expect((await ai.classifyCnae({ objeto: "Obras de pavimentação", cnaes: ["4649-4/08 - Comércio de produtos de limpeza"], expertise: "" })).compatible).toBe(false);
    const doc = await ai.extractDocument({
      fileName: "cnd.pdf",
      text: "CERTIDÃO NEGATIVA DE DÉBITOS RELATIVOS AOS TRIBUTOS FEDERAIS\nCNPJ: 11.222.333/0001-81\nEmitida em 01/11/2026. Válida até 30/04/2027.\nEmissor: Receita Federal",
    });
    expect(doc).toEqual({ kind: "cnd_federal", issuer: "Receita Federal", cnpj: "11.222.333/0001-81", issuedAt: "2026-11-01", validUntil: "2027-04-30" });
    const draft = await ai.draft({
      kind: "proposal",
      title: "Proposta comercial",
      slots: ["intro", "validity", "conditions"],
      company: { razaoSocial: "ACME LTDA", porte: "EPP", expertise: "" },
      notice: { objeto: "Material de limpeza", orgaoNome: "Prefeitura", numeroEdital: "1/2026", modalidade: "Pregão" },
      excerpts: [],
      guidance: "",
    });
    expect(Object.keys(draft)).toEqual(["intro", "validity", "conditions"]);
    expect(await ai.verifyDocument({ markdown: "# x", requirements: [] })).toEqual([]);
    const md = await ai.submissionInstructions({ portal: "Compras.gov.br", link: "https://x", modalidade: "Pregão", documents: ["CND Federal"], declarations: [], excerpts: [] });
    expect(md).toContain("Compras.gov.br");
    expect(md).toContain("CND Federal");
  });

  it("extracts experiences from atestados", async () => {
    const exp = await ai.extractExperience({ fileName: "a.pdf", text: "ATESTADO DE CAPACIDADE TÉCNICA\nPrefeitura Municipal Fictícia\nFornecimento de 10.000 unidades de detergente no período de 01/01/2025 a 31/12/2025." });
    expect(exp.issuer).toBe("Prefeitura Municipal Fictícia");
    expect(exp.periodStart).toBe("2025-01-01");
    expect(exp.periodEnd).toBe("2025-12-31");
  });
});

describe("mock BrasilAPI, AbacatePay and calendars", () => {
  it("looks up companies", async () => {
    const lookup = new BrasilApiCompanyLookup({ fetch });
    expect((await lookup.findByCnpj("11222333000181"))?.porte).toBe("EPP");
    expect(await lookup.findByCnpj("40400000000100")).toBeNull();
  });

  it("creates customers and subscription checkouts pointing back to the app", async () => {
    const pay = new AbacatePayGateway({ apiKey: "k", webhookSecret: "s", productIds: { pro: "p1", business: "p2" }, fetch });
    const customer = await pay.ensureCustomer({ name: "A", email: "a@b.c", taxId: "11222333000181" });
    const checkout = await pay.createSubscriptionCheckout({ planId: "pro", customerRef: customer, externalId: "org-1", returnUrl: "r", completionUrl: "http://app.test/billing" });
    expect(checkout.url).toMatch(/^http:\/\/app\.test\/api\/mock\/abacatepay\/checkout\?/);
    await pay.cancelSubscription("subs_1");
  });

  it("runs Google and Microsoft OAuth + event writes", async () => {
    for (const provider of [
      new GoogleCalendarProvider({ clientId: "c", clientSecret: "s", redirectUri: "r", fetch }),
      new MicrosoftCalendarProvider({ clientId: "c", clientSecret: "s", redirectUri: "r", fetch }),
    ]) {
      const tokens = await provider.exchangeCode("code");
      expect(tokens.email).toMatch(/@/);
      const event = { key: "k", refType: "bid" as const, refId: "b", title: "Prazo", description: "", start: new Date(), end: new Date() };
      const id = await provider.upsertEvent(tokens.accessToken, "primary", null, event);
      expect(await provider.upsertEvent(tokens.accessToken, "primary", id, event)).toBe(id);
      await provider.deleteEvent(tokens.accessToken, "primary", id);
    }
  });

  it("refuses unmocked hosts", async () => {
    await expect(fetch("https://example.com/x")).rejects.toThrow(/Unmocked/);
  });

  it("builds PDFs the real extractor reads", async () => {
    expect(await pdfText.extractPages(buildPdf(["Olá, licitação!", "Página 2"]))).toEqual(["Olá, licitação!", "Página 2"]);
  });
});
