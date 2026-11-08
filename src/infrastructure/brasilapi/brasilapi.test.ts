import { describe, expect, it, vi } from "vitest";
import { BrasilApiCompanyLookup } from "./brasilapi";

const body = {
  cnpj: "11222333000181",
  razao_social: "LIMPA BEM COMERCIO LTDA",
  nome_fantasia: "",
  porte: "EMPRESA DE PEQUENO PORTE",
  cnae_fiscal: 4649408,
  cnae_fiscal_descricao: "Comércio atacadista de produtos de higiene",
  cnaes_secundarios: [{ codigo: 0, descricao: "" }, { codigo: 4789005, descricao: "Comércio varejista de produtos saneantes" }],
  descricao_tipo_de_logradouro: "RUA",
  logradouro: "DAS FLORES",
  numero: "100",
  complemento: "",
  bairro: "CENTRO",
  municipio: "VITORIA",
  uf: "ES",
  cep: "29000000",
  qsa: [
    { nome_socio: "JOAO SOCIO", qualificacao_socio: "Sócio" },
    { nome_socio: "MARIA EXEMPLO", qualificacao_socio: "Sócio-Administrador" },
  ],
};

describe("BrasilApiCompanyLookup", () => {
  it("maps company data and caches it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
    let now = 0;
    const lookup = new BrasilApiCompanyLookup({ fetch: fetchMock as unknown as typeof fetch, now: () => now });
    const company = await lookup.findByCnpj("11.222.333/0001-81");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://brasilapi.com.br/api/cnpj/v1/11222333000181");
    expect(company).toEqual({
      cnpj: "11222333000181",
      razaoSocial: "LIMPA BEM COMERCIO LTDA",
      nomeFantasia: null,
      porte: "EPP",
      cnaePrincipal: "4649408 - Comércio atacadista de produtos de higiene",
      cnaesSecundarios: ["4789005 - Comércio varejista de produtos saneantes"],
      endereco: "RUA DAS FLORES, 100, CENTRO, VITORIA/ES, CEP 29000000",
      municipio: "VITORIA",
      uf: "ES",
      representante: "MARIA EXEMPLO",
    });
    await lookup.findByCnpj("11222333000181");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now = 25 * 60 * 60 * 1000;
    await lookup.findByCnpj("11222333000181");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null on 404 and throws on other errors", async () => {
    const notFound = new BrasilApiCompanyLookup({ fetch: (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch });
    expect(await notFound.findByCnpj("11222333000181")).toBeNull();
    const down = new BrasilApiCompanyLookup({ fetch: (async () => new Response("", { status: 500 })) as unknown as typeof fetch });
    await expect(down.findByCnpj("11222333000181")).rejects.toThrow(/500/);
  });
});
