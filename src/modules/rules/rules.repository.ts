import type { Notice } from "@/domain/notice/notice";
import type { Rule, RuleFilters } from "@/domain/rules/rule";
import type { Db } from "@/infrastructure/db/client";
import { Prisma } from "@/infrastructure/db/generated/client";
import { json } from "@/infrastructure/db/json";
import { NOTICE_SELECT, toNotice } from "@/modules/notices/notices.repository";
import type * as M from "@/infrastructure/db/generated/client";

export interface RuleRepository {
  create(data: Omit<Rule, "id">): Promise<Rule>;
  update(organizationId: string, id: string, patch: Partial<Omit<Rule, "id" | "organizationId">>): Promise<Rule>;
  delete(organizationId: string, id: string): Promise<void>;
  findById(organizationId: string, id: string): Promise<Rule | null>;
  listByOrg(organizationId: string): Promise<Rule[]>;
  countActive(organizationId: string): Promise<number>;
  listActive(): Promise<Rule[]>;
}

export type MatchStatus = "pending_score" | "notify" | "notified" | "discarded";

export interface Match {
  id: string;
  ruleId: string;
  noticeId: string;
  organizationId: string;
  similarity: number | null;
  status: MatchStatus;
  frequency: "immediate" | "daily";
  channels: ("email" | "inapp")[];
  minScore: number | null;
  createdAt: Date;
  notifiedAt: Date | null;
}

export interface MatchRepository {
  /** Returns null when the (rule, notice) pair already matched. */
  createIfAbsent(data: Omit<Match, "id" | "createdAt" | "notifiedAt">): Promise<Match | null>;
  listByIds(ids: string[]): Promise<Match[]>;
  listForDigest(): Promise<Match[]>;
  listPendingScore(organizationId: string, noticeId: string): Promise<Match[]>;
  setStatus(ids: string[], status: MatchStatus, notifiedAt?: Date): Promise<void>;
  listByOrg(organizationId: string, limit: number): Promise<(Match & { notice: Notice; ruleName: string })[]>;
}

// ---------- Prisma ----------

export const toRule = (r: M.Rule): Rule => ({
  id: r.id,
  organizationId: r.organizationId,
  name: r.name,
  filters: r.filters as unknown as RuleFilters,
  semanticThreshold: r.semanticThreshold,
  minScore: r.minScore,
  channels: r.channels as Rule["channels"],
  frequency: r.frequency as Rule["frequency"],
  active: r.active,
});

export const toMatch = (r: M.Match): Match => ({
  id: r.id,
  ruleId: r.ruleId,
  noticeId: r.noticeId,
  organizationId: r.organizationId,
  similarity: r.similarity,
  status: r.status as MatchStatus,
  frequency: r.frequency as Match["frequency"],
  channels: r.channels as Match["channels"],
  minScore: r.minScore,
  createdAt: r.createdAt,
  notifiedAt: r.notifiedAt,
});

export class PrismaRuleRepository implements RuleRepository {
  constructor(private db: Db) {}
  async create(data: Omit<Rule, "id">) {
    return toRule(await this.db.rule.create({ data: { ...data, filters: json(data.filters) } }));
  }
  async update(organizationId: string, id: string, patch: Partial<Omit<Rule, "id" | "organizationId">>) {
    await this.db.rule.updateMany({ where: { id, organizationId }, data: { ...patch, filters: patch.filters ? json(patch.filters) : undefined } });
    return toRule(await this.db.rule.findUniqueOrThrow({ where: { id } }));
  }
  async delete(organizationId: string, id: string) {
    await this.db.rule.deleteMany({ where: { id, organizationId } });
  }
  async findById(organizationId: string, id: string) {
    const r = await this.db.rule.findFirst({ where: { id, organizationId } });
    return r && toRule(r);
  }
  async listByOrg(organizationId: string) {
    return (await this.db.rule.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } })).map(toRule);
  }
  async countActive(organizationId: string) {
    return this.db.rule.count({ where: { organizationId, active: true } });
  }
  async listActive() {
    return (await this.db.rule.findMany({ where: { active: true } })).map(toRule);
  }
}

export class PrismaMatchRepository implements MatchRepository {
  constructor(private db: Db) {}
  async createIfAbsent(data: Omit<Match, "id" | "createdAt" | "notifiedAt">) {
    try {
      return toMatch(await this.db.match.create({ data }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    }
  }
  async listByIds(ids: string[]) {
    return (await this.db.match.findMany({ where: { id: { in: ids } } })).map(toMatch);
  }
  async listForDigest() {
    return (await this.db.match.findMany({ where: { status: "notify", frequency: "daily" } })).map(toMatch);
  }
  async listPendingScore(organizationId: string, noticeId: string) {
    return (await this.db.match.findMany({ where: { organizationId, noticeId, status: "pending_score" } })).map(toMatch);
  }
  async setStatus(ids: string[], status: MatchStatus, notifiedAt?: Date) {
    if (!ids.length) return;
    await this.db.match.updateMany({ where: { id: { in: ids } }, data: { status, ...(notifiedAt ? { notifiedAt } : {}) } });
  }
  async listByOrg(organizationId: string, limit: number) {
    const rows = await this.db.match.findMany({
      where: { organizationId, status: { not: "discarded" } },
      include: { notice: { select: NOTICE_SELECT }, rule: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({ ...toMatch(r), notice: toNotice(r.notice), ruleName: r.rule.name }));
  }
}
