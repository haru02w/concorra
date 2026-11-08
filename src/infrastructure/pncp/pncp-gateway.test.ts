import { describe, expect, it, vi } from "vitest";
import { PncpHttpGateway } from "./pncp-gateway";

const compra = {
  valorTotalEstimado: 36712.5,
  orgaoEntidade: { cnpj: "31723570000133", razaoSocial: "MUNICIPIO DE VARGEM ALTA" },
  numeroControlePNCP: "31723570000133-1-000176/2024",
  anoCompra: 2024,
  sequencialCompra: 176,
  numeroCompra: "000005",
  processo: "2024-BW6ZW/2024",
  objetoCompra: "Credenciamento de camarotes",
  informacaoComplementar: "",
  dataAberturaProposta: "2024-11-11T08:00:00",
  dataEncerramentoProposta: "2026-11-11T23:59:00",
  dataPublicacaoPncp: "2024-11-08T13:30:33",
  dataAtualizacaoGlobal: "2025-11-04T16:09:03",
  unidadeOrgao: { ufSigla: "ES", municipioNome: "Vargem Alta", nomeUnidade: "Prefeitura", codigoIbge: "3205036" },
  linkSistemaOrigem: "",
  linkProcessoEletronico: null,
  modalidadeId: 12,
  modalidadeNome: "Credenciamento",
  modoDisputaNome: "Não se aplica",
  situacaoCompraNome: "Divulgada no PNCP",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function gateway(handler: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => handler(String(input)));
  const sleep = vi.fn(async () => undefined);
  return { gw: new PncpHttpGateway({ fetch: fetchMock as unknown as typeof fetch, sleep, minGapMs: 0 }), fetchMock, sleep };
}

describe("PncpHttpGateway", () => {
  it("maps open notices", async () => {
    const { gw, fetchMock } = gateway(() => json({ data: [compra], totalPaginas: 3, numeroPagina: 1 }));
    const page = await gw.listOpenNotices({ dataFinal: "20261231", page: 1, pageSize: 50, modalidadeId: 6 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/consulta/v1/contratacoes/proposta?");
    expect(url).toContain("codigoModalidadeContratacao=6");
    expect(page.totalPages).toBe(3);
    const n = page.data[0];
    expect(n).toMatchObject({ orgaoCnpj: "31723570000133", ano: 2024, sequencial: 176, uf: "ES", municipioIbge: "3205036", linkSistemaOrigem: null, informacaoComplementar: null, valorEstimado: 36712.5 });
    expect(n.dataEncerramento?.toISOString()).toBe("2026-11-12T02:59:00.000Z");
    expect(n.updatedAtPncp?.toISOString()).toBe("2025-11-04T19:09:03.000Z");
  });

  it("treats 204 as an empty page", async () => {
    const { gw } = gateway(() => new Response(null, { status: 204 }));
    const page = await gw.listUpdatedNotices({ dataInicial: "20261101", dataFinal: "20261108", modalidadeId: 6, page: 1 });
    expect(page).toEqual({ data: [], totalPages: 1, page: 1 });
  });

  it("retries 5xx with backoff and fails on 4xx", async () => {
    let calls = 0;
    const { gw, sleep } = gateway(() => (++calls < 3 ? new Response("down", { status: 503 }) : json({ data: [], totalPaginas: 1 })));
    await gw.listOpenNotices({ dataFinal: "20261231", page: 1, pageSize: 50 });
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(sleep).toHaveBeenCalledWith(2000);

    const bad = gateway(() => new Response("bad", { status: 400 }));
    await expect(bad.gw.getFiles({ orgaoCnpj: "1", ano: 2026, sequencial: 1 })).rejects.toThrow(/400/);
    expect(bad.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("paginates items and maps files", async () => {
    const { gw } = gateway((url) => {
      if (url.includes("/itens")) {
        const page = Number(new URL(url).searchParams.get("pagina"));
        const count = page === 1 ? 500 : 2;
        return json(Array.from({ length: count }, (_, i) => ({ numeroItem: (page - 1) * 500 + i + 1, descricao: "Item", quantidade: 2, unidadeMedida: "UN", valorUnitarioEstimado: 1.5, valorTotal: 3 })));
      }
      return json([
        { sequencialDocumento: 1, titulo: "Edital", tipoDocumentoNome: "Edital", url: "https://pncp/1", statusAtivo: true },
        { sequencialDocumento: 2, titulo: "Antigo", url: "https://pncp/2", statusAtivo: false },
        { sequencialDocumento: 3, titulo: "Anexo", uri: "https://pncp/3" },
      ]);
    });
    const items = await gw.getItems({ orgaoCnpj: "1", ano: 2026, sequencial: 1 });
    expect(items).toHaveLength(502);
    expect(items[0]).toEqual({ numeroItem: 1, descricao: "Item", quantidade: 2, unidade: "UN", valorUnitario: 1.5, valorTotal: 3 });
    const files = await gw.getFiles({ orgaoCnpj: "1", ano: 2026, sequencial: 1 });
    expect(files).toEqual([
      { sequencialDocumento: 1, titulo: "Edital", tipo: "Edital", url: "https://pncp/1" },
      { sequencialDocumento: 3, titulo: "Anexo", tipo: null, url: "https://pncp/3" },
    ]);
  });

  it("downloads with content type and filename", async () => {
    const { gw } = gateway(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="edital 1.pdf"' } }),
    );
    expect(await gw.download("https://pncp/1")).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf", fileName: "edital 1.pdf" });
  });

  it("flattens contracts into priced items with a fallback", async () => {
    const { gw } = gateway((url) => {
      if (url.includes("/contratos?")) {
        return json({
          data: [
            { numeroControlePncpCompra: "11111111000111-1-000001/2026", orgaoEntidade: { cnpj: "11111111000111", razaoSocial: "Org A" }, unidadeOrgao: { ufSigla: "SP" }, dataAssinatura: "2026-11-01", objetoContrato: "x", valorGlobal: 10 },
            { numeroControlePncpCompra: "22222222000122-1-000002/2026", orgaoEntidade: { cnpj: "22222222000122", razaoSocial: "Org B" }, dataAssinatura: "2026-11-02", objetoContrato: "Serviço de limpeza", valorGlobal: 5000 },
          ],
          totalPaginas: 1,
        });
      }
      if (url.includes("11111111000111/compras/2026/1/itens")) {
        return json([
          { numeroItem: 1, descricao: "Detergente", quantidade: 10, unidadeMedida: "UN", valorUnitarioEstimado: 3, valorUnitarioHomologado: 2.5 },
          { numeroItem: 2, descricao: "Sem preço", quantidade: 1, valorUnitarioEstimado: 0 },
        ]);
      }
      return new Response("nope", { status: 404 });
    });
    const page = await gw.listContractItems({ dataInicial: "20261101", dataFinal: "20261108", page: 1 });
    expect(page.data).toHaveLength(2);
    expect(page.data[0]).toMatchObject({ numeroControlePNCP: "11111111000111-1-000001/2026", descricao: "Detergente", valorUnitario: 2.5, uf: "SP", orgaoNome: "Org A" });
    expect(page.data[1]).toMatchObject({ descricao: "Serviço de limpeza", quantidade: 1, valorUnitario: 5000, uf: null });
  });
});
