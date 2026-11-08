import { formatCnpj, onlyDigits } from "../shared/cnpj";
import { normalizeText } from "../shared/text";
import type { VerificationIssue } from "./bid";

/**
 * Deterministic checks that a generated document references the right
 * edital, órgão and company (F7 verification pass, code half).
 */
export function verifyGeneratedDocument(
  markdown: string,
  expected: { cnpj: string; numeroEdital: string; orgaoNome: string; razaoSocial: string },
): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const text = normalizeText(markdown);
  const digits = onlyDigits(markdown);
  if (!digits.includes(onlyDigits(expected.cnpj)) && !markdown.includes(formatCnpj(expected.cnpj))) {
    issues.push({ severity: "error", message: "CNPJ da empresa ausente ou incorreto" });
  }
  if (!text.includes(normalizeText(expected.numeroEdital))) {
    issues.push({ severity: "error", message: "Número do edital ausente" });
  }
  if (!text.includes(normalizeText(expected.orgaoNome))) {
    issues.push({ severity: "error", message: "Órgão ausente" });
  }
  if (!text.includes(normalizeText(expected.razaoSocial))) {
    issues.push({ severity: "error", message: "Razão social ausente" });
  }
  if (/a preencher/i.test(markdown)) {
    issues.push({ severity: "warning", message: "Há campos marcados como A PREENCHER" });
  }
  // Any other 14-digit CNPJ-looking number is suspicious (wrong company).
  const otherCnpjs = (markdown.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g) ?? []).filter(
    (c) => onlyDigits(c) !== onlyDigits(expected.cnpj),
  );
  if (otherCnpjs.length) {
    issues.push({ severity: "warning", message: `Outro CNPJ citado: ${otherCnpjs.join(", ")}` });
  }
  return issues;
}
