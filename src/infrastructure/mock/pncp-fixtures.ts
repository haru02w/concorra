/**
 * Deterministic, fictitious PNCP data (Hack Brasil 6.9: no real third-party data).
 * Dates are relative to "today" so notices are always open; ids are stable per day.
 */
import { addDays, toPncpDate } from "@/domain/shared/dates";

const DAY = 24 * 60 * 60 * 1000;

function cnpjCheck(base: string): string {
  const dv = (b: string) => {
    const w = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = b.split("").reduce((a, d, i) => a + Number(d) * w[i], 0) % 11;
    return r < 2 ? "0" : String(11 - r);
  };
  const first = base + dv(base);
  return first + dv(first);
}

/** Fictitious órgão CNPJ (prefix 98 is not used by the generator for companies). */
export const mockOrgaoCnpj = (i: number) => cnpjCheck(`98${String(i).padStart(6, "0")}0001`);

const PLACES = [
  { uf: "ES", municipio: "Vitória", ibge: "3205309" },
  { uf: "MG", municipio: "Belo Horizonte", ibge: "3106200" },
  { uf: "RJ", municipio: "Niterói", ibge: "3303302" },
  { uf: "SP", municipio: "Campinas", ibge: "3509502" },
  { uf: "BA", municipio: "Salvador", ibge: "2927408" },
  { uf: "PR", municipio: "Londrina", ibge: "4113700" },
  { uf: "RS", municipio: "Caxias do Sul", ibge: "4305108" },
  { uf: "DF", municipio: "Brasília", ibge: "5300108" },
];

const MODALIDADES: [number, string][] = [
  [6, "Pregão - Eletrônico"],
  [6, "Pregão - Eletrônico"],
  [8, "Dispensa de Licitação"],
  [4, "Concorrência - Eletrônica"],
];

interface Theme {
  objeto: string;
  items: [string, string, number, number][]; // descricao, unidade, quantidade, valor unitário
}

const THEMES: Theme[] = [
  {
    objeto: "Registro de preços para aquisição de material de limpeza e higiene para as unidades escolares",
    items: [
      ["Detergente líquido neutro, frasco 500 ml", "UN", 3000, 2.35],
      ["Água sanitária 2% a 2,5% de cloro ativo, frasco 1 litro", "UN", 2500, 3.1],
      ["Papel higiênico folha dupla, pacote com 4 rolos de 30 m", "PCT", 4000, 6.4],
    ],
  },
  {
    objeto: "Aquisição de material de expediente e papelaria para as secretarias municipais",
    items: [
      ["Papel sulfite A4 75 g/m², resma com 500 folhas", "RESMA", 1200, 27.5],
      ["Caneta esferográfica azul, caixa com 50 unidades", "CX", 300, 38.0],
    ],
  },
  {
    objeto: "Contratação de empresa para prestação de serviços de limpeza e conservação predial",
    items: [["Serviço de limpeza e conservação predial, posto de 44 horas semanais", "POSTO", 12, 5200]],
  },
  {
    objeto: "Aquisição de gêneros alimentícios para a merenda escolar",
    items: [
      ["Arroz tipo 1, pacote 5 kg", "PCT", 2000, 24.9],
      ["Feijão carioca tipo 1, pacote 1 kg", "PCT", 3000, 8.7],
    ],
  },
  {
    objeto: "Aquisição de equipamentos de informática (computadores e monitores)",
    items: [
      ["Computador desktop, processador 8 núcleos, 16 GB RAM, SSD 512 GB", "UN", 80, 4300],
      ["Monitor LED 24 polegadas Full HD", "UN", 80, 890],
    ],
  },
  {
    objeto: "Aquisição de sabonete líquido, papel toalha e sacos de lixo para a rede hospitalar",
    items: [
      ["Sabonete líquido para mãos, galão 5 litros", "GL", 300, 28.9],
      ["Papel toalha interfolhado, fardo com 1000 folhas", "FD", 1500, 14.2],
      ["Saco de lixo 100 litros, pacote com 100 unidades", "PCT", 800, 39.5],
    ],
  },
];

