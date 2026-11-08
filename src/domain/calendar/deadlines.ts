import type { NoticeExtraction } from "../analysis/extraction";
import type { Notice } from "../notice/notice";
import { addDays } from "../shared/dates";
import { parsePncpDateTime } from "../shared/dates";
import { DOCUMENT_KIND_LABELS, type VaultDocument } from "../documents/document";

export type CalendarRefType = "bid" | "document";

export interface DeadlineEvent {
  /** Stable key so re-syncs update instead of duplicating. */
  key: string;
  refType: CalendarRefType;
  refId: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
}

const HOUR = 60 * 60 * 1000;

function event(refType: CalendarRefType, refId: string, kind: string, title: string, description: string, at: Date): DeadlineEvent {
  return { key: `${refType}:${refId}:${kind}`, refType, refId, title, description, start: at, end: new Date(at.getTime() + HOUR) };
}

/** Deadlines for a bid: clarification/impugnação, proposal deadline and session. */
export function bidDeadlines(bidId: string, notice: Notice, extraction: NoticeExtraction | null, link: string): DeadlineEvent[] {
  const label = `${notice.orgaoNome} — ${notice.numeroCompra ?? notice.numeroControlePNCP}`;
  const desc = `${notice.objeto}\n\n${link}`;
  const events: DeadlineEvent[] = [];
  const pick = (key: keyof NoticeExtraction["dates"]) => parsePncpDateTime(extraction?.dates[key].value ?? null);

  const esclarecimentos = pick("esclarecimentos");
  if (esclarecimentos) events.push(event("bid", bidId, "esclarecimentos", `Prazo de esclarecimentos: ${label}`, desc, esclarecimentos));
  const impugnacao = pick("impugnacao");
  if (impugnacao) events.push(event("bid", bidId, "impugnacao", `Prazo de impugnação: ${label}`, desc, impugnacao));
  if (notice.dataEncerramento) {
    events.push(event("bid", bidId, "proposta", `Encerramento de propostas: ${label}`, desc, notice.dataEncerramento));
  }
  const sessao = pick("sessao") ?? pick("abertura");
  if (sessao) events.push(event("bid", bidId, "sessao", `Sessão pública: ${label}`, desc, sessao));
  return events;
}

export const EXPIRY_REMINDER_DAYS = 7;

/** Reminder N days before a vault document expires. */
export function documentExpiryEvent(doc: VaultDocument): DeadlineEvent | null {
  if (!doc.validUntil) return null;
  const at = addDays(doc.validUntil, -EXPIRY_REMINDER_DAYS);
  at.setUTCHours(12, 0, 0, 0);
  return event(
    "document",
    doc.id,
    "expiry",
    `Renovar: ${DOCUMENT_KIND_LABELS[doc.kind]}`,
    `${doc.fileName} vence em ${doc.validUntil.toISOString().slice(0, 10)}.`,
    at,
  );
}
