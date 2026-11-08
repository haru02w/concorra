/** Test fixtures shared by domain and application tests. */
import type { NoticeExtraction } from "./analysis/extraction";
import type { VaultDocument } from "./documents/document";
import type { Notice, NoticeItem } from "./notice/notice";
import type { Organization } from "./organization/organization";
import { EMPTY_FILTERS, type Rule } from "./rules/rule";

export function makeNotice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: "notice-1",
    numeroControlePNCP: "31723570000133-1-000176/2026",
    orgaoCnpj: "31723570000133",
    orgaoNome: "MUNICIPIO DE VARGEM ALTA",
    ano: 2026,
    sequencial: 176,
    numeroCompra: "90005/2026",
    processo: "2026-123",
    objeto: "Aquisição de material de limpeza e higiene para as escolas municipais",
    informacaoComplementar: null,
    modalidadeId: 6,
    modalidadeNome: "Pregão - Eletrônico",
    modoDisputa: "Aberto",
    situacao: "Divulgada no PNCP",
    valorEstimado: 150000,
    uf: "ES",
    municipioIbge: "3205036",
    municipioNome: "Vargem Alta",
    unidadeNome: "Prefeitura",
    dataPublicacao: new Date("2026-11-01T12:00:00Z"),
    dataAbertura: new Date("2026-11-02T11:00:00Z"),
    dataEncerramento: new Date("2026-11-20T12:00:00Z"),
    linkSistemaOrigem: "https://compras.example.gov.br/edital/1",
    linkProcessoEletronico: null,
    updatedAtPncp: new Date("2026-11-01T12:00:00Z"),
    filesIngestedAt: null,
    ...overrides,
  };
}

export function makeItem(overrides: Partial<NoticeItem> = {}): NoticeItem {
  return {
    numeroItem: 1,
    descricao: "Detergente neutro 500ml",
    quantidade: 1000,
    unidade: "UN",
    valorUnitario: 2.5,
    valorTotal: 2500,
    ...overrides,
  };
}

export function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    organizationId: "org-1",
    name: "Limpeza ES",
    filters: { ...EMPTY_FILTERS, keywordsInclude: ["material de limpeza"], ufs: ["ES"] },
    semanticThreshold: null,
    minScore: null,
    channels: ["email", "inapp"],
    frequency: "immediate",
    active: true,
    ...overrides,
  };
}

export function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    workosOrgId: "org_workos_1",
    cnpj: "11222333000181",
    razaoSocial: "LIMPA BEM COMERCIO LTDA",
    nomeFantasia: "Limpa Bem",
    porte: "EPP",
    cnaePrincipal: "4649-4/08 - Comércio atacadista de produtos de higiene, limpeza e conservação domiciliar",
    cnaesSecundarios: [],
    endereco: "Rua das Flores, 100 - Centro, Vitória/ES",
    municipio: "Vitória",
    uf: "ES",
    representante: "Maria Exemplo",
    ufs: ["ES"],
    municipios: [],
    valueMin: 10000,
    valueMax: 500000,
    expertiseText: "Fornecimento de material de limpeza e higiene para órgãos públicos",
    planId: "pro",
    ...overrides,
  };
}

export function makeDoc(overrides: Partial<VaultDocument> = {}): VaultDocument {
  return {
    id: "doc-1",
    organizationId: "org-1",
    kind: "cnd_federal",
    fileId: "file-1",
    fileName: "cnd-federal.pdf",
    issuer: "Receita Federal",
    cnpj: "11222333000181",
    issuedAt: new Date("2026-10-01T00:00:00Z"),
    validUntil: new Date("2027-03-30T00:00:00Z"),
    status: "valid",
    checks: [],
    ...overrides,
  };
}

const cite = (excerpt: string, page = 1) => ({ fileId: "file-edital", page, excerpt });

export function makeExtraction(overrides: Partial<NoticeExtraction> = {}): NoticeExtraction {
  return {
    objeto: { value: "Aquisição de material de limpeza", citation: cite("aquisição de material de limpeza") },
    lots: [],
    dates: {
      impugnacao: { value: "2026-11-15T18:00:00", citation: cite("impugnação até 15/11/2026", 2) },
      esclarecimentos: { value: "2026-11-15T18:00:00", citation: cite("esclarecimentos até 15/11/2026", 2) },
      abertura: { value: "2026-11-20T09:00:00", citation: cite("sessão pública em 20/11/2026", 2) },
      sessao: { value: "2026-11-20T09:00:00", citation: cite("sessão pública em 20/11/2026", 2) },
    },
    requirements: [
      { id: "r1", category: "fiscal_trabalhista", description: "Certidão conjunta federal", documentKind: "cnd_federal", citation: cite("prova de regularidade com a fazenda federal", 3) },
      { id: "r2", category: "fiscal_trabalhista", description: "CRF FGTS", documentKind: "crf_fgts", citation: cite("certificado de regularidade do fgts", 3) },
      { id: "r3", category: "tecnica", description: "Atestado de fornecimento similar", documentKind: null, citation: cite("atestado de capacidade técnica", 3) },
    ],
    declarations: [
      { id: "d1", title: "Declaração de não emprego de menor", description: "Art. 7º XXXIII CF", citation: cite("não emprega menor", 4) },
    ],
    annexModels: [],
    meEppExclusive: { value: true, citation: cite("exclusiva para me/epp", 1) },
    guarantee: { value: null, citation: null },
    visitaTecnica: { value: null, citation: null },
    samples: { value: null, citation: null },
    penalties: { value: "Multa de 10%", citation: cite("multa de 10%", 5) },
    risks: [],
    submissionPortal: "Compras.gov.br",
    ...overrides,
  };
}

export const EDITAL_PAGES: Map<string, string[]> = new Map([
  [
    "file-edital",
    [
      "EDITAL DE PREGÃO ELETRÔNICO. Objeto: Aquisição de Material de Limpeza para as escolas. Licitação exclusiva para ME/EPP.",
      "Pedidos de esclarecimentos até 15/11/2026. Impugnação até 15/11/2026. A sessão pública em 20/11/2026 às 09h.",
      "HABILITAÇÃO: prova de regularidade com a Fazenda Federal; Certificado de Regularidade do FGTS; atestado de capacidade técnica.",
      "Declaração de que não emprega menor de dezoito anos.",
      "Penalidades: multa de 10% sobre o valor do contrato.",
    ],
  ],
]);
