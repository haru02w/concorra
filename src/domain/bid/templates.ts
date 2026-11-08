import { formatCnpj } from "../shared/cnpj";

/**
 * Markdown templates. `{{field}}` slots are filled by code (structured data);
 * `{{ai:name}}` slots are filled by the LLM (narrative text only).
 */
export type TemplateContext = {
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  representante: string;
  orgaoNome: string;
  numeroEdital: string;
  processo: string;
  objeto: string;
  cidade: string;
  data: string;
};

const HEADER = `**{{razaoSocial}}**
CNPJ: {{cnpj}}
{{endereco}}

À {{orgaoNome}}
Ref.: Edital nº {{numeroEdital}} — Processo {{processo}}
Objeto: {{objeto}}
`;

const SIGNATURE = `

{{cidade}}, {{data}}.

\\
\\
______________________________________
{{representante}}
Representante legal — {{razaoSocial}}
`;

export function declarationTemplate(title: string): string {
  return `${HEADER}
# ${title.toUpperCase()}

{{ai:body}}
${SIGNATURE}`;
}

export const PROPOSAL_TEMPLATE = `${HEADER}
# PROPOSTA COMERCIAL

{{ai:intro}}

{{items_table}}

**Valor global da proposta:** {{total}}

**Validade da proposta:** {{ai:validity}}

{{ai:conditions}}
${SIGNATURE}`;

export const COVER_LETTER_TEMPLATE = `${HEADER}
# CARTA DE APRESENTAÇÃO

{{ai:body}}
${SIGNATURE}`;

const SLOT = /\{\{(ai:)?([a-z_A-Z]+)\}\}/g;

export function listAiSlots(template: string): string[] {
  return [...template.matchAll(SLOT)].filter((m) => m[1]).map((m) => m[2]);
}

/** Fills slots; throws if any slot is left without a value. */
export function renderTemplate(
  template: string,
  context: TemplateContext & Record<string, string>,
  ai: Record<string, string> = {},
): string {
  const values: Record<string, string> = { ...context, cnpj: formatCnpj(context.cnpj) };
  const missing: string[] = [];
  const out = template.replace(SLOT, (_m, isAi: string | undefined, key: string) => {
    const value = isAi ? ai[key] : values[key];
    if (value === undefined) {
      missing.push(`${isAi ?? ""}${key}`);
      return "";
    }
    return value;
  });
  if (missing.length) throw new Error(`Missing template values: ${missing.join(", ")}`);
  return out;
}

export interface ProposalLine {
  numeroItem: number;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  /** Unit price in cents, set by the user — never auto-filled. */
  unitPriceCents: number | null;
}

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function proposalTable(lines: ProposalLine[]): { table: string; totalCents: number | null } {
  const rows = lines.map((l) => {
    const total = l.unitPriceCents === null ? null : Math.round(l.unitPriceCents * l.quantidade);
    const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");
    return {
      md: `| ${l.numeroItem} | ${cell(l.descricao)} | ${l.unidade ?? "-"} | ${l.quantidade} | ${l.unitPriceCents === null ? "A PREENCHER" : brl(l.unitPriceCents)} | ${total === null ? "A PREENCHER" : brl(total)} |`,
      total,
    };
  });
  const complete = rows.every((r) => r.total !== null);
  const totalCents = complete ? rows.reduce((a, r) => a + (r.total ?? 0), 0) : null;
  const table = [
    "| Item | Descrição | Unid. | Qtd. | Valor unit. | Valor total |",
    "|---:|---|---|---:|---:|---:|",
    ...rows.map((r) => r.md),
  ].join("\n");
  return { table, totalCents };
}

export function formatProposalTotal(totalCents: number | null): string {
  return totalCents === null ? "A PREENCHER" : brl(totalCents);
}
