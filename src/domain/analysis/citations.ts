import type { NoticePages } from "../notice/notice";
import { normalizeText, tokenize } from "../shared/text";
import type { Citation, NoticeExtraction } from "./extraction";
import { citedFields } from "./extraction";

const FUZZY_THRESHOLD = 0.85;

/**
 * Deterministic citation check: the excerpt must exist on the cited page
 * (exact after normalization, or ≥85% of its tokens in order within a window).
 * Neighbouring pages are accepted to tolerate page-break off-by-one.
 */
export function verifyCitation(citation: Citation | null, pages: NoticePages): boolean {
  if (!citation || !citation.excerpt.trim()) return false;
  const file = pages.get(citation.fileId);
  if (!file) return false;
  const candidates = [citation.page, citation.page - 1, citation.page + 1]
    .filter((p) => p >= 1 && p <= file.length)
    .map((p) => file[p - 1]);
  const excerpt = normalizeText(citation.excerpt);
  return candidates.some((page) => {
    const text = normalizeText(page);
    return text.includes(excerpt) || fuzzyContains(text, citation.excerpt);
  });
}

function fuzzyContains(pageText: string, excerpt: string): boolean {
  const needle = tokenize(excerpt);
  if (needle.length < 4) return false;
  const hay = tokenize(pageText);
  const windowSize = Math.ceil(needle.length * 1.3);
  for (let start = 0; start <= Math.max(0, hay.length - needle.length); start++) {
    const window = hay.slice(start, start + windowSize);
    let j = 0;
    let hits = 0;
    for (const token of needle) {
      const found = window.indexOf(token, j);
      if (found >= 0) {
        hits++;
        j = found + 1;
      }
    }
    if (hits / needle.length >= FUZZY_THRESHOLD) return true;
  }
  return false;
}

export interface CitationReport {
  failedPaths: string[];
  verifiedCount: number;
  total: number;
}

/** Marks each cited field as verified/unverified in place and reports failures. */
export function applyCitationChecks(extraction: NoticeExtraction, pages: NoticePages): CitationReport {
  const failed: string[] = [];
  let verified = 0;
  const fields = citedFields(extraction).filter((f) => f.hasValue);
  for (const field of fields) {
    const ok = verifyCitation(field.citation, pages);
    setVerified(extraction, field.path, ok);
    if (ok) verified++;
    else failed.push(field.path);
  }
  return { failedPaths: failed, verifiedCount: verified, total: fields.length };
}

function setVerified(extraction: NoticeExtraction, path: string, ok: boolean): void {
  const [head, key] = path.split(".");
  if (head === "dates") extraction.dates[key as keyof NoticeExtraction["dates"]].verified = ok;
  else if (head === "requirements") extraction.requirements[Number(key)].verified = ok;
  else if (head === "declarations") extraction.declarations[Number(key)].verified = ok;
  else (extraction[head as "objeto" | "meEppExclusive" | "guarantee" | "visitaTecnica" | "samples" | "penalties"]).verified = ok;
}
