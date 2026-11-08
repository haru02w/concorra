import { DomainError } from "../shared/errors";

export type BidStatus = "participating" | "skipped" | "ready" | "submitted" | "cancelled";

export interface Bid {
  id: string;
  organizationId: string;
  noticeId: string;
  analysisId: string | null;
  status: BidStatus;
  skipReason: string | null;
  packStatus: PackStatus;
  packSteps: PackStepKey[];
  packError: string | null;
}

export type PackStatus = "idle" | "building" | "done" | "failed";

/** Bid pack is built as small idempotent steps; completed ones are skipped on retry. */
export const PACK_STEPS = ["checklist", "prices", "drafts", "verify", "render", "instructions"] as const;
export type PackStepKey = (typeof PACK_STEPS)[number];

export function nextPackStep(done: PackStepKey[]): PackStepKey | null {
  return PACK_STEPS.find((s) => !done.includes(s)) ?? null;
}

const TRANSITIONS: Record<BidStatus, BidStatus[]> = {
  participating: ["ready", "cancelled", "skipped"],
  ready: ["submitted", "participating", "cancelled"],
  submitted: ["cancelled"],
  skipped: ["participating"],
  cancelled: ["participating"],
};

export function assertTransition(from: BidStatus, to: BidStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new DomainError(`Cannot move bid from ${from} to ${to}`, "invalid_transition");
  }
}

export type GeneratedDocStatus = "draft" | "approved";
export type GeneratedDocKind = "declaration" | "proposal" | "cover_letter" | "annex" | "instructions";

export interface GeneratedDocument {
  id: string;
  bidId: string;
  kind: GeneratedDocKind;
  title: string;
  markdown: string;
  /** LLM-written slot values, kept so code can re-render without calling the LLM. */
  aiSlots: Record<string, string>;
  status: GeneratedDocStatus;
  verification: VerificationIssue[];
  docxFileId: string | null;
  pdfFileId: string | null;
}

export interface VerificationIssue {
  severity: "error" | "warning";
  message: string;
}

/** A bid is ready only when every generated document is approved and has no blocking issue. */
export function canMarkReady(docs: Pick<GeneratedDocument, "status" | "verification">[]): { ok: boolean; reason?: string } {
  if (!docs.length) return { ok: false, reason: "Nenhum documento gerado" };
  if (docs.some((d) => d.status !== "approved")) return { ok: false, reason: "Há documentos não aprovados" };
  if (docs.some((d) => d.verification.some((v) => v.severity === "error")))
    return { ok: false, reason: "Há documentos com erros de verificação" };
  return { ok: true };
}
