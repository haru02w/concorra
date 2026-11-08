/**
 * Deterministic stand-ins for Gemini. They read the real prompt text and
 * produce schema-valid answers whose citations are verbatim excerpts, so the
 * whole pipeline (citation checks, gaps, score, drafts) runs for real.
 */
import type { DocumentKind } from "@/domain/documents/document";
import { EMBEDDING_DIMENSIONS, l2normalize } from "@/domain/shared/vector";
import { normalizeText, tokenize } from "@/domain/shared/text";

interface Page {
  fileId: string;
  n: number;
  text: string;
}

export function parsePages(prompt: string): Page[] {
  const pages: Page[] = [];
  const re = /<page file="[^"]*" fileId="([^"]*)" n="(\d+)">\n([\s\S]*?)\n<\/page>/g;
  for (const m of prompt.matchAll(re)) pages.push({ fileId: m[1], n: Number(m[2]), text: m[3] });
  return pages;
}

function sentences(page: Page) {
  return page.text
    .split(/\n|(?<=[.;])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
    .map((s) => ({ text: s, page }));
}

const cite = (s: { text: string; page: Page }) => ({ fileId: s.page.fileId, page: s.page.n, excerpt: s.text.slice(0, 300) });

const DATE = /(\d{2})\/(\d{2})\/(\d{4})/;
function isoLocal(text: string): string | null {
  const d = DATE.exec(text);
  if (!d) return null;
  const t = /(\d{1,2})h(\d{2})?|(\d{1,2}):(\d{2})/.exec(text.slice(d.index));
  const hh = (t?.[1] ?? t?.[3] ?? "18").padStart(2, "0");
  const mm = t?.[2] ?? t?.[4] ?? "00";
  return `${d[3]}-${d[2]}-${d[1]}T${hh}:${mm}:00`;
}

const REQUIREMENTS: { re: RegExp; kind: DocumentKind | null; category: string }[] = [
  { re: /contrato social|ato constitutivo|estatuto/i, kind: "contrato_social", category: "juridica" },
  { re: /fazenda nacional|tributos federais|rfb\/pgfn|d[ií]vida ativa da uni/i, kind: "cnd_federal", category: "fiscal_trabalhista" },
  { re: /fgts|fundo de garantia/i, kind: "crf_fgts", category: "fiscal_trabalhista" },
  { re: /justi[çc]a do trabalho|trabalhista|cndt/i, kind: "cndt", category: "fiscal_trabalhista" },
  { re: /fazenda estadual|estadual/i, kind: "cnd_estadual", category: "fiscal_trabalhista" },
  { re: /fazenda municipal|municipal/i, kind: "cnd_municipal", category: "fiscal_trabalhista" },
  { re: /fal[êe]ncia|recupera[çc][ãa]o judicial/i, kind: "falencia", category: "economico_financeira" },
  { re: /balan[çc]o patrimonial/i, kind: "balanco", category: "economico_financeira" },
  { re: /atestado de capacidade/i, kind: "atestado", category: "tecnica" },
  { re: /alvar[áa]|licen[çc]a sanit/i, kind: "alvara", category: "tecnica" },
];

const DECLARATIONS: { re: RegExp; title: string }[] = [
  { re: /menor/i, title: "Declaração de não emprego de menor" },
  { re: /requisitos de habilita/i, title: "Declaração de cumprimento dos requisitos de habilitação" },
  { re: /microempresa|pequeno porte|me\/epp/i, title: "Declaração de enquadramento como ME/EPP" },
  { re: /fatos impeditivos/i, title: "Declaração de inexistência de fatos impeditivos" },
];

function find(all: { text: string; page: Page }[], re: RegExp) {
  return all.find((s) => re.test(s.text)) ?? null;
}

export function mockExtraction(prompt: string) {
  const pages = parsePages(prompt);
  const all = pages.flatMap(sentences);
  const cited = <T>(s: { text: string; page: Page } | null, value: (s: { text: string; page: Page }) => T) =>
    s ? { value: value(s), citation: cite(s) } : { value: null, citation: null };

  const objetoS = find(all, /^objeto\s*:/i) ?? all[0] ?? null;
  const objeto = objetoS
    ? { value: objetoS.text.replace(/^objeto\s*:\s*/i, "").replace(/\.$/, ""), citation: cite(objetoS) }
    : { value: "", citation: null };

  const datedLine = (re: RegExp) => all.find((s) => re.test(s.text) && DATE.test(s.text)) ?? null;
  const esclarecimentos = datedLine(/esclarecimento/i);
  const impugnacao = datedLine(/impugna/i);
  const sessao = datedLine(/sess[ãa]o p[úu]blica/i);

  const isRequirement = /^[a-z]\)|prova de|certid[ãa]o|certificado|atestado|balan[çc]o|contrato social|estatuto|ato constitutivo|alvar[áa]/i;
  const reqSection = all.filter((s) => isRequirement.test(s.text) && !/declara/i.test(s.text));
  const requirements: unknown[] = [];
  for (const s of reqSection) {
    const rule = REQUIREMENTS.find((r) => r.re.test(s.text));
    if (!rule || /multa|garantia|sess[ãa]o|enquadramento/i.test(s.text)) continue;
    if (requirements.some((r) => (r as { documentKind: string }).documentKind === rule.kind)) continue;
    requirements.push({
      id: `r${requirements.length + 1}`,
      category: rule.category,
      description: s.text.replace(/^[a-z]\)\s*/i, "").replace(/;$/, ""),
      documentKind: rule.kind,
      citation: cite(s),
    });
  }

  const declarations: unknown[] = [];
  const headerAt = all.findIndex((x) => /^DAS DECLARA/.test(x.text));
  const declarationLines = all.filter((x, i) => /declara/i.test(x.text) || (headerAt >= 0 && i > headerAt && x.page === all[headerAt].page));
  for (const s of declarationLines) {
    const d = DECLARATIONS.find((x) => x.re.test(s.text));
    if (!d || declarations.some((x) => (x as { title: string }).title === d.title)) continue;
    declarations.push({ id: `d${declarations.length + 1}`, title: d.title, description: s.text.replace(/^[IVX]+\s*[-—]\s*/, ""), citation: cite(s) });
  }

  const exclusive = find(all, /exclusiva para microempresas|exclusiva para me\/epp/i);
  const penalties = find(all, /multa/i);
  const risks: unknown[] = [];
  const pct = penalties && /(\d+)%/.exec(penalties.text);
  if (pct && Number(pct[1]) >= 20) {
    risks.push({ title: "Multa elevada", detail: `Multa de ${pct[1]}% sobre o valor estimado.`, severity: "medium", citation: cite(penalties!) });
  }
  const samples = find(all, /amostra/i);
  if (samples) risks.push({ title: "Exige amostras", detail: "Prazo curto para entrega de amostras.", severity: "low", citation: cite(samples) });

  const portal = /compras\.gov\.br/i.test(prompt) ? "Compras.gov.br" : /licita[çc][õo]es-e/i.test(prompt) ? "Licitações-e" : null;
  return {
    objeto,
    lots: [],
    dates: {
      impugnacao: cited(impugnacao, (s) => isoLocal(s.text)),
      esclarecimentos: cited(esclarecimentos, (s) => isoLocal(s.text)),
      abertura: cited(sessao, (s) => isoLocal(s.text)),
      sessao: cited(sessao, (s) => isoLocal(s.text)),
    },
    requirements,
    declarations,
    annexModels: [],
    meEppExclusive: exclusive ? { value: true, citation: cite(exclusive) } : { value: null, citation: null },
    guarantee: cited(find(all, /garantia/i), (s) => s.text),
    visitaTecnica: cited(find(all, /visita t[ée]cnica/i), (s) => s.text),
    samples: cited(samples, (s) => s.text),
    penalties: cited(penalties, (s) => s.text),
    risks,
    submissionPortal: portal,
  };
}

