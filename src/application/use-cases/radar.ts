import { MODALIDADES, noticeSearchText, type Notice } from "@/domain/notice/notice";
import { addDays, toPncpDate } from "@/domain/shared/dates";
import { NotFoundError } from "@/domain/shared/errors";
import { chunkText } from "@/domain/shared/text";
import { l2normalize } from "@/domain/shared/vector";
import type { Deps, NoticeSearch, NoticeUpsert } from "../ports";
import type { Actor } from "./context";

/** How far ahead to look for open notices (proposal deadline). */
const OPEN_HORIZON_DAYS = 90;
const PAGE_SIZE = 50;

type SyncDeps = Pick<Deps, "notices" | "pncp" | "ai" | "jobs" | "clock">;

/**
 * Upserts a notice; when new or changed, refreshes items and embeddings and
 * schedules rule matching. Returns whether it changed.
 */
export async function processNotice(deps: SyncDeps, data: NoticeUpsert): Promise<boolean> {
  const { notice, changed } = await deps.notices.upsert(data);
  if (!changed) return false;
  const items = await deps.pncp.getItems(notice).catch(() => []);
  const texts = [noticeSearchText(notice, items), ...items.map((i) => i.descricao)];
  const embeddings = (await deps.ai.embed(texts, "document")).map(l2normalize);
  await deps.notices.setEmbedding(notice.id, embeddings[0]);
  await deps.notices.replaceItems(notice.id, items, embeddings.slice(1));
  await deps.jobs.enqueue("rules.match", { noticeId: notice.id }, { singletonKey: `${notice.id}:${data.updatedAtPncp?.toISOString()}` });
  return true;
}

/**
 * Job: walks the "proposal open" listing a few pages per run (round-robin cursor),
 * so the whole country is covered over successive runs without long jobs.
 */
export async function syncOpenNotices(
  deps: SyncDeps & Pick<Deps, "kv">,
  options: { pagesPerRun: number } = { pagesPerRun: 10 },
): Promise<{ processed: number; changed: number; nextPage: number }> {
  let page = Number((await deps.kv.get("pncp.open.page")) ?? "1");
  const dataFinal = toPncpDate(addDays(deps.clock.now(), OPEN_HORIZON_DAYS));
  let processed = 0;
  let changed = 0;
  for (let i = 0; i < options.pagesPerRun; i++) {
    const result = await deps.pncp.listOpenNotices({ dataFinal, page, pageSize: PAGE_SIZE });
    for (const data of result.data) {
      processed++;
      if (await processNotice(deps, data)) changed++;
    }
    page = page >= result.totalPages ? 1 : page + 1;
    await deps.kv.set("pncp.open.page", String(page));
    if (page === 1) break;
  }
  return { processed, changed, nextPage: page };
}

/**
 * Job: pulls notices updated since the last cursor (retificações) for every
 * modalidade. Only notices we already track or that are still open are kept.
 */
export async function syncUpdatedNotices(deps: SyncDeps & Pick<Deps, "kv">): Promise<{ changed: number }> {
  const now = deps.clock.now();
  const since = (await deps.kv.get("pncp.updates.since")) ?? toPncpDate(addDays(now, -1));
  const until = toPncpDate(now);
  let changed = 0;
  for (const modalidadeId of Object.keys(MODALIDADES).map(Number)) {
    for (let page = 1; ; page++) {
      const result = await deps.pncp.listUpdatedNotices({ dataInicial: since, dataFinal: until, modalidadeId, page });
      for (const data of result.data) {
        const tracked = await deps.notices.findByControle(data.numeroControlePNCP);
        const open = data.dataEncerramento !== null && data.dataEncerramento.getTime() > now.getTime();
        if (!tracked && !open) continue;
        if (await processNotice(deps, data)) changed++;
      }
      if (page >= result.totalPages) break;
    }
  }
  await deps.kv.set("pncp.updates.since", until);
  return { changed };
}

/** Job: ingests signed contracts' items as price references. */
export async function syncContracts(
  deps: Pick<Deps, "pncp" | "ai" | "contractItems" | "kv" | "clock">,
  options: { maxPages: number } = { maxPages: 20 },
): Promise<{ stored: number }> {
  const now = deps.clock.now();
  const since = (await deps.kv.get("pncp.contracts.since")) ?? toPncpDate(addDays(now, -7));
  const until = toPncpDate(now);
  let stored = 0;
  for (let page = 1; page <= options.maxPages; page++) {
    const result = await deps.pncp.listContractItems({ dataInicial: since, dataFinal: until, page });
    if (result.data.length) {
      const embeddings = (await deps.ai.embed(result.data.map((i) => i.descricao), "document")).map(l2normalize);
      stored += await deps.contractItems.upsertMany(result.data, embeddings);
    }
    if (page >= result.totalPages) break;
  }
  await deps.kv.set("pncp.contracts.since", until);
  return { stored };
}

