/**
 * Pure helpers for the staff console's Analytics and Business sections (migration 62): reading money the team types,
 * period-over-period change, Central-time scheduling fields, and the CSV exports (click rates and compact counts are clickRate() in business.ts and
 * compactCount() in format.ts). No I/O: safe on the server, in the browser and in tests.
 */
import { localTimeIn } from "./business-hours";

/**
 * Dollars as typed ("120", "1,250.5", "$99.99") to whole cents, or null when it is not an amount (empty, negative, more
 * than two decimals, or past `maxCents`).
 */
export function parseDollars(input: string | null | undefined, maxCents = 10_000_000): number | null {
  const text = (input ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= maxCents ? cents : null;
}

/** Cents as a dollar amount for a form field: "12" for 1200, "12.50" for 1250, "" for null. */
export function centsToDollarInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return Number.isInteger(cents / 100) ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * The change from the previous period as a ratio (+0.25 = up 25%), or null when the previous period had nothing to
 * compare with.
 */
export function changeRatio(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

/** How much of a paid period has passed at `now`, from 0 to 1 (the share of the payment already delivered). */
export function periodElapsed(startMs: number | null, endMs: number | null, now: number): number | null {
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return Math.min(1, Math.max(0, (now - startMs) / (endMs - startMs)));
}

export type CsvValue = string | number | boolean | null | undefined;

/**
 * Rows as CSV (RFC 4180: comma-separated, CRLF line ends, quotes doubled). A cell that a spreadsheet would run as a
 * formula (starting with =, +, - or @, from a business's name or a reference someone typed) is prefixed with a quote
 * mark, so opening the export never runs it.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const cell = (v: CsvValue): string => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A moment as a date-and-time field's value in a time zone ("2026-11-02T09:00"), or "" when it cannot be told. */
export function zonedInputValue(ms: number, timeZone: string): string {
  const t = localTimeIn(timeZone, new Date(ms));
  if (!t) return "";
  return `${t.date}T${String(Math.floor(t.minutes / 60)).padStart(2, "0")}:${String(t.minutes % 60).padStart(2, "0")}`;
}

/**
 * A date-and-time field's value ("2026-11-02T09:00") read as that time in a time zone, as epoch ms; null when it is not
 * one. The console schedules in Central time whatever the browser's or the server's own zone, so a campaign starts
 * when the team meant. Near a clock change, a time that never happens moves by the hour that was skipped.
 */
export function zonedInputToMs(value: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (!Number.isFinite(naive)) return null;
  // How far the zone's clock is ahead of UTC at a moment.
  const offset = (at: number): number | null => {
    const t = localTimeIn(timeZone, new Date(at));
    if (!t) return null;
    const [y, mo, d] = t.date.split("-").map(Number);
    return Date.UTC(y!, mo! - 1, d!, Math.floor(t.minutes / 60), t.minutes % 60) - at;
  };
  const first = offset(naive);
  if (first === null) return null;
  const guess = naive - first;
  const second = offset(guess);
  if (second === null) return null;
  return second === first ? guess : naive - second;
}