const STOP = new Set(["para", "com", "dos", "das", "aquisicao", "contratacao", "empresa", "servicos", "material", "materiais", "registro", "precos", "comercio", "atacadista", "produtos"]);
const keywords = (text: string) => new Set(tokenize(text).filter((t) => t.length > 4 && !STOP.has(t)).map((t) => t.slice(0, 6)));

export function mockClassify(prompt: string) {
  const objeto = /<documento nome="objeto">([\s\S]*?)<\/documento>/.exec(prompt)?.[1] ?? "";
  const company = prompt.slice(0, prompt.indexOf("Objeto da licitação"));
  const shared = [...keywords(objeto)].filter((k) => keywords(company).has(k));
  return shared.length
    ? { compatible: true, reason: `Atividades da empresa cobrem o objeto (${shared.slice(0, 3).join(", ")}).` }
    : { compatible: false, reason: "Objeto sem relação com os CNAEs e a área de atuação informados." };
}

const KIND_HINTS: [RegExp, DocumentKind][] = [
  [/tributos federais|fazenda nacional|receita federal|rfb|pgfn/i, "cnd_federal"],
  [/fgts|crf/i, "crf_fgts"],
  [/trabalhistas|cndt/i, "cndt"],
  [/estadual/i, "cnd_estadual"],
  [/municipal/i, "cnd_municipal"],
  [/fal[êe]ncia/i, "falencia"],
  [/balan[çc]o/i, "balanco"],
  [/contrato social|estatuto/i, "contrato_social"],
  [/atestado/i, "atestado"],
  [/alvar[áa]/i, "alvara"],
];

