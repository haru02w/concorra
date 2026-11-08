const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** PNCP query format: yyyyMMdd (in America/Sao_Paulo). */
export function toPncpDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts.replaceAll("-", "");
}

/** PNCP returns local Brasília timestamps without offset, e.g. 2026-11-11T23:59:00. */
export function parsePncpDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value);
  const date = new Date(`${value.length === 10 ? `${value}T00:00:00` : value}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Usage period key, e.g. "2026-11". */
export function usagePeriod(date: Date): string {
  return toPncpDate(date).slice(0, 4) + "-" + toPncpDate(date).slice(4, 6);
}
