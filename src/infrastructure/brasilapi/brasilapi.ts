import type { CompanyData, CompanyLookup } from "@/modules/shared/ports";
import { parsePorte } from "@/domain/organization/organization";
import { onlyDigits } from "@/domain/shared/cnpj";

const BASE = "https://brasilapi.com.br/api/cnpj/v1";
const TTL_MS = 24 * 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function mapBrasilApiCompany(cnpj: string, b: Json): CompanyData {
  const endereco = [
    [clean(b.descricao_tipo_de_logradouro), clean(b.logradouro)].filter(Boolean).join(" "),
    clean(b.numero),
    clean(b.complemento),
    clean(b.bairro),
    [clean(b.municipio), clean(b.uf)].filter(Boolean).join("/"),
    clean(b.cep) ? `CEP ${clean(b.cep)}` : null,
  ]
    .filter((p) => p)
    .join(", ");
  const qsa: Json[] = Array.isArray(b.qsa) ? b.qsa : [];
  const admin = qsa.find((s) => /administrador/i.test(s.qualificacao_socio ?? "")) ?? qsa[0];
  return {
    cnpj,
    razaoSocial: clean(b.razao_social) ?? "",
    nomeFantasia: clean(b.nome_fantasia),
    porte: parsePorte(b.porte),
    cnaePrincipal: b.cnae_fiscal ? `${b.cnae_fiscal} - ${b.cnae_fiscal_descricao ?? ""}`.trim() : null,
    cnaesSecundarios: (Array.isArray(b.cnaes_secundarios) ? b.cnaes_secundarios : [])
      .filter((c: Json) => c.codigo && c.codigo !== 0)
      .map((c: Json) => `${c.codigo} - ${c.descricao ?? ""}`.trim()),
    endereco: endereco || null,
    municipio: clean(b.municipio),
    uf: clean(b.uf),
    representante: clean(admin?.nome_socio),
  };
}

export class BrasilApiCompanyLookup implements CompanyLookup {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; value: CompanyData | null }>();

  constructor(options: { fetch?: typeof fetch; now?: () => number } = {}) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async findByCnpj(cnpj: string): Promise<CompanyData | null> {
    const digits = onlyDigits(cnpj);
    const cached = this.cache.get(digits);
    if (cached && this.now() - cached.at < TTL_MS) return cached.value;
    const res = await this.fetch(`${BASE}/${digits}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) {
      this.cache.set(digits, { at: this.now(), value: null });
      return null;
    }
    if (!res.ok) throw new Error(`BrasilAPI ${res.status}`);
    const value = mapBrasilApiCompany(digits, await res.json());
    this.cache.set(digits, { at: this.now(), value });
    return value;
  }
}
