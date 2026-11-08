import type { DocumentKind } from "../documents/document";

/** Where a fact was found in the edital. */
export interface Citation {
  fileId: string;
  page: number;
  excerpt: string;
}

export interface Cited<T> {
  value: T;
  citation: Citation | null;
  /** Set by the citation validator. */
  verified?: boolean;
}

export type RequirementCategory = "juridica" | "fiscal_trabalhista" | "economico_financeira" | "tecnica" | "outra";

export interface Requirement {
  id: string;
  category: RequirementCategory;
  description: string;
  /** Vault document kind that satisfies it, when it maps to one. */
  documentKind: DocumentKind | null;
  citation: Citation | null;
  verified?: boolean;
}

export interface DeclarationRequirement {
  id: string;
  title: string;
  description: string;
  citation: Citation | null;
  verified?: boolean;
}

export interface ExtractedDates {
  impugnacao: Cited<string | null>;
  esclarecimentos: Cited<string | null>;
  abertura: Cited<string | null>;
  sessao: Cited<string | null>;
}

export interface NoticeExtraction {
  objeto: Cited<string>;
  lots: { number: string; description: string }[];
  dates: ExtractedDates;
  requirements: Requirement[];
  declarations: DeclarationRequirement[];
  annexModels: { title: string; description: string }[];
  meEppExclusive: Cited<boolean | null>;
  guarantee: Cited<string | null>;
  visitaTecnica: Cited<string | null>;
  samples: Cited<string | null>;
  penalties: Cited<string | null>;
  risks: { title: string; detail: string; severity: "low" | "medium" | "high"; citation: Citation | null }[];
  submissionPortal: string | null;
}

/** Returns every cited field so validators can walk them uniformly. */
export function citedFields(extraction: NoticeExtraction): { path: string; citation: Citation | null; hasValue: boolean }[] {
  const out: { path: string; citation: Citation | null; hasValue: boolean }[] = [];
  const add = (path: string, c: Cited<unknown>) =>
    out.push({ path, citation: c.citation, hasValue: c.value !== null && c.value !== "" });
  add("objeto", extraction.objeto);
  for (const key of Object.keys(extraction.dates) as (keyof ExtractedDates)[]) add(`dates.${key}`, extraction.dates[key]);
  add("meEppExclusive", extraction.meEppExclusive);
  add("guarantee", extraction.guarantee);
  add("visitaTecnica", extraction.visitaTecnica);
  add("samples", extraction.samples);
  add("penalties", extraction.penalties);
  extraction.requirements.forEach((r, i) => out.push({ path: `requirements.${i}`, citation: r.citation, hasValue: true }));
  extraction.declarations.forEach((d, i) => out.push({ path: `declarations.${i}`, citation: d.citation, hasValue: true }));
  return out;
}
