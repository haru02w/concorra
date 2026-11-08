import { daysBetween } from "../shared/dates";

export type ScoreFactorKey = "similarity" | "cnae" | "region" | "value" | "documents" | "deadline";

export interface ScoreFactor {
  key: ScoreFactorKey;
  label: string;
  weight: number;
  /** 0–1 */
  value: number;
  detail: string;
}

export const SCORE_WEIGHTS: Record<ScoreFactorKey, number> = {
  similarity: 0.35,
  cnae: 0.15,
  region: 0.1,
  value: 0.1,
  documents: 0.2,
  deadline: 0.1,
};

export interface ScoreInput {
  /** Cosine similarity between notice and company experience (0–1). */
  similarity: number;
  /** Whether the LLM judged the object compatible with the company's CNAEs. */
  cnaeCompatible: boolean | null;
  noticeUf: string | null;
  orgUfs: string[];
  noticeValue: number | null;
  orgValueMin: number | null;
  orgValueMax: number | null;
  documentReadiness: number;
  deadline: Date | null;
  now: Date;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Raw cosine similarities between short texts rarely exceed ~0.85; rescale 0.4–0.85 → 0–1. */
export function rescaleSimilarity(similarity: number): number {
  return clamp((similarity - 0.4) / 0.45);
}

export function computeFitScore(input: ScoreInput): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  const push = (key: ScoreFactorKey, label: string, value: number, detail: string) =>
    factors.push({ key, label, weight: SCORE_WEIGHTS[key], value: clamp(value), detail });

  push("similarity", "Similaridade com a experiência", rescaleSimilarity(input.similarity), `similaridade ${input.similarity.toFixed(2)}`);

  push(
    "cnae",
    "Compatibilidade de CNAE",
    input.cnaeCompatible === null ? 0.5 : input.cnaeCompatible ? 1 : 0,
    input.cnaeCompatible === null ? "não avaliado" : input.cnaeCompatible ? "compatível" : "incompatível",
  );

  const regionOk = !input.orgUfs.length || (input.noticeUf !== null && input.orgUfs.includes(input.noticeUf));
  push("region", "Região de interesse", regionOk ? 1 : 0, input.noticeUf ?? "UF desconhecida");

  let valueScore = 0.5;
  let valueDetail = "valor não informado";
  if (input.noticeValue !== null) {
    const below = input.orgValueMin !== null && input.noticeValue < input.orgValueMin;
    const above = input.orgValueMax !== null && input.noticeValue > input.orgValueMax;
    valueScore = below || above ? 0 : 1;
    valueDetail = below ? "abaixo da faixa" : above ? "acima da faixa" : "dentro da faixa";
  }
  push("value", "Faixa de valor", valueScore, valueDetail);

  push(
    "documents",
    "Documentação pronta",
    input.documentReadiness,
    `${Math.round(input.documentReadiness * 100)}% dos documentos disponíveis`,
  );

  let deadlineScore = 0.5;
  let deadlineDetail = "prazo desconhecido";
  if (input.deadline) {
    const days = daysBetween(input.now, input.deadline);
    deadlineScore = days < 0 ? 0 : days < 3 ? 0.2 : days < 7 ? 0.6 : 1;
    deadlineDetail = days < 0 ? "prazo encerrado" : `${days} dia(s) até o prazo`;
  }
  push("deadline", "Viabilidade do prazo", deadlineScore, deadlineDetail);

  const score = Math.round(factors.reduce((acc, f) => acc + f.weight * f.value, 0) * 100);
  return { score, factors };
}

export type Recommendation = "participate" | "review" | "skip";

export function recommend(input: {
  score: number;
  deadlinePassed: boolean;
  highRisks: number;
  missingDocs: number;
}): { recommendation: Recommendation; reasons: string[] } {
  const reasons: string[] = [];
  if (input.deadlinePassed) return { recommendation: "skip", reasons: ["Prazo de proposta encerrado"] };
  if (input.score < 40) return { recommendation: "skip", reasons: [`Score baixo (${input.score})`] };
  if (input.highRisks > 0) reasons.push(`${input.highRisks} risco(s) alto(s)`);
  if (input.missingDocs > 0) reasons.push(`${input.missingDocs} documento(s) faltando`);
  if (input.score >= 70 && input.highRisks === 0) {
    return { recommendation: "participate", reasons: [`Score alto (${input.score})`, ...reasons] };
  }
  return { recommendation: "review", reasons: [`Score ${input.score}`, ...reasons] };
}