export const MOCK_NOTICE_COUNT = 24;

export interface MockCompra {
  index: number;
  cnpj: string;
  ano: number;
  sequencial: number;
  numeroControlePNCP: string;
  json: Record<string, unknown>;
  items: Record<string, unknown>[];
  editalPages: string[];
  /** Every 5th edital is a "scanned" PDF (OCR path); every 3rd has a zip annex. */
  scanned: boolean;
  hasZipAnnex: boolean;
}

const local = (d: Date) => new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
const brDate = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(d);

export function mockCompras(now = new Date()): MockCompra[] {
  const today = new Date(`${toPncpDate(now).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}T12:00:00-03:00`);
  return Array.from({ length: MOCK_NOTICE_COUNT }, (_, index) => {
    const theme = THEMES[index % THEMES.length];
    const place = PLACES[index % PLACES.length];
    const [modalidadeId, modalidadeNome] = MODALIDADES[index % MODALIDADES.length];
    const cnpj = mockOrgaoCnpj(index + 1);
    const ano = today.getUTCFullYear();
    const sequencial = 100 + index;
    const numeroControlePNCP = `${cnpj}-1-${String(sequencial).padStart(6, "0")}/${ano}`;
    const encerramento = new Date(today.getTime() + (6 + ((index * 3) % 30)) * DAY + 6 * 60 * 60 * 1000);
    const sessao = new Date(encerramento.getTime() + 15 * 60 * 60 * 1000); // next day 09:00
    const esclarecimentos = addDays(encerramento, -3);
    const publicacao = addDays(today, -1 - (index % 5));
    const orgaoNome = `MUNICÍPIO FICTÍCIO DE ${place.municipio.toUpperCase()} ${index + 1}`;
    const items = theme.items.map(([descricao, unidadeMedida, quantidade, valor], i) => ({
      numeroItem: i + 1,
      descricao,
      unidadeMedida,
      quantidade,
      valorUnitarioEstimado: valor,
      valorTotal: Math.round(valor * quantidade * 100) / 100,
      valorUnitarioHomologado: Math.round(valor * 0.92 * 100) / 100,
      materialOuServico: "M",
    }));
    const valorTotalEstimado = items.reduce((a, i) => a + (i.valorTotal as number), 0);
    const exclusive = valorTotalEstimado <= 80000;
    const editalPages = [
      `${orgaoNome} (ENTE FICTÍCIO PARA TESTES)
EDITAL DE ${modalidadeNome.toUpperCase()} Nº ${sequencial}/${ano}
OBJETO: ${theme.objeto}.
${exclusive ? "A licitação é exclusiva para microempresas e empresas de pequeno porte, nos termos do art. 48, I, da Lei Complementar nº 123/2006." : "A licitação é de ampla participação."}
A sessão pública será realizada no sistema Compras.gov.br no dia ${brDate(sessao)}, às 09h00.`,
      `DOS PEDIDOS DE ESCLARECIMENTO E IMPUGNAÇÃO
Pedidos de esclarecimento e impugnação poderão ser enviados até ${brDate(esclarecimentos)}.
DO ENVIO DA PROPOSTA
As propostas serão recebidas exclusivamente pelo sistema até ${brDate(encerramento)}.`,
      `DA HABILITAÇÃO
a) contrato social ou estatuto em vigor;
b) prova de regularidade fiscal perante a Fazenda Nacional (Certidão Conjunta RFB/PGFN);
c) Certificado de Regularidade do FGTS (CRF);
d) prova de inexistência de débitos perante a Justiça do Trabalho (CNDT);
e) certidão negativa de falência;
f) atestado de capacidade técnica compatível com o objeto.`,
      `DAS DECLARAÇÕES
I - declaração de que não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre;
II - declaração de que cumpre os requisitos de habilitação;
III - declaração de enquadramento como microempresa ou empresa de pequeno porte, quando for o caso.`,
      `DAS SANÇÕES
O licitante ficará sujeito a multa de ${index % 2 ? "20%" : "10%"} sobre o valor estimado da contratação.
DA GARANTIA
Não será exigida garantia contratual.
${index % 4 === 0 ? "Será exigida amostra dos itens no prazo de 3 dias úteis." : ""}
Agente de contratação: Fulano de Tal Fictício. CPF 123.456.789-09.`,
    ];
    return {
      index,
      cnpj,
      ano,
      sequencial,
      numeroControlePNCP,
      scanned: index % 5 === 4,
      hasZipAnnex: index % 3 === 2,
      editalPages,
      items,
      json: {
        numeroControlePNCP,
        orgaoEntidade: { cnpj, razaoSocial: orgaoNome, poderId: "E", esferaId: "M" },
        unidadeOrgao: { ufSigla: place.uf, ufNome: place.uf, municipioNome: place.municipio, codigoIbge: place.ibge, codigoUnidade: `${cnpj}-001`, nomeUnidade: "Secretaria Municipal de Administração" },
        anoCompra: ano,
        sequencialCompra: sequencial,
        numeroCompra: `${sequencial}/${ano}`,
        processo: `${1000 + index}/${ano}`,
        objetoCompra: theme.objeto,
        informacaoComplementar: "Dados fictícios gerados pelo modo mock do Concorra.",
        modalidadeId,
        modalidadeNome,
        modoDisputaNome: modalidadeId === 8 ? "Não se aplica" : "Aberto",
        situacaoCompraNome: "Divulgada no PNCP",
        valorTotalEstimado,
        dataPublicacaoPncp: local(publicacao),
        dataAberturaProposta: local(publicacao),
        dataEncerramentoProposta: local(encerramento),
        dataAtualizacaoGlobal: local(publicacao),
        linkSistemaOrigem: "https://www.gov.br/compras/pt-br",
        linkProcessoEletronico: null,
        srp: index % 2 === 0,
      },
    };
  });
}

