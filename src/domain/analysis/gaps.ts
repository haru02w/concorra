import type { VaultDocument } from "../documents/document";
import { coversDate } from "../documents/document";
import type { Requirement } from "./extraction";

export type GapStatus = "have" | "expiring" | "missing" | "manual";

export interface DocumentGap {
  requirementId: string;
  description: string;
  documentKind: Requirement["documentKind"];
  status: GapStatus;
  documentId: string | null;
  note: string;
}

/**
 * Maps each habilitação requirement to the best vault document.
 * - have: a valid document covers the deadline
 * - expiring: a document exists but expires before the deadline
 * - missing: no usable document
 * - manual: requirement has no document kind (user must check)
 */
export function computeGaps(requirements: Requirement[], docs: VaultDocument[], deadline: Date | null): DocumentGap[] {
  return requirements.map((req) => {
    const base = { requirementId: req.id, description: req.description, documentKind: req.documentKind };
    if (!req.documentKind) return { ...base, status: "manual", documentId: null, note: "Verificar manualmente" };
    const candidates = docs
      .filter((d) => d.kind === req.documentKind && d.status !== "invalid" && d.status !== "pending")
      .sort((a, b) => (b.validUntil?.getTime() ?? Infinity) - (a.validUntil?.getTime() ?? Infinity));
    const best = candidates[0];
    if (!best) return { ...base, status: "missing", documentId: null, note: "Documento não encontrado no cofre" };
    const at = deadline ?? new Date();
    if (coversDate(best, at)) return { ...base, status: "have", documentId: best.id, note: best.fileName };
    return {
      ...base,
      status: "expiring",
      documentId: best.id,
      note: `Vence em ${best.validUntil?.toISOString().slice(0, 10)}, antes do prazo`,
    };
  });
}

/** Share of document-backed requirements already satisfied (0–1). */
export function documentReadiness(gaps: DocumentGap[]): number {
  const relevant = gaps.filter((g) => g.status !== "manual");
  if (!relevant.length) return 1;
  return relevant.filter((g) => g.status === "have").length / relevant.length;
}
