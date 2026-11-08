import { addDays } from "../shared/dates";
import { onlyDigits } from "../shared/cnpj";

export const DOCUMENT_KINDS = [
  "cnd_federal",
  "crf_fgts",
  "cndt",
  "cnd_estadual",
  "cnd_municipal",
  "falencia",
  "balanco",
  "contrato_social",
  "atestado",
  "alvara",
  "outro",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  cnd_federal: "CND Federal (Receita/PGFN)",
  crf_fgts: "CRF — FGTS (Caixa)",
  cndt: "CNDT — Débitos Trabalhistas (TST)",
  cnd_estadual: "Certidão Negativa Estadual",
  cnd_municipal: "Certidão Negativa Municipal",
  falencia: "Certidão de Falência e Recuperação Judicial",
  balanco: "Balanço Patrimonial",
  contrato_social: "Contrato Social / Estatuto",
  atestado: "Atestado de Capacidade Técnica",
  alvara: "Alvará / Licença",
  outro: "Outro documento",
};

/** Where the user can issue each certidão (F6.1 deep links). */
export const CERTIDAO_PORTALS: Partial<Record<DocumentKind, string>> = {
  cnd_federal: "https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj",
  crf_fgts: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf",
  cndt: "https://cndt-certidao.tst.jus.br/inicio.faces",
  cnd_estadual: "https://www.gov.br/pt-br/servicos-estaduais",
  cnd_municipal: "https://www.gov.br/pt-br/servicos-municipais",
  falencia: "https://www.cnj.jus.br/poder-judiciario/tribunais/",
};

export type DocumentStatus = "pending" | "valid" | "expiring" | "expired" | "invalid";

export interface VaultDocument {
  id: string;
  organizationId: string;
  kind: DocumentKind;
  fileId: string;
  fileName: string;
  issuer: string | null;
  cnpj: string | null;
  issuedAt: Date | null;
  validUntil: Date | null;
  status: DocumentStatus;
  checks: DocumentCheck[];
}

export interface DocumentCheck {
  key: "cnpj" | "validity" | "kind";
  ok: boolean;
  message: string;
}

export const EXPIRY_WARNING_DAYS = 15;

/** Deterministic validation after AI extraction (F6.1). */
export function validateDocument(input: {
  orgCnpj: string;
  extractedCnpj: string | null;
  validUntil: Date | null;
  kind: DocumentKind;
  extractedKind: DocumentKind | null;
  now: Date;
}): { status: DocumentStatus; checks: DocumentCheck[] } {
  const checks: DocumentCheck[] = [];
  const cnpjOk = !!input.extractedCnpj && onlyDigits(input.extractedCnpj) === onlyDigits(input.orgCnpj);
  checks.push({
    key: "cnpj",
    ok: cnpjOk,
    message: cnpjOk ? "CNPJ confere com a empresa" : `CNPJ do documento (${input.extractedCnpj ?? "não encontrado"}) não confere`,
  });
  if (input.extractedKind) {
    const kindOk = input.extractedKind === input.kind;
    checks.push({
      key: "kind",
      ok: kindOk,
      message: kindOk ? "Tipo confere" : `Documento parece ser ${DOCUMENT_KIND_LABELS[input.extractedKind]}`,
    });
  }
  const validity = validityStatus(input.validUntil, input.now);
  checks.push({
    key: "validity",
    ok: validity !== "expired",
    message:
      input.validUntil === null
        ? "Sem data de validade"
        : validity === "expired"
          ? `Vencido em ${input.validUntil.toISOString().slice(0, 10)}`
          : `Válido até ${input.validUntil.toISOString().slice(0, 10)}`,
  });
  const failed = checks.some((c) => !c.ok && c.key !== "validity");
  return { status: failed ? "invalid" : validity, checks };
}

export function validityStatus(validUntil: Date | null, at: Date): "valid" | "expiring" | "expired" {
  if (!validUntil) return "valid";
  if (validUntil.getTime() < at.getTime()) return "expired";
  if (validUntil.getTime() < addDays(at, EXPIRY_WARNING_DAYS).getTime()) return "expiring";
  return "valid";
}

/** Whether the document is still valid on the given date (e.g. bid session). */
export function coversDate(doc: Pick<VaultDocument, "validUntil" | "status">, date: Date): boolean {
  if (doc.status === "invalid" || doc.status === "pending") return false;
  return doc.validUntil === null || doc.validUntil.getTime() >= date.getTime();
}

export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const UPLOAD_MIME_ALLOWLIST = ["application/pdf", "image/png", "image/jpeg"];