export function findMockCompra(cnpj: string, ano: number, sequencial: number, now = new Date()): MockCompra | undefined {
  return mockCompras(now).find((c) => c.cnpj === cnpj && c.ano === ano && c.sequencial === sequencial);
}

/** Past contracts referencing the mock compras (price references). */
export function mockContracts(now = new Date()) {
  return mockCompras(now).map((c) => ({
    numeroControlePNCP: `${c.cnpj}-2-${String(c.sequencial).padStart(6, "0")}/${c.ano}`,
    numeroControlePncpCompra: c.numeroControlePNCP,
    orgaoEntidade: c.json.orgaoEntidade,
    unidadeOrgao: c.json.unidadeOrgao,
    dataAssinatura: local(addDays(now, -10)),
    objetoContrato: c.json.objetoCompra,
    valorGlobal: c.json.valorTotalEstimado,
  }));
}

/** Fictitious company for any CNPJ (BrasilAPI mock). */
export function mockCompany(cnpj: string) {
  return {
    cnpj,
    razao_social: `EMPRESA FICTÍCIA ${cnpj.slice(0, 4)} COMÉRCIO DE PRODUTOS DE LIMPEZA LTDA`,
    nome_fantasia: `Fictícia ${cnpj.slice(0, 4)}`,
    porte: "EMPRESA DE PEQUENO PORTE",
    cnae_fiscal: 4649408,
    cnae_fiscal_descricao: "Comércio atacadista de produtos de higiene, limpeza e conservação domiciliar",
    cnaes_secundarios: [{ codigo: 4686902, descricao: "Comércio atacadista de embalagens" }],
    descricao_tipo_de_logradouro: "RUA",
    logradouro: "DAS ACÁCIAS",
    numero: "100",
    complemento: "",
    bairro: "CENTRO",
    municipio: "VITORIA",
    uf: "ES",
    cep: "29000000",
    qsa: [{ nome_socio: "SÓCIA FICTÍCIA DA SILVA", qualificacao_socio: "Sócio-Administrador" }],
  };
}