const PDF = "application/pdf";
const MAX_FILE_BYTES = 40 * 1024 * 1024;

/**
 * Job: lazily downloads edital files, extracts text per page (OCR when scanned),
 * chunks and embeds. Continues to the analysis when one is waiting.
 */
export async function ingestNoticeFiles(
  deps: Pick<Deps, "notices" | "noticeFiles" | "pncp" | "storage" | "pdfText" | "ai" | "jobs" | "clock" | "analyses">,
  input: { noticeId: string; analysisId?: string },
): Promise<{ files: number }> {
  const notice = await deps.notices.findById(input.noticeId);
  if (!notice) throw new NotFoundError("Notice", input.noticeId);
  const fresh =
    notice.filesIngestedAt !== null &&
    (notice.updatedAtPncp === null || notice.filesIngestedAt.getTime() >= notice.updatedAtPncp.getTime());
  let count = 0;
  if (!fresh) {
    const listed = await deps.pncp.getFiles(notice);
    const files = await deps.noticeFiles.upsertMany(notice.id, listed);
    for (const file of files) {
      const download = await deps.pncp.download(file.url);
      if (download.bytes.byteLength > MAX_FILE_BYTES) continue;
      const isPdf = download.contentType.includes("pdf") || hasPdfMagic(download.bytes);
      if (!isPdf) continue; // zip/doc annexes are listed with links only
      const key = `notices/${notice.id}/${file.sequencialDocumento}.pdf`;
      await deps.storage.put(key, download.bytes, PDF);
      let pages = await deps.pdfText.extractPages(download.bytes);
      let ocr = false;
      if (pages.join("").replace(/\s/g, "").length < 10 * Math.max(1, pages.length)) {
        pages = await deps.ai.ocr({ bytes: download.bytes, mediaType: PDF });
        ocr = true;
      }
      await deps.noticeFiles.savePages(file.id, pages);
      const chunks = pages.flatMap((text, i) => chunkText(text).map((chunk) => ({ page: i + 1, text: chunk })));
      if (chunks.length) {
        const embeddings = (await deps.ai.embed(chunks.map((c) => c.text), "document")).map(l2normalize);
        await deps.noticeFiles.saveChunks(file.id, chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })));
      }
      await deps.noticeFiles.update(file.id, { storageKey: key, pageCount: pages.length, ocr });
      count++;
    }
    await deps.notices.markFilesIngested(notice.id, deps.clock.now());
  }
  if (input.analysisId) {
    await deps.analyses.update(input.analysisId, { status: "queued" });
    await deps.jobs.enqueue("analysis.run", { analysisId: input.analysisId });
  }
  return { files: count };
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function searchNotices(deps: Pick<Deps, "notices">, actor: Actor, params: Omit<NoticeSearch, "rankForOrganizationId">) {
  return deps.notices.search({ ...params, rankForOrganizationId: actor.organizationId });
}

/** Opening a notice triggers lazy file ingestion (F2). */
export async function openNotice(deps: Pick<Deps, "notices" | "noticeFiles" | "jobs">, _actor: Actor, noticeId: string) {
  const notice = await deps.notices.findById(noticeId);
  if (!notice) throw new NotFoundError("Notice", noticeId);
  const [items, files] = await Promise.all([deps.notices.listItems(noticeId), deps.noticeFiles.listByNotice(noticeId)]);
  if (!notice.filesIngestedAt) {
    await deps.jobs.enqueue("notice.ingest-files", { noticeId }, { singletonKey: noticeId });
  }
  return { notice, items, files };
}

export function noticeLink(notice: Pick<Notice, "linkSistemaOrigem" | "linkProcessoEletronico" | "orgaoCnpj" | "ano" | "sequencial">): string {
  return (
    notice.linkProcessoEletronico ||
    notice.linkSistemaOrigem ||
    `https://pncp.gov.br/app/editais/${notice.orgaoCnpj}/${notice.ano}/${notice.sequencial}`
  );
}
