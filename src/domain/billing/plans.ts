import { LimitExceededError } from "../shared/errors";

export type PlanId = "free" | "pro" | "business";
export type LimitedMetric = "members" | "rules" | "analyses" | "bidPacks";
/** Metrics counted per calendar month; the others are counted live. */
export const MONTHLY_METRICS = ["analyses", "bidPacks"] as const;
export type MonthlyMetric = (typeof MONTHLY_METRICS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  /** `null` = unlimited. */
  limits: Record<LimitedMetric, number | null>;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    limits: { members: 1, rules: 2, analyses: 5, bidPacks: 0 },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 9900,
    limits: { members: 3, rules: 20, analyses: 50, bidPacks: 10 },
  },
  business: {
    id: "business",
    name: "Business",
    priceCents: 29900,
    limits: { members: 10, rules: null, analyses: 200, bidPacks: 50 },
  },
};

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

export function limitFor(planId: PlanId, metric: LimitedMetric): number | null {
  return PLANS[planId].limits[metric];
}

/** Throws when adding `amount` to `current` would exceed the plan limit. */
export function assertWithinLimit(
  planId: PlanId,
  metric: LimitedMetric,
  current: number,
  amount = 1,
): void {
  const limit = limitFor(planId, metric);
  if (limit !== null && current + amount > limit) {
    throw new LimitExceededError(metric, limit);
  }
}

export function formatBrl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
}
