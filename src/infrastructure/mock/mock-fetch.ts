/**
 * MOCK_EXTERNAL=true: a `fetch` that answers every external API the real
 * adapters call (PNCP, BrasilAPI, Gemini, AbacatePay, Google, Microsoft) with
 * deterministic, fictitious data in each service's wire format. Real adapters
 * run unchanged; only the network is fake. Unknown hosts throw.
 */
import type { PdfTextExtractor } from "@/application/ports";
import * as P from "../ai/prompts";
import { mockClassify, mockDocument, mockDraft, mockEmbedding, mockExperience, mockExtraction, mockInstructions } from "./ai-mock";
import type { MockOutbox } from "./outbox";
import { buildPdf, buildScannedPdf, readScannedPdfText } from "./pdf";
import { findMockCompra, mockCompany, mockCompras, mockContracts } from "./pncp-fixtures";

export interface MockNetworkOptions {
  appUrl: string;
  outbox?: MockOutbox;
  pdfText?: PdfTextExtractor;
  now?: () => Date;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
type Handler = (req: Request, url: URL) => Promise<Response> | Response;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const id = (prefix: string) => `${prefix}_mock_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

function page<T>(rows: T[], url: URL) {
  const pagina = Number(url.searchParams.get("pagina") ?? "1");
  const tamanho = Number(url.searchParams.get("tamanhoPagina") ?? "50");
  if (tamanho < 10) return json({ message: "must be greater than or equal to 10", status: "400" }, 400);
  const totalPaginas = Math.max(1, Math.ceil(rows.length / tamanho));
  if (!rows.length) return new Response(null, { status: 204 });
  return json({
    data: rows.slice((pagina - 1) * tamanho, pagina * tamanho),
    totalRegistros: rows.length,
    totalPaginas,
    numeroPagina: pagina,
    paginasRestantes: Math.max(0, totalPaginas - pagina),
    empty: false,
  });
}

function pncp(now: () => Date): Handler {
  return (_req, url) => {
    const path = url.pathname;
    const compras = mockCompras(now());
    if (path.endsWith("/contratacoes/proposta")) {
      const modalidade = Number(url.searchParams.get("codigoModalidadeContratacao") ?? "0");
      return page(compras.filter((c) => !modalidade || c.json.modalidadeId === modalidade).map((c) => c.json), url);
    }
    if (path.endsWith("/contratacoes/atualizacao") || path.endsWith("/contratacoes/publicacao")) {
      const modalidade = Number(url.searchParams.get("codigoModalidadeContratacao"));
      if (!modalidade) return json({ message: "codigoModalidadeContratacao obrigatório" }, 400);
      return page(compras.filter((c) => c.json.modalidadeId === modalidade).map((c) => c.json), url);
    }
    if (path.endsWith("/contratos")) return page(mockContracts(now()), url);

    const m = /\/orgaos\/(\d{14})\/compras\/(\d{4})\/(\d+)(\/.*)?$/.exec(path);
    const compra = m && findMockCompra(m[1], Number(m[2]), Number(m[3]), now());
    if (!m || !compra) return json({ message: "Não encontrado" }, 404);
    const rest = m[4] ?? "";
    if (rest === "/itens") return json(Number(url.searchParams.get("pagina") ?? "1") > 1 ? [] : compra.items);
    if (rest === "/arquivos") {
      const base = `https://pncp.gov.br/pncp-api/v1/orgaos/${compra.cnpj}/compras/${compra.ano}/${compra.sequencial}/arquivos`;
      return json([
        { sequencialDocumento: 1, titulo: "Edital", tipoDocumentoNome: "Edital", url: `${base}/1`, statusAtivo: true },
        ...(compra.hasZipAnnex ? [{ sequencialDocumento: 2, titulo: "Anexos", tipoDocumentoNome: "Outros Documentos", url: `${base}/2`, statusAtivo: true }] : []),
      ]);
    }
    if (rest === "/arquivos/1") {
      const bytes = compra.scanned ? buildScannedPdf(compra.editalPages) : buildPdf(compra.editalPages);
      return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="edital.pdf"' } });
    }
    if (rest === "/arquivos/2") {
      return new Response(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]), {
        headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="anexos.zip"' },
      });
    }
    if (rest === "") return json(compra.json);
    return json({ message: "Não encontrado" }, 404);
  };
}

const brasilApi: Handler = (_req, url) => {
  const cnpj = /\/api\/cnpj\/v1\/(\d+)/.exec(url.pathname)?.[1];
  if (!cnpj) return json({ message: "Not found" }, 404);
  if (cnpj.startsWith("404")) return json({ message: `CNPJ ${cnpj} não encontrado.` }, 404);
  return json(mockCompany(cnpj));
};

function abacatePay(options: MockNetworkOptions): Handler {
  return async (req, url) => {
    if (!req.headers.get("authorization")?.startsWith("Bearer ")) return json({ success: false, data: null, error: "Unauthorized" }, 401);
    const body = (await req.json().catch(() => ({}))) as Json;
    const ok = (data: unknown) => json({ success: true, data, error: null });
    await options.outbox?.record("payments", { path: url.pathname, body });
    switch (url.pathname) {
      case "/v2/customers/create":
        return ok({ id: id("cust"), devMode: true, ...body });
      case "/v2/products/create":
        return ok({ id: `prod_mock_${body.externalId}`, devMode: true, ...body });
      case "/v2/subscriptions/create": {
        const checkout = id("bill");
        const q = new URLSearchParams({ id: checkout, externalId: body.externalId ?? "", customerId: body.customerId ?? "", completionUrl: body.completionUrl ?? "" });
        return ok({ id: checkout, url: `${options.appUrl}/api/mock/abacatepay/checkout?${q}`, status: "PENDING", devMode: true });
      }
      case "/v2/subscriptions/cancel":
        return ok({ id: body.id, status: "CANCELLED", devMode: true });
      default:
        return json({ success: false, data: null, error: "Not found" }, 404);
    }
  };
}

