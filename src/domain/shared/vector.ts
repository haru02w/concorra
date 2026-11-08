export const EMBEDDING_DIMENSIONS = 768;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Vector length mismatch");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Truncated Gemini embeddings must be re-normalized. */
export function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return norm ? v.map((x) => x / norm) : v;
}

export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
