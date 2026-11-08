import { assertWithinLimit } from "@/domain/billing/plans";
import { NotFoundError } from "@/domain/shared/errors";
import { evaluateRule, validateRule, type Rule } from "@/domain/rules/rule";
import { LimitExceededError } from "@/domain/shared/errors";
import type { Deps } from "../shared/ports";
import { loadOrg, type Actor } from "../shared/context";
import type { AnalysisService } from "../analysis/analysis.service";

export type RuleInput = Omit<Rule, "id" | "organizationId">;

export class RulesService {
  constructor(
    private readonly deps: Deps,
    private readonly analysis: AnalysisService,
  ) {}

  async createRule(actor: Actor, input: RuleInput): Promise<Rule> {
    validateRule(input);
    if (input.active) {
      const org = await loadOrg(this.deps, actor.organizationId);
      assertWithinLimit(org.planId, "rules", await this.deps.rules.countActive(org.id));
    }
    return this.deps.rules.create({ ...input, organizationId: actor.organizationId });
  }

  async updateRule(actor: Actor, id: string, input: RuleInput): Promise<Rule> {
    const existing = await this.deps.rules.findById(actor.organizationId, id);
    if (!existing) throw new NotFoundError("Rule", id);
    validateRule(input);
    if (input.active && !existing.active) {
      const org = await loadOrg(this.deps, actor.organizationId);
      assertWithinLimit(org.planId, "rules", await this.deps.rules.countActive(org.id));
    }
    return this.deps.rules.update(actor.organizationId, id, input);
  }

  async deleteRule(actor: Actor, id: string): Promise<void> {
    if (!(await this.deps.rules.findById(actor.organizationId, id))) throw new NotFoundError("Rule", id);
    await this.deps.rules.delete(actor.organizationId, id);
  }

  /**
   * Job (`notice.upserted`/`notice.updated`): evaluates every active rule, creates
   * matches, and kicks off file ingestion + plan-limited auto analysis.
   */
  async matchNotice(input: { noticeId: string }): Promise<{ matched: number }> {
    const notice = await this.deps.notices.findById(input.noticeId);
    if (!notice) throw new NotFoundError("Notice", input.noticeId);
    const items = await this.deps.notices.listItems(notice.id);
    const rules = await this.deps.rules.listActive();
    const similarityCache = new Map<string, number | null>();
    const toNotify: string[] = [];
    const matchedOrgs = new Set<string>();

    for (const rule of rules) {
      if (!similarityCache.has(rule.organizationId)) {
        similarityCache.set(rule.organizationId, await this.deps.notices.similarityToOrg(notice.id, rule.organizationId));
      }
      const similarity = similarityCache.get(rule.organizationId) ?? null;
      const result = evaluateRule(rule, notice, items, similarity);
      if (!result.matched) continue;
      const match = await this.deps.matches.createIfAbsent({
        ruleId: rule.id,
        noticeId: notice.id,
        organizationId: rule.organizationId,
        similarity,
        status: result.needsScore ? "pending_score" : "notify",
        frequency: rule.frequency,
        channels: rule.channels,
        minScore: rule.minScore,
      });
      if (!match) continue;
      matchedOrgs.add(rule.organizationId);
      if (match.status === "notify" && match.frequency === "immediate") toNotify.push(match.id);
    }

    for (const organizationId of matchedOrgs) {
      try {
        await this.analysis.requestAnalysis(organizationId, notice.id);
      } catch (error) {
        if (!(error instanceof LimitExceededError)) throw error;
        // Out of analyses: matches waiting for a score are notified without it.
        const pending = await this.deps.matches.listPendingScore(organizationId, notice.id);
        await this.deps.matches.setStatus(pending.map((m) => m.id), "notify");
        toNotify.push(...pending.filter((m) => m.frequency === "immediate").map((m) => m.id));
        await this.deps.jobs.enqueue("notice.ingest-files", { noticeId: notice.id }, { singletonKey: notice.id });
      }
    }
    if (toNotify.length) await this.deps.jobs.enqueue("notify.send", { matchIds: toNotify });
    return { matched: matchedOrgs.size };
  }

  async listRules(actor: Actor): Promise<Rule[]> {
    return this.deps.rules.listByOrg(actor.organizationId);
  }

  async findRule(actor: Actor, id: string): Promise<Rule | null> {
    return this.deps.rules.findById(actor.organizationId, id);
  }

  async listMatches(actor: Actor, limit: number) {
    return this.deps.matches.listByOrg(actor.organizationId, limit);
  }
}
