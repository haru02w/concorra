import type { LimitedMetric, PlanId } from "@/domain/billing/plans";
import type { Db } from "@/infrastructure/db/client";
import type * as M from "@/infrastructure/db/generated/client";

export type SubscriptionStatus = "active" | "pending" | "cancelled";

export interface Subscription {
  organizationId: string;
  planId: PlanId;
  /** Plan being purchased in an open checkout. */
  pendingPlanId: PlanId | null;
  status: SubscriptionStatus;
  customerRef: string | null;
  checkoutRef: string | null;
  subscriptionRef: string | null;
  currentPeriodEnd: Date | null;
}

export interface SubscriptionRepository {
  findByOrg(organizationId: string): Promise<Subscription | null>;
  findByCheckoutRef(ref: string): Promise<Subscription | null>;
  findBySubscriptionRef(ref: string): Promise<Subscription | null>;
  upsert(data: Subscription): Promise<Subscription>;
}

export interface UsageRepository {
  get(organizationId: string, metric: LimitedMetric, period: string): Promise<number>;
  /** Atomically increments unless it would pass `limit` (null = unlimited). Returns false when blocked. */
  tryConsume(organizationId: string, metric: LimitedMetric, period: string, limit: number | null): Promise<boolean>;
  release(organizationId: string, metric: LimitedMetric, period: string): Promise<void>;
}

// ---------- Prisma ----------

export const toSubscription = (r: M.Subscription): Subscription => ({
  organizationId: r.organizationId,
  planId: r.planId as PlanId,
  pendingPlanId: r.pendingPlanId as PlanId | null,
  status: r.status as SubscriptionStatus,
  customerRef: r.customerRef,
  checkoutRef: r.checkoutRef,
  subscriptionRef: r.subscriptionRef,
  currentPeriodEnd: r.currentPeriodEnd,
});

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private db: Db) {}
  async findByOrg(organizationId: string) {
    const r = await this.db.subscription.findUnique({ where: { organizationId } });
    return r && toSubscription(r);
  }
  async findByCheckoutRef(checkoutRef: string) {
    const r = await this.db.subscription.findFirst({ where: { checkoutRef } });
    return r && toSubscription(r);
  }
  async findBySubscriptionRef(subscriptionRef: string) {
    const r = await this.db.subscription.findFirst({ where: { subscriptionRef } });
    return r && toSubscription(r);
  }
  async upsert(data: Subscription) {
    return toSubscription(await this.db.subscription.upsert({ where: { organizationId: data.organizationId }, create: data, update: data }));
  }
}

export class PrismaUsageRepository implements UsageRepository {
  constructor(private db: Db) {}
  async get(organizationId: string, metric: string, period: string) {
    const r = await this.db.usageCounter.findUnique({ where: { organizationId_metric_period: { organizationId, metric, period } } });
    return r?.count ?? 0;
  }
  /** Single statement: increments only while below the limit (no race between check and increment). */
  async tryConsume(organizationId: string, metric: string, period: string, limit: number | null) {
    const max = limit ?? 2_147_483_647;
    if (max <= 0) return false;
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "UsageCounter" (id, "organizationId", metric, period, count)
      VALUES (${crypto.randomUUID()}, ${organizationId}, ${metric}, ${period}, 1)
      ON CONFLICT ("organizationId", metric, period)
      DO UPDATE SET count = "UsageCounter".count + 1 WHERE "UsageCounter".count < ${max}
      RETURNING count`;
    return rows.length > 0;
  }
  async release(organizationId: string, metric: string, period: string) {
    await this.db.usageCounter.updateMany({ where: { organizationId, metric, period, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
  }
}