const isoDate = (m: RegExpExecArray | null) => (m ? `${m[3]}-${m[2]}-${m[1]}` : null);
const documentBody = (prompt: string) => /<documento[^>]*>\n?([\s\S]*?)\n?<\/documento>/.exec(prompt)?.[1] ?? prompt;

export function mockDocument(prompt: string) {
  const text = documentBody(prompt);
  const cnpj = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.exec(text)?.[0] ?? /\b\d{14}\b/.exec(text)?.[0] ?? null;
  const issuer = text.split("\n").find((l) => /emissor|receita|caixa|tribunal|junta|prefeitura|secretaria/i.test(l))?.replace(/^emissor:\s*/i, "").trim() ?? null;
  return {
    kind: KIND_HINTS.find(([re]) => re.test(text))?.[1] ?? null,
    issuer,
    cnpj,
    issuedAt: isoDate(/emitid[ao] em (\d{2})\/(\d{2})\/(\d{4})/i.exec(text)),
    validUntil: isoDate(/v[áa]lid[ao] at[ée] (\d{2})\/(\d{2})\/(\d{4})/i.exec(text)),
  };
}

export function mockExperience(prompt: string) {
  const text = documentBody(prompt);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const object = lines.find((l) => /fornecimento|presta[çc][ãa]o|execu[çc][ãa]o|aquisi[çc][ãa]o/i.test(l)) ?? lines[0] ?? "Experiência sem descrição";
  const dates = [...text.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
  return {
    issuer: lines.find((l) => /prefeitura|munic[íi]pio|secretaria|cons[óo]rcio|governo|hospital/i.test(l)) ?? null,
    object: object.slice(0, 300),
    quantities: /\d[\d.]*\s*(unidades|itens|pacotes|litros|kg|toneladas)/i.exec(text)?.[0] ?? null,
    periodStart: dates[0] ? isoDate(dates[0] as unknown as RegExpExecArray) : null,
    periodEnd: dates[1] ? isoDate(dates[1] as unknown as RegExpExecArray) : null,
  };
}

export function mockDraft(prompt: string, slots: string[]) {
  const title = /^Documento: (.*) \(/m.exec(prompt)?.[1] ?? "Documento";
  const guidance = /^Orientação: (.*)$/m.exec(prompt)?.[1] ?? "";
  const company = /^Empresa: (.*) \(porte/m.exec(prompt)?.[1] ?? "A empresa";
  const objeto = /^Objeto: (.*)$/m.exec(prompt)?.[1] ?? "o objeto licitado";
  const text: Record<string, string> = {
    body: `${company}, por intermédio de seu representante legal, DECLARA, para fins de participação na licitação cujo objeto é ${objeto.toLowerCase()}, o que segue: ${title.replace(/^Declaração de /i, "").toLowerCase()}. ${guidance}`.trim(),
    intro: `${company} apresenta proposta comercial para ${objeto.toLowerCase()}, conforme especificações e quantidades do edital.`,
    validity: "60 (sessenta) dias, contados da data de abertura da sessão pública.",
    conditions: "Nos preços estão incluídos todos os custos diretos e indiretos, tributos, encargos sociais, frete e demais despesas necessárias ao fornecimento.",
  };
  return Object.fromEntries(slots.map((s) => [s, text[s] ?? `${title}: texto do campo ${s}.`]));
}

export function mockInstructions(prompt: string) {
  const portal = /^Portal: (.*)$/m.exec(prompt)?.[1] ?? "portal indicado no edital";
  const link = /^Link: (.*)$/m.exec(prompt)?.[1] ?? "-";
  const docs = /Documentos do pacote:\n([\s\S]*?)\n\n/.exec(prompt)?.[1] ?? "";
  return `# Instruções de envio — ${portal}

1. Acesse o ${portal} (${link}) com o certificado ou login da empresa e confirme o credenciamento.
2. Localize o processo pelo número do edital e abra a etapa de envio de proposta.
3. Cadastre a proposta com os preços revisados e anexe a proposta comercial assinada.
4. Anexe os documentos de habilitação, nesta ordem:
${docs}
5. Preencha as declarações no sistema ou anexe as declarações assinadas.
6. Confira tudo antes do encerramento do prazo e guarde o comprovante de envio.

> Gerado em modo de simulação (mock). Confira sempre o edital.`;
}

/** Bag-of-words hashing embedding: similar texts get high cosine similarity. */
export function mockEmbedding(text: string, dims = EMBEDDING_DIMENSIONS): number[] {
  const v: number[] = new Array<number>(dims).fill(0);
  for (const token of tokenize(normalizeText(text))) {
    if (token.length < 3) continue;
    const stem = token.slice(0, 6);
    let h = 2166136261;
    for (const ch of stem) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    v[h % dims] += 1;
    v[(h >>> 11) % dims] += 0.5;
  }
  if (!v.some((x) => x !== 0)) v[0] = 1;
  return l2normalize(v);
}
