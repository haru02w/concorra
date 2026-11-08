import type { ContractItemUpsert, NoticeUpsert, Page, PncpFile, PncpGateway } from "@/application/ports";
import { compraRefFromControle, type CompraRef, type NoticeItem } from "@/domain/notice/notice";
import { parsePncpDateTime } from "@/domain/shared/dates";

const CONSULTA = "https://pncp.gov.br/api/consulta/v1";
const PNCP = "https://pncp.gov.br/api/pncp/v1";
const USER_AGENT = "Concorra/0.1 (+https://github.com/haru02w/concorra)";
const ITEMS_PAGE_SIZE = 500;

export interface PncpOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between requests, to be polite to PNCP. */
  minGapMs?: number;
  timeoutMs?: number;
  retries?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export class PncpHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`PNCP ${status} for ${url}`);
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function mapCompra(c: Json): NoticeUpsert {
  return {
    numeroControlePNCP: c.numeroControlePNCP,
    orgaoCnpj: c.orgaoEntidade?.cnpj ?? "",
    orgaoNome: c.orgaoEntidade?.razaoSocial ?? "",
    ano: c.anoCompra,
    sequencial: c.sequencialCompra,
    numeroCompra: str(c.numeroCompra),
    processo: str(c.processo),
    objeto: c.objetoCompra ?? "",
    informacaoComplementar: str(c.informacaoComplementar),
    modalidadeId: c.modalidadeId,
    modalidadeNome: c.modalidadeNome ?? "",
    modoDisputa: str(c.modoDisputaNome),
    situacao: str(c.situacaoCompraNome),
    valorEstimado: num(c.valorTotalEstimado),
    uf: str(c.unidadeOrgao?.ufSigla),
    municipioIbge: str(c.unidadeOrgao?.codigoIbge),
    municipioNome: str(c.unidadeOrgao?.municipioNome),
    unidadeNome: str(c.unidadeOrgao?.nomeUnidade),
    dataPublicacao: parsePncpDateTime(c.dataPublicacaoPncp),
    dataAbertura: parsePncpDateTime(c.dataAberturaProposta),
    dataEncerramento: parsePncpDateTime(c.dataEncerramentoProposta),
    linkSistemaOrigem: str(c.linkSistemaOrigem),
    linkProcessoEletronico: str(c.linkProcessoEletronico),
    updatedAtPncp: parsePncpDateTime(c.dataAtualizacaoGlobal ?? c.dataAtualizacao),
    raw: c,
  };
}

function mapItem(i: Json): NoticeItem {
  return {
    numeroItem: i.numeroItem,
    descricao: i.descricao ?? "",
    quantidade: num(i.quantidade),
    unidade: str(i.unidadeMedida),
    valorUnitario: num(i.valorUnitarioEstimado),
    valorTotal: num(i.valorTotal),
  };
}

function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : null;
}

export class PncpHttpGateway implements PncpGateway {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minGapMs: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private last = 0;

  constructor(options: PncpOptions = {}) {
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minGapMs = options.minGapMs ?? 200;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 3;
  }

