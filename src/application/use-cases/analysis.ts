import { applyCitationChecks } from "@/domain/analysis/citations";
import type { NoticeExtraction } from "@/domain/analysis/extraction";
import { computeGaps, documentReadiness } from "@/domain/analysis/gaps";
import { computeFitScore, recommend } from "@/domain/analysis/score";
import { daysBetween } from "@/domain/shared/dates";
import { NotFoundError } from "@/domain/shared/errors";
import type { Analysis, Deps, PageText } from "../ports";
import { consumeQuota, loadOrg, releaseQuota, type Actor } from "./context";
import { notifyOrganization } from "./notifications";

/** Max characters of edital text sent to the model in one extraction. */
const MAX_PROMPT_CHARS = 600_000;

function noticeVersion(updatedAtPncp: Date | null): string {
  return updatedAtPncp?.toISOString() ?? "unknown";
}

/**
 * Requests an analysis for (org, notice). Reuses the existing one for the same
 * notice version (cache per notice version), otherwise consumes plan quota.
 */
export async function requestAnalysis(
  deps: Pick<Deps, "analyses" | "notices" | "organizations" | "usage" | "clock" | "jobs">,
  organizationId: string,
  noticeId: string,
  options: { force?: boolean } = {},
): Promise<Analysis> {
  const notice = await deps.notices.findById(noticeId);
  if (!notice) throw new NotFoundError("Notice", noticeId);
  const version = noticeVersion(notice.updatedAtPncp);
  const latest = await deps.analyses.findLatest(organizationId, noticeId);
  if (latest && latest.noticeVersion === version && latest.status !== "failed" && !options.force) return latest;

  await consumeQuota(deps, organizationId, "analyses");
  const filesReady =
    notice.filesIngestedAt !== null &&
    (notice.updatedAtPncp === null || notice.filesIngestedAt.getTime() >= notice.updatedAtPncp.getTime());
  const analysis = await deps.analyses.create({
    organizationId,
    noticeId,
    status: filesReady ? "queued" : "ingesting",
    noticeVersion: version,
  });
  if (filesReady) await deps.jobs.enqueue("analysis.run", { analysisId: analysis.id });
  else await deps.jobs.enqueue("notice.ingest-files", { noticeId, analysisId: analysis.id });
  return analysis;
}

export async function requestAnalysisByUser(
  deps: Pick<Deps, "analyses" | "notices" | "organizations" | "usage" | "clock" | "jobs">,
  actor: Actor,
  noticeId: string,
  options: { force?: boolean } = {},
): Promise<Analysis> {
  return requestAnalysis(deps, actor.organizationId, noticeId, options);
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

type RunDeps = Pick<
  Deps,
  | "analyses"
  | "notices"
  | "noticeFiles"
  | "organizations"
  | "documents"
  | "ai"
  | "clock"
  | "matches"
  | "jobs"
  | "usage"
  | "notifications"
  | "memberships"
  | "mailer"
  | "config"
>;

/**
 * Job: extraction → citation validation (one re-extraction for failures) →
 * CNAE classification → gaps → score → recommendation. Then releases matches
 * that were waiting for a minimum score.
 */
export async function runAnalysis(deps: RunDeps, input: { analysisId: string }): Promise<Analysis> {
  const analysis = await deps.analyses.findById(input.analysisId);
  if (!analysis) throw new NotFoundError("Analysis", input.analysisId);
  if (analysis.status === "done") return analysis;
  await deps.analyses.update(analysis.id, { status: "running", error: null });
  try {
    const result = await analyze(deps, analysis);
    await afterAnalysis(deps, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.analyses.update(analysis.id, { status: "failed", error: message.slice(0, 2000) });
    await releaseQuota(deps, analysis.organizationId, "analyses");
    throw error;
  }
}

async function analyze(deps: RunDeps, analysis: Analysis): Promise<Analysis> {
  const notice = await deps.notices.findById(analysis.noticeId);
  if (!notice) throw new NotFoundError("Notice", analysis.noticeId);
  const org = await loadOrg(deps, analysis.organizationId);
  const now = deps.clock.now();

  const pagesByFile = await deps.noticeFiles.loadPages(notice.id);
  const files = await deps.noticeFiles.listByNotice(notice.id);
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

  let extraction = await deps.ai.extractNotice({ pages });
  let report = applyCitationChecks(extraction, pagesByFile);
  if (report.failedPaths.length) {
    const retried = await deps.ai.extractNotice({ pages, retryPaths: report.failedPaths, previous: extraction });
    extraction = mergeRetried(extraction, retried, report.failedPaths);
    report = applyCitationChecks(extraction, pagesByFile); // still failing → stays unverified
  }

  const cnaes = [org.cnaePrincipal, ...org.cnaesSecundarios].filter((c): c is string => !!c);
  const cnae = cnaes.length || org.expertiseText
    ? await deps.ai.classifyCnae({ objeto: notice.objeto, cnaes, expertise: org.expertiseText })
    : null;
  const similarity = (await deps.notices.similarityToOrg(notice.id, org.id)) ?? 0;
  const docs = await deps.documents.listByOrg(org.id);
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

  return deps.analyses.update(analysis.id, {
    status: "done",
    extraction,
    citationReport: report,
    score,
    scoreFactors: factors,
    gaps,
    recommendation,
    recommendationReasons: cnae ? [...reasons, `CNAE: ${cnae.reason}`] : reasons,
    cnaeCompatible: cnae?.compatible ?? null,
    model: deps.ai.modelName,
  });
}

async function afterAnalysis(deps: RunDeps, analysis: Analysis): Promise<void> {
  const pending = await deps.matches.listPendingScore(analysis.organizationId, analysis.noticeId);
  const passed = pending.filter((m) => (analysis.score ?? 0) >= (m.minScore ?? 0));
  const failed = pending.filter((m) => !passed.includes(m));
  if (failed.length) await deps.matches.setStatus(failed.map((m) => m.id), "discarded");
  if (passed.length) {
    await deps.matches.setStatus(passed.map((m) => m.id), "notify");
    const immediate = passed.filter((m) => m.frequency === "immediate").map((m) => m.id);
    if (immediate.length) await deps.jobs.enqueue("notify.send", { matchIds: immediate });
  }
  await notifyOrganization(
    deps,
    analysis.organizationId,
    {
      type: "analysis_ready",
      title: `Análise pronta — score ${analysis.score}`,
      body: analysis.extraction?.objeto.value.slice(0, 200) ?? "",
      link: `/radar/${analysis.noticeId}`,
    },
    ["inapp"],
  );
}
