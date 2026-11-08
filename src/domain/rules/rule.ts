import type { Notice, NoticeItem } from "../notice/notice";
import { noticeSearchText } from "../notice/notice";
import { normalizeText } from "../shared/text";
import { ValidationError } from "../shared/errors";

export type Channel = "email" | "inapp";
export type Frequency = "immediate" | "daily";

export interface RuleFilters {
  keywordsInclude: string[];
  keywordsExclude: string[];
  ufs: string[];
  municipiosIbge: string[];
  modalidadeIds: number[];
  orgaoCnpjs: string[];
  valueMin: number | null;
  valueMax: number | null;
}

export interface Rule {
  id: string;
  organizationId: string;
  name: string;
  filters: RuleFilters;
  /** Cosine similarity threshold (0–1) between notice and company profile; null disables. */
  semanticThreshold: number | null;
  /** Minimum AI fit score (0–100) required before notifying; null disables. */
  minScore: number | null;
  channels: Channel[];
  frequency: Frequency;
  active: boolean;
}

export const EMPTY_FILTERS: RuleFilters = {
  keywordsInclude: [],
  keywordsExclude: [],
  ufs: [],
  municipiosIbge: [],
  modalidadeIds: [],
  orgaoCnpjs: [],
  valueMin: null,
  valueMax: null,
};

export function validateRule(rule: Pick<Rule, "name" | "filters" | "semanticThreshold" | "minScore" | "channels">): void {
  if (!rule.name.trim()) throw new ValidationError("Rule name is required");
  if (rule.channels.length === 0) throw new ValidationError("Pick at least one channel");
  const { valueMin, valueMax } = rule.filters;
  if (valueMin !== null && valueMax !== null && valueMin > valueMax) {
    throw new ValidationError("valueMin must be ≤ valueMax");
  }
  if (rule.semanticThreshold !== null && (rule.semanticThreshold < 0 || rule.semanticThreshold > 1)) {
    throw new ValidationError("semanticThreshold must be between 0 and 1");
  }
  if (rule.minScore !== null && (rule.minScore < 0 || rule.minScore > 100)) {
    throw new ValidationError("minScore must be between 0 and 100");
  }
  const hasCriteria =
    rule.filters.keywordsInclude.length > 0 ||
    rule.filters.ufs.length > 0 ||
    rule.filters.municipiosIbge.length > 0 ||
    rule.filters.modalidadeIds.length > 0 ||
    rule.filters.orgaoCnpjs.length > 0 ||
    rule.filters.valueMin !== null ||
    rule.filters.valueMax !== null ||
    rule.semanticThreshold !== null;
  if (!hasCriteria) throw new ValidationError("A rule needs at least one filter");
}

function containsTerm(haystack: string, term: string): boolean {
  const needle = normalizeText(term);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

export interface RuleEvaluation {
  matched: boolean;
  reasons: string[];
  /** True when the rule passes filters but still waits for the AI score. */
  needsScore: boolean;
}

/**
 * Deterministic part of rule matching. `similarity` is the cosine similarity
 * between the notice and the organization profile (null when unknown).
 */
export function evaluateRule(
  rule: Rule,
  notice: Notice,
  items: NoticeItem[],
  similarity: number | null,
): RuleEvaluation {
  const reasons: string[] = [];
  const fail = (reason: string): RuleEvaluation => ({ matched: false, reasons: [reason], needsScore: false });
  const f = rule.filters;
  if (!rule.active) return fail("inactive");

  if (f.ufs.length && (!notice.uf || !f.ufs.includes(notice.uf))) return fail("uf");
  if (f.municipiosIbge.length && (!notice.municipioIbge || !f.municipiosIbge.includes(notice.municipioIbge)))
    return fail("municipio");
  if (f.modalidadeIds.length && !f.modalidadeIds.includes(notice.modalidadeId)) return fail("modalidade");
  if (f.orgaoCnpjs.length && !f.orgaoCnpjs.includes(notice.orgaoCnpj)) return fail("orgao");
  if (f.valueMin !== null || f.valueMax !== null) {
    if (notice.valorEstimado === null) return fail("value-unknown");
    if (f.valueMin !== null && notice.valorEstimado < f.valueMin) return fail("value-min");
    if (f.valueMax !== null && notice.valorEstimado > f.valueMax) return fail("value-max");
  }

  const text = normalizeText(noticeSearchText(notice, items));
  if (f.keywordsExclude.some((k) => containsTerm(text, k))) return fail("excluded-keyword");
  if (f.keywordsInclude.length) {
    const hits = f.keywordsInclude.filter((k) => containsTerm(text, k));
    if (!hits.length) return fail("keywords");
    reasons.push(`keywords: ${hits.join(", ")}`);
  }

  if (rule.semanticThreshold !== null) {
    if (similarity === null || similarity < rule.semanticThreshold) return fail("similarity");
    reasons.push(`similarity ${similarity.toFixed(2)}`);
  }

  return { matched: true, reasons, needsScore: rule.minScore !== null };
}