  /** GET with polite gap, timeout and exponential backoff on 429/5xx/network errors. */
  private async request(url: string, accept = "application/json"): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      if (attempt > 0) await this.sleep(1000 * 2 ** (attempt - 1));
      const wait = this.last + this.minGapMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();
      try {
        const res = await this.fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: accept },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new PncpHttpError(res.status, url);
          continue;
        }
        if (!res.ok && res.status !== 204) throw new PncpHttpError(res.status, url);
        return res;
      } catch (error) {
        if (error instanceof PncpHttpError && error.status < 500 && error.status !== 429) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  private async json(url: string): Promise<Json | null> {
    const res = await this.request(url);
    if (res.status === 204) return null;
    const text = await res.text();
    return text.trim() ? JSON.parse(text) : null;
  }

  private async page<T>(url: string, page: number, map: (x: Json) => T): Promise<Page<T>> {
    const body = await this.json(url);
    if (!body || !Array.isArray(body.data)) return { data: [], totalPages: page > 1 ? page - 1 : 1, page };
    return { data: body.data.map(map), totalPages: body.totalPaginas ?? 1, page: body.numeroPagina ?? page };
  }

  listOpenNotices(p: { dataFinal: string; page: number; pageSize: number; modalidadeId?: number }) {
    const q = new URLSearchParams({ dataFinal: p.dataFinal, pagina: String(p.page), tamanhoPagina: String(p.pageSize) });
    if (p.modalidadeId) q.set("codigoModalidadeContratacao", String(p.modalidadeId));
    return this.page(`${CONSULTA}/contratacoes/proposta?${q}`, p.page, mapCompra);
  }

  listUpdatedNotices(p: { dataInicial: string; dataFinal: string; modalidadeId: number; page: number }) {
    const q = new URLSearchParams({
      dataInicial: p.dataInicial,
      dataFinal: p.dataFinal,
      codigoModalidadeContratacao: String(p.modalidadeId),
      pagina: String(p.page),
      tamanhoPagina: "50",
    });
    return this.page(`${CONSULTA}/contratacoes/atualizacao?${q}`, p.page, mapCompra);
  }

  private async rawItems(ref: CompraRef): Promise<Json[]> {
    const all: Json[] = [];
    for (let page = 1; ; page++) {
      const body = await this.json(
        `${PNCP}/orgaos/${ref.orgaoCnpj}/compras/${ref.ano}/${ref.sequencial}/itens?pagina=${page}&tamanhoPagina=${ITEMS_PAGE_SIZE}`,
      );
      const rows: Json[] = Array.isArray(body) ? body : [];
      all.push(...rows);
      if (rows.length < ITEMS_PAGE_SIZE) return all;
    }
  }

  async getItems(ref: CompraRef): Promise<NoticeItem[]> {
    return (await this.rawItems(ref)).map(mapItem);
  }

  async getFiles(ref: CompraRef): Promise<PncpFile[]> {
    const body = await this.json(`${PNCP}/orgaos/${ref.orgaoCnpj}/compras/${ref.ano}/${ref.sequencial}/arquivos`);
    const rows: Json[] = Array.isArray(body) ? body : [];
    return rows
      .filter((f) => f.statusAtivo !== false)
      .map((f) => ({
        sequencialDocumento: f.sequencialDocumento,
        titulo: f.titulo ?? `Documento ${f.sequencialDocumento}`,
        tipo: str(f.tipoDocumentoNome),
        url: f.url ?? f.uri,
      }))
      .filter((f) => !!f.url);
  }

  async download(url: string) {
    const res = await this.request(url, "*/*");
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      fileName: fileNameFrom(res.headers.get("content-disposition")),
    };
  }

  async listContractItems(p: { dataInicial: string; dataFinal: string; page: number }): Promise<Page<ContractItemUpsert>> {
    const q = new URLSearchParams({ dataInicial: p.dataInicial, dataFinal: p.dataFinal, pagina: String(p.page), tamanhoPagina: "50" });
    const contracts = await this.page(`${CONSULTA}/contratos?${q}`, p.page, (c: Json) => c);
    const data: ContractItemUpsert[] = [];
    for (const c of contracts.data) {
      const controle: string | undefined = c.numeroControlePncpCompra;
      const base = {
        numeroControlePNCP: controle ?? c.numeroControlePNCP ?? "",
        orgaoCnpj: c.orgaoEntidade?.cnpj ?? "",
        orgaoNome: str(c.orgaoEntidade?.razaoSocial),
        dataAssinatura: parsePncpDateTime(c.dataAssinatura),
        uf: str(c.unidadeOrgao?.ufSigla),
      };
      try {
        if (!controle) throw new Error("no compra");
        const items = await this.rawItems(compraRefFromControle(controle));
        for (const i of items) {
          const price = num(i.valorUnitarioHomologado) ?? num(i.valorUnitarioEstimado);
          if (!price || price <= 0) continue;
          data.push({ ...base, numeroItem: i.numeroItem, descricao: i.descricao ?? "", unidade: str(i.unidadeMedida), quantidade: num(i.quantidade), valorUnitario: price });
        }
      } catch {
        const valor = num(c.valorGlobal);
        if (valor && valor > 0 && c.objetoContrato) {
          data.push({ ...base, numeroItem: 1, descricao: c.objetoContrato, unidade: null, quantidade: 1, valorUnitario: valor });
        }
      }
    }
    return { data, totalPages: contracts.totalPages, page: contracts.page };
  }
}
