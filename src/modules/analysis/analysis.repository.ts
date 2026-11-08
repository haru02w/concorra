import type { NoticeExtraction } from "@/domain/analysis/extraction";
import type { DocumentGap } from "@/domain/analysis/gaps";
import type { Recommendation, ScoreFactor } from "@/domain/analysis/score";
import type { Db } from "@/infrastructure/db/client";
import { Prisma } from "@/infrastructure/db/generated/client";
import { jsonOrNull } from "@/infrastructure/db/json";
import type * as M from "@/infrastructure/db/generated/client";

export type AnalysisStatus = "queued" | "ingesting" | "running" | "done" | "failed";

export interface Analysis {
  id: string;
  organizationId: string;
  noticeId: string;
  status: AnalysisStatus;
  extraction: NoticeExtraction | null;
  citationReport: { verifiedCount: number; total: number; failedPaths: string[] } | null;
  score: number | null;
  scoreFactors: ScoreFactor[] | null;
  gaps: DocumentGap[] | null;
  recommendation: Recommendation | null;
  recommendationReasons: string[] | null;
  cnaeCompatible: boolean | null;
  model: string | null;
  error: string | null;
  noticeVersion: string | null;
  createdAt: Date;
}

export interface AnalysisRepository {
  create(data: Pick<Analysis, "organizationId" | "noticeId" | "status" | "noticeVersion">): Promise<Analysis>;
  update(id: string, patch: Partial<Omit<Analysis, "id" | "organizationId" | "noticeId" | "createdAt">>): Promise<Analysis>;
  findById(id: string): Promise<Analysis | null>;
  findLatest(organizationId: string, noticeId: string): Promise<Analysis | null>;
  listByOrg(organizationId: string, limit: number): Promise<Analysis[]>;
}

// ---------- Prisma ----------

export const toAnalysis = (r: M.Analysis): Analysis => ({
  id: r.id,
  organizationId: r.organizationId,
  noticeId: r.noticeId,
  status: r.status as AnalysisStatus,
  extraction: r.extraction as unknown as NoticeExtraction | null,
  citationReport: r.citationReport as Analysis["citationReport"],
  score: r.score,
  scoreFactors: r.scoreFactors as unknown as ScoreFactor[] | null,
  gaps: r.gaps as unknown as DocumentGap[] | null,
  recommendation: r.recommendation as Recommendation | null,
  recommendationReasons: r.recommendationReasons as string[] | null,
  cnaeCompatible: r.cnaeCompatible,
  model: r.model,
  error: r.error,
  noticeVersion: r.noticeVersion,
  createdAt: r.createdAt,
});

export class PrismaAnalysisRepository implements AnalysisRepository {
  constructor(private db: Db) {}
  async create(data: Pick<Analysis, "organizationId" | "noticeId" | "status" | "noticeVersion">) {
    return toAnalysis(await this.db.analysis.create({ data }));
  }
  async update(id: string, patch: Partial<Omit<Analysis, "id" | "organizationId" | "noticeId" | "createdAt">>) {
    const data: Prisma.AnalysisUpdateInput = {
      ...patch,
      extraction: patch.extraction === undefined ? undefined : jsonOrNull(patch.extraction),
      citationReport: patch.citationReport === undefined ? undefined : jsonOrNull(patch.citationReport),
      scoreFactors: patch.scoreFactors === undefined ? undefined : jsonOrNull(patch.scoreFactors),
      gaps: patch.gaps === undefined ? undefined : jsonOrNull(patch.gaps),
      recommendationReasons: patch.recommendationReasons === undefined ? undefined : jsonOrNull(patch.recommendationReasons),
    };
    return toAnalysis(await this.db.analysis.update({ where: { id }, data }));
  }
  async findById(id: string) {
    const r = await this.db.analysis.findUnique({ where: { id } });
    return r && toAnalysis(r);
  }
  async findLatest(organizationId: string, noticeId: string) {
    const r = await this.db.analysis.findFirst({ where: { organizationId, noticeId }, orderBy: { createdAt: "desc" } });
    return r && toAnalysis(r);
  }
  async listByOrg(organizationId: string, limit: number) {
    return (await this.db.analysis.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: limit })).map(toAnalysis);
  }
}
