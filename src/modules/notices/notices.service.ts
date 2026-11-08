import { MODALIDADES, noticeSearchText } from "@/domain/notice/notice";
import { addDays, toPncpDate } from "@/domain/shared/dates";
import { NotFoundError } from "@/domain/shared/errors";
import { chunkText, maskPersonalData } from "@/domain/shared/text";
import { l2normalize } from "@/domain/shared/vector";
import type { Deps, NoticeSearch, NoticeUpsert } from "../shared/ports";
import type { Actor } from "../shared/context";

/** How far ahead to look for open notices (proposal deadline). */
const OPEN_HORIZON_DAYS = 90;

const PAGE_SIZE = 50;

const PDF = "application/pdf";

const MAX_FILE_BYTES = 40 * 1024 * 1024;

function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export class NoticesService {
  constructor(private readonly deps: Deps) {}

  /**
   * Upserts a notice; when new or changed, refreshes items and embeddings and
   * schedules rule matching. Returns whether it changed.
   */
  async processNotice(data: NoticeUpsert): Promise<boolean> {
    const { notice, changed } = await this.deps.notices.upsert(data);
    if (!changed) return false;
    const items = await this.deps.pncp.getItems(notice).catch(() => []);
    const texts = [noticeSearchText(notice, items), ...items.map((i) => i.descricao)];
    const embeddings = (await this.deps.ai.embed(texts, "document")).map(l2normalize);
    await this.deps.notices.setEmbedding(notice.id, embeddings[0]);
    await this.deps.notices.replaceItems(notice.id, items, embeddings.slice(1));
    await this.deps.jobs.enqueue("rules.match", { noticeId: notice.id }, { singletonKey: `${notice.id}:${data.updatedAtPncp?.toISOString()}` });
    return true;
  }

  /**
   * Job: walks the "proposal open" listing a few pages per run (round-robin cursor),
   * so the whole country is covered over successive runs without long jobs.
   */
  async syncOpenNotices(options: { pagesPerRun: number } = { pagesPerRun: 10 }): Promise<{ processed: number; changed: number; nextPage: number }> {
    let page = Number((await this.deps.kv.get("pncp.open.page")) ?? "1");
    const dataFinal = toPncpDate(addDays(this.deps.clock.now(), OPEN_HORIZON_DAYS));
    let processed = 0;
    let changed = 0;
    for (let i = 0; i < options.pagesPerRun; i++) {
      const result = await this.deps.pncp.listOpenNotices({ dataFinal, page, pageSize: PAGE_SIZE });
      for (const data of result.data) {
        processed++;
        if (await this.processNotice(data)) changed++;
      }
      page = page >= result.totalPages ? 1 : page + 1;
      await this.deps.kv.set("pncp.open.page", String(page));
      if (page === 1) break;
    }
    return { processed, changed, nextPage: page };
  }

  /**
   * Job: pulls notices updated since the last cursor (retificações) for every
   * modalidade. Only notices we already track or that are still open are kept.
   */
  async syncUpdatedNotices(): Promise<{ changed: number }> {
    const now = this.deps.clock.now();
    const since = (await this.deps.kv.get("pncp.updates.since")) ?? toPncpDate(addDays(now, -1));
    const until = toPncpDate(now);
    let changed = 0;
    for (const modalidadeId of Object.keys(MODALIDADES).map(Number)) {
      for (let page = 1; ; page++) {
        const result = await this.deps.pncp.listUpdatedNotices({ dataInicial: since, dataFinal: until, modalidadeId, page });
        for (const data of result.data) {
          const tracked = await this.deps.notices.findByControle(data.numeroControlePNCP);
          const open = data.dataEncerramento !== null && data.dataEncerramento.getTime() > now.getTime();
          if (!tracked && !open) continue;
          if (await this.processNotice(data)) changed++;
        }
        if (page >= result.totalPages) break;
      }
    }
    await this.deps.kv.set("pncp.updates.since", until);
    return { changed };
  }

  /** Job: ingests signed contracts' items as price references. */
  async syncContracts(options: { maxPages: number } = { maxPages: 20 }): Promise<{ stored: number }> {
    const now = this.deps.clock.now();
    const since = (await this.deps.kv.get("pncp.contracts.since")) ?? toPncpDate(addDays(now, -7));
    const until = toPncpDate(now);
    let stored = 0;
    for (let page = 1; page <= options.maxPages; page++) {
      const result = await this.deps.pncp.listContractItems({ dataInicial: since, dataFinal: until, page });
      if (result.data.length) {
        const embeddings = (await this.deps.ai.embed(result.data.map((i) => i.descricao), "document")).map(l2normalize);
        stored += await this.deps.contractItems.upsertMany(result.data, embeddings);
      }
      if (page >= result.totalPages) break;
    }
    await this.deps.kv.set("pncp.contracts.since", until);
    return { stored };
  }

  /**
   * Job: lazily downloads edital files, extracts text per page (OCR when scanned),
   * chunks and embeds. Continues to the analysis when one is waiting.
   */
  async ingestNoticeFiles(input: { noticeId: string; analysisId?: string }): Promise<{ files: number }> {
    const notice = await this.deps.notices.findById(input.noticeId);
    if (!notice) throw new NotFoundError("Notice", input.noticeId);
    const fresh =
      notice.filesIngestedAt !== null &&
      (notice.updatedAtPncp === null || notice.filesIngestedAt.getTime() >= notice.updatedAtPncp.getTime());
    let count = 0;
    if (!fresh) {
      const listed = await this.deps.pncp.getFiles(notice);
      const files = await this.deps.noticeFiles.upsertMany(notice.id, listed);
      for (const file of files) {
        const download = await this.deps.pncp.download(file.url);
        if (download.bytes.byteLength > MAX_FILE_BYTES) continue;
        const isPdf = download.contentType.includes("pdf") || hasPdfMagic(download.bytes);
        if (!isPdf) continue; // zip/doc annexes are listed with links only
        const key = `notices/${notice.id}/${file.sequencialDocumento}.pdf`;
        await this.deps.storage.put(key, download.bytes, PDF);
        let pages = await this.deps.pdfText.extractPages(download.bytes);
        let ocr = false;
        if (pages.join("").replace(/\s/g, "").length < 10 * Math.max(1, pages.length)) {
          pages = await this.deps.ai.ocr({ bytes: download.bytes, mediaType: PDF });
          ocr = true;
        }
        // Demo mode (Hack Brasil 6.9): never show real people's names/CPFs from editais.
        if (this.deps.config.demoMode) pages = pages.map(maskPersonalData);
        await this.deps.noticeFiles.savePages(file.id, pages);
        const chunks = pages.flatMap((text, i) => chunkText(text).map((chunk) => ({ page: i + 1, text: chunk })));
        if (chunks.length) {
          const embeddings = (await this.deps.ai.embed(chunks.map((c) => c.text), "document")).map(l2normalize);
          await this.deps.noticeFiles.saveChunks(file.id, chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })));
        }
        await this.deps.noticeFiles.update(file.id, { storageKey: key, pageCount: pages.length, ocr });
        count++;
      }
      await this.deps.notices.markFilesIngested(notice.id, this.deps.clock.now());
    }
    if (input.analysisId) {
      await this.deps.analyses.update(input.analysisId, { status: "queued" });
      await this.deps.jobs.enqueue("analysis.run", { analysisId: input.analysisId });
    }
    return { files: count };
  }

  async searchNotices(actor: Actor, params: Omit<NoticeSearch, "rankForOrganizationId">) {
    return this.deps.notices.search({ ...params, rankForOrganizationId: actor.organizationId });
  }

  /** Opening a notice triggers lazy file ingestion (F2). */
  async openNotice(_actor: Actor, noticeId: string) {
    const notice = await this.deps.notices.findById(noticeId);
    if (!notice) throw new NotFoundError("Notice", noticeId);
    const [items, files] = await Promise.all([this.deps.notices.listItems(noticeId), this.deps.noticeFiles.listByNotice(noticeId)]);
    if (!notice.filesIngestedAt) {
      await this.deps.jobs.enqueue("notice.ingest-files", { noticeId }, { singletonKey: noticeId });
    }
    return { notice, items, files };
  }
}
