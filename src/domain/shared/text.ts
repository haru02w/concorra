/** Lowercase, strip accents and collapse whitespace — for matching, never for display. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** Splits text into chunks of roughly `size` characters on paragraph/sentence boundaries. */
export function chunkText(text: string, size = 1500, overlap = 200): string[] {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (cut > size / 2) end = start + cut + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const ROLE_NAME =
  /\b(pregoeir[oa]|agente de contrata[cç][aã]o|presidente da comiss[aã]o|secret[aá]ri[oa]|prefeit[oa]|respons[aá]vel|fiscal do contrato|gestor do contrato)(\s*(?:\([^)]*\))?\s*[:\-–]?\s*)([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}']+){1,5})/giu;

/**
 * Masks personal data found in edital text for demo mode (Hack Brasil 6.9):
 * CPFs and person names that follow a public-agent role.
 */
export function maskPersonalData(text: string): string {
  return text
    .replace(CPF, "***.***.***-**")
    .replace(ROLE_NAME, (_m, role: string, sep: string) => `${role}${sep}[nome omitido]`);
}
