export interface Notice {
  id: string;
  numeroControlePNCP: string;
  orgaoCnpj: string;
  orgaoNome: string;
  ano: number;
  sequencial: number;
  numeroCompra: string | null;
  processo: string | null;
  objeto: string;
  informacaoComplementar: string | null;
  modalidadeId: number;
  modalidadeNome: string;
  modoDisputa: string | null;
  situacao: string | null;
  valorEstimado: number | null;
  uf: string | null;
  municipioIbge: string | null;
  municipioNome: string | null;
  unidadeNome: string | null;
  dataPublicacao: Date | null;
  dataAbertura: Date | null;
  dataEncerramento: Date | null;
  linkSistemaOrigem: string | null;
  linkProcessoEletronico: string | null;
  updatedAtPncp: Date | null;
  filesIngestedAt: Date | null;
}

export interface NoticeItem {
  numeroItem: number;
  descricao: string;
  quantidade: number | null;
  unidade: string | null;
  valorUnitario: number | null;
  valorTotal: number | null;
}

export interface NoticeFile {
  id: string;
  noticeId: string;
  sequencialDocumento: number;
  tipo: string | null;
  titulo: string;
  url: string;
  storageKey: string | null;
  pageCount: number | null;
  ocr: boolean;
}

/** Pages of extracted text per notice file, used for citation checks. */
export type NoticePages = Map<string, string[]>;

/** PNCP reference used to address a compra in the API. */
export interface CompraRef {
  orgaoCnpj: string;
  ano: number;
  sequencial: number;
}

export function compraRefFromControle(numeroControlePNCP: string): CompraRef {
  // Format: {cnpj}-1-{sequencial}/{ano}
  const match = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(numeroControlePNCP);
  if (!match) throw new Error(`Invalid numeroControlePNCP: ${numeroControlePNCP}`);
  return { orgaoCnpj: match[1], sequencial: Number(match[2]), ano: Number(match[3]) };
}

export const MODALIDADES: Record<number, string> = {
  1: "Leilão - Eletrônico",
  2: "Diálogo Competitivo",
  3: "Concurso",
  4: "Concorrência - Eletrônica",
  5: "Concorrência - Presencial",
  6: "Pregão - Eletrônico",
  7: "Pregão - Presencial",
  8: "Dispensa de Licitação",
  9: "Inexigibilidade",
  10: "Manifestação de Interesse",
  11: "Pré-qualificação",
  12: "Credenciamento",
  13: "Leilão - Presencial",
};

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

/** Text used to embed and keyword-match a notice. */
export function noticeSearchText(notice: Pick<Notice, "objeto" | "informacaoComplementar">, items: Pick<NoticeItem, "descricao">[]): string {
  return [notice.objeto, notice.informacaoComplementar ?? "", ...items.map((i) => i.descricao)]
    .filter(Boolean)
    .join("\n");
}
