import { applyCitationChecks } from "@/domain/analysis/citations";
import type { NoticeExtraction } from "@/domain/analysis/extraction";
import { computeGaps, documentReadiness } from "@/domain/analysis/gaps";
import { computeFitScore, recommend } from "@/domain/analysis/score";
import { daysBetween, usagePeriod } from "@/domain/shared/dates";
import { NotFoundError } from "@/domain/shared/errors";
import type { Analysis, Deps, PageText } from "../shared/ports";
import { consumeQuota, loadOrg, releaseQuota, type Actor } from "../shared/context";
import type { NotificationsService } from "../notifications/notifications.service";

/** Max characters of edital text sent to the model in one extraction. */
const MAX_PROMPT_CHARS = 600_000;

function noticeVersion(updatedAtPncp: Date | null): string {
  return updatedAtPncp?.toISOString() ?? "unknown";
}

function mergeRetried(previous: NoticeExtraction, retried: NoticeExtraction, paths: string[]): NoticeExtraction {
  const merged = structuredClone(previous);
  for (const path of paths) {
    const [head, key] = path.split(".");
    if (head === "dates") {
      const k = key as keyof NoticeExtraction["dates"];
      merged.dates[k] = retried.dates[k];
    } else if (head === "requirements") {
      const r = retried.requirements.find((x) => x.id === merged.requirements[Number(key)]?.id);
      if (r) merged.requirements[Number(key)] = r;
    } else if (head === "declarations") {
      const d = retried.declarations.find((x) => x.id === merged.declarations[Number(key)]?.id);
      if (d) merged.declarations[Number(key)] = d;
    } else {
      const k = head as "objeto" | "meEppExclusive" | "guarantee" | "visitaTecnica" | "samples" | "penalties";
      (merged as unknown as Record<string, unknown>)[k] = retried[k];
    }
  }
  return merged;
}