function gemini(options: MockNetworkOptions): Handler {
  return async (req, url) => {
    const m = /\/models\/([^:]+):(\w+)$/.exec(url.pathname);
    if (!m) return json({ error: { code: 404, message: "Not found", status: "NOT_FOUND" } }, 404);
    const [, model, method] = m;
    const body = (await req.json()) as Json;
    if (method === "embedContent") {
      return json({ embedding: { values: mockEmbedding(body.content.parts.map((p: Json) => p.text ?? "").join(" "), body.outputDimensionality) } });
    }
    if (method === "batchEmbedContents") {
      return json({ embeddings: body.requests.map((r: Json) => ({ values: mockEmbedding(r.content.parts.map((p: Json) => p.text ?? "").join(" "), r.outputDimensionality) })) });
    }
    if (method !== "generateContent") return json({ error: { code: 400, message: `Unsupported ${method}`, status: "INVALID_ARGUMENT" } }, 400);

    const system = (body.systemInstruction?.parts ?? []).map((p: Json) => p.text).join("\n");
    const parts: Json[] = (body.contents ?? []).flatMap((c: Json) => c.parts ?? []);
    const prompt = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("\n");
    const schema = body.generationConfig?.responseJsonSchema;
    let answer: unknown;
    if (system === P.OCR_INSTRUCTIONS) {
      const file = parts.find((p) => p.inlineData)?.inlineData;
      const bytes = file ? Uint8Array.from(Buffer.from(file.data, "base64")) : new Uint8Array();
      const pages =
        readScannedPdfText(bytes) ??
        (file?.mimeType === "application/pdf" && options.pdfText ? await options.pdfText.extractPages(bytes).catch(() => null) : null) ??
        ["[OCR simulado] Documento digitalizado sem texto reconhecível."];
      answer = pages.join(`\n${P.PAGE_MARKER}\n`);
    } else if (system === P.EXTRACT_INSTRUCTIONS) answer = mockExtraction(prompt);
    else if (system === P.CLASSIFY_INSTRUCTIONS) answer = mockClassify(prompt);
    else if (system === P.DOCUMENT_INSTRUCTIONS) answer = mockDocument(prompt);
    else if (system === P.EXPERIENCE_INSTRUCTIONS) answer = mockExperience(prompt);
    else if (system === P.DRAFT_INSTRUCTIONS) answer = mockDraft(prompt, Object.keys(schema?.properties ?? {}));
    else if (system === P.VERIFY_INSTRUCTIONS) answer = { issues: [] };
    else if (system === P.INSTRUCTIONS_INSTRUCTIONS) answer = mockInstructions(prompt);
    else return json({ error: { code: 400, message: "Mock Gemini: unknown task", status: "INVALID_ARGUMENT" } }, 400);

    const text = typeof answer === "string" ? answer : JSON.stringify(answer);
    return json({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: Math.ceil(prompt.length / 4), candidatesTokenCount: Math.ceil(text.length / 4), totalTokenCount: Math.ceil((prompt.length + text.length) / 4) },
      modelVersion: model,
      responseId: id("resp"),
    });
  };
}

function fakeIdToken(claims: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.mock`;
}

function oauthToken(provider: string, email: string): Handler {
  return async (req) => {
    const form = new URLSearchParams(await req.text());
    if (!form.get("code") && !form.get("refresh_token")) return json({ error: "invalid_request" }, 400);
    return json({
      access_token: id(`${provider}_access`),
      refresh_token: form.get("refresh_token") ?? id(`${provider}_refresh`),
      expires_in: 3600,
      token_type: "Bearer",
      id_token: fakeIdToken({ email, preferred_username: email }),
    });
  };
}

function calendarEvents(provider: string, options: MockNetworkOptions): Handler {
  return async (req, url) => {
    if (!req.headers.get("authorization")?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const body = req.method === "DELETE" ? null : ((await req.json().catch(() => null)) as Json);
    const eventId = /\/events\/([^/]+)$/.exec(url.pathname)?.[1];
    await options.outbox?.record("calendar", { provider, method: req.method, eventId: eventId ?? null, title: body?.summary ?? body?.subject ?? null });
    if (req.method === "DELETE") return new Response(null, { status: 204 });
    if (req.method === "PATCH" && eventId) return json({ id: decodeURIComponent(eventId), ...body });
    if (req.method === "POST") return json({ id: id(`${provider}_evt`), ...body });
    return json({ error: "not found" }, 404);
  };
}

export function createMockFetch(options: MockNetworkOptions): typeof fetch {
  const now = options.now ?? (() => new Date());
  const hosts: Record<string, Handler> = {
    "pncp.gov.br": pncp(now),
    "brasilapi.com.br": brasilApi,
    "api.abacatepay.com": abacatePay(options),
    "generativelanguage.googleapis.com": gemini(options),
    "oauth2.googleapis.com": oauthToken("google", "agenda.mock@gmail.test"),
    "www.googleapis.com": calendarEvents("google", options),
    "login.microsoftonline.com": oauthToken("microsoft", "agenda.mock@outlook.test"),
    "graph.microsoft.com": calendarEvents("microsoft", options),
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const handler = hosts[url.hostname];
    if (!handler) throw new Error(`Unmocked external call in MOCK_EXTERNAL mode: ${req.method} ${url.origin}${url.pathname}`);
    return handler(req, url);
  }) as typeof fetch;
}