export class AnalysisService {
  constructor(
    private readonly deps: Deps,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Requests an analysis for (org, notice). Reuses the existing one for the same
   * notice version (cache per notice version), otherwise consumes plan quota.
   */
  async requestAnalysis(organizationId: string, noticeId: string, options: { force?: boolean } = {}): Promise<Analysis> {
    const notice = await this.deps.notices.findById(noticeId);
    if (!notice) throw new NotFoundError("Notice", noticeId);
    const version = noticeVersion(notice.updatedAtPncp);
    const latest = await this.deps.analyses.findLatest(organizationId, noticeId);
    if (latest && latest.noticeVersion === version && latest.status !== "failed" && !options.force) return latest;

    await consumeQuota(this.deps, organizationId, "analyses");
    const filesReady =
      notice.filesIngestedAt !== null &&
      (notice.updatedAtPncp === null || notice.filesIngestedAt.getTime() >= notice.updatedAtPncp.getTime());
    const analysis = await this.deps.analyses.create({
      organizationId,
      noticeId,
      status: filesReady ? "queued" : "ingesting",
      noticeVersion: version,
    });
    if (filesReady) await this.deps.jobs.enqueue("analysis.run", { analysisId: analysis.id });
    else await this.deps.jobs.enqueue("notice.ingest-files", { noticeId, analysisId: analysis.id });
    return analysis;
  }

  async requestAnalysisByUser(actor: Actor, noticeId: string, options: { force?: boolean } = {}): Promise<Analysis> {
    return this.requestAnalysis(actor.organizationId, noticeId, options);
  }

  /**
   * Job: extraction → citation validation (one re-extraction for failures) →
   * CNAE classification → gaps → score → recommendation. Then releases matches
   * that were waiting for a minimum score.
   */
  async runAnalysis(input: { analysisId: string }): Promise<Analysis> {
    const analysis = await this.deps.analyses.findById(input.analysisId);
    if (!analysis) throw new NotFoundError("Analysis", input.analysisId);
    if (analysis.status === "done") return analysis;
    // Job retries run again after a failure; the quota is released once and re-charged on success.
    const retrying = analysis.status === "failed";
    await this.deps.analyses.update(analysis.id, { status: "running", error: null });
    try {
      const result = await this.analyze(analysis);
      if (retrying) await this.deps.usage.tryConsume(analysis.organizationId, "analyses", usagePeriod(this.deps.clock.now()), null);
      await this.afterAnalysis(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.analyses.update(analysis.id, { status: "failed", error: message.slice(0, 2000) });
      if (!retrying) await releaseQuota(this.deps, analysis.organizationId, "analyses");
      throw error;
    }
  }

  private async analyze(analysis: Analysis): Promise<Analysis> {
    const notice = await this.deps.notices.findById(analysis.noticeId);
    if (!notice) throw new NotFoundError("Notice", analysis.noticeId);
    const org = await loadOrg(this.deps, analysis.organizationId);
    const now = this.deps.clock.now();

    const pagesByFile = await this.deps.noticeFiles.loadPages(notice.id);
    const files = await this.deps.noticeFiles.listByNotice(notice.id);
    const pages: PageText[] = [];
    let budget = MAX_PROMPT_CHARS;
    for (const file of files) {
      for (const [i, text] of (pagesByFile.get(file.id) ?? []).entries()) {
        if (budget <= 0) break;
        const slice = text.slice(0, budget);
        budget -= slice.length;
        pages.push({ fileId: file.id, fileName: file.titulo, page: i + 1, text: slice });
      }
    }
    if (!pages.length) {
      // No edital text (no files or non-PDF annexes only): analyze the PNCP metadata.
      const metadataId = "pncp-metadata";
      pagesByFile.set(metadataId, [`${notice.objeto}\n${notice.informacaoComplementar ?? ""}`]);
      pages.push({ fileId: metadataId, fileName: "Dados do PNCP", page: 1, text: pagesByFile.get(metadataId)![0] });
    }

    let extraction = await this.deps.ai.extractNotice({ pages });
    let report = applyCitationChecks(extraction, pagesByFile);
    if (report.failedPaths.length) {
      const retried = await this.deps.ai.extractNotice({ pages, retryPaths: report.failedPaths, previous: extraction });
      extraction = mergeRetried(extraction, retried, report.failedPaths);
      report = applyCitationChecks(extraction, pagesByFile); // still failing → stays unverified
    }

    const cnaes = [org.cnaePrincipal, ...org.cnaesSecundarios].filter((c): c is string => !!c);
    const cnae = cnaes.length || org.expertiseText
      ? await this.deps.ai.classifyCnae({ objeto: notice.objeto, cnaes, expertise: org.expertiseText })
      : null;
    const similarity = (await this.deps.notices.similarityToOrg(notice.id, org.id)) ?? 0;
    const docs = await this.deps.documents.listByOrg(org.id);
    const deadline = notice.dataEncerramento;
    const gaps = computeGaps(extraction.requirements, docs, deadline);
    const { score, factors } = computeFitScore({
      similarity,
      cnaeCompatible: cnae?.compatible ?? null,
      noticeUf: notice.uf,
      orgUfs: org.ufs,
      noticeValue: notice.valorEstimado,
      orgValueMin: org.valueMin,
      orgValueMax: org.valueMax,
      documentReadiness: documentReadiness(gaps),
      deadline,
      now,
    });

    // Deterministic risks complement the LLM's.
    if (deadline && daysBetween(now, deadline) < 3 && deadline > now) {
      extraction.risks.push({ title: "Prazo apertado", detail: "Menos de 3 dias até o encerramento das propostas.", severity: "high", citation: null });
    }
    if (extraction.meEppExclusive.value === true && org.porte === "DEMAIS") {
      extraction.risks.push({ title: "Exclusiva ME/EPP", detail: "A empresa não é ME/EPP e não pode participar.", severity: "high", citation: extraction.meEppExclusive.citation });
    }
    const { recommendation, reasons } = recommend({
      score,
      deadlinePassed: deadline !== null && deadline.getTime() < now.getTime(),
      highRisks: extraction.risks.filter((r) => r.severity === "high").length,
      missingDocs: gaps.filter((g) => g.status === "missing").length,
    });

    return this.deps.analyses.update(analysis.id, {
      status: "done",
      extraction,
      citationReport: report,
      score,
      scoreFactors: factors,
      gaps,
      recommendation,
      recommendationReasons: cnae ? [...reasons, `CNAE: ${cnae.reason}`] : reasons,
      cnaeCompatible: cnae?.compatible ?? null,
      model: this.deps.ai.modelName,
    });
  }

  private async afterAnalysis(analysis: Analysis): Promise<void> {
    const pending = await this.deps.matches.listPendingScore(analysis.organizationId, analysis.noticeId);
    const passed = pending.filter((m) => (analysis.score ?? 0) >= (m.minScore ?? 0));
    const failed = pending.filter((m) => !passed.includes(m));
    if (failed.length) await this.deps.matches.setStatus(failed.map((m) => m.id), "discarded");
    if (passed.length) {
      await this.deps.matches.setStatus(passed.map((m) => m.id), "notify");
      const immediate = passed.filter((m) => m.frequency === "immediate").map((m) => m.id);
      if (immediate.length) await this.deps.jobs.enqueue("notify.send", { matchIds: immediate });
    }
    await this.notifications.notifyOrganization(analysis.organizationId,
      {
        type: "analysis_ready",
        title: `Análise pronta — score ${analysis.score}`,
        body: analysis.extraction?.objeto.value.slice(0, 200) ?? "",
        link: `/radar/${analysis.noticeId}`,
      },
      ["inapp"],
    );
  }

  async findLatestAnalysis(actor: Actor, noticeId: string): Promise<Analysis | null> {
    return this.deps.analyses.findLatest(actor.organizationId, noticeId);
  }
}
