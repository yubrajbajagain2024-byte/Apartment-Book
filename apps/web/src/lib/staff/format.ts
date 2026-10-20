/** Formatting for the staff console (epoch-ms times). Pure: safe on the server and in the browser. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "3m", "5h", "2d" (no sign). */
export function shortDuration(ms: number): string {
  const a = Math.abs(ms);
  if (a < HOUR) return `${Math.max(1, Math.round(a / MIN))}m`;
  if (a < 2 * DAY) return `${Math.round(a / HOUR)}h`;
  return `${Math.round(a / DAY)}d`;
}

/** "SLA 4h" / "SLA overdue 2d". */
export function slaText(dueAt: number, now: number): { text: string; overdue: boolean } {
  const left = dueAt - now;
  return left <= 0 ? { text: `SLA overdue ${shortDuration(left)}`, overdue: true } : { text: `SLA ${shortDuration(left)}`, overdue: false };
}

/** "just now", "12m ago", "3h ago", "Sep 30". */
export function ago(ms: number, now: number = Date.now()): string {
  const d = now - ms;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Oct 21, 2026, 14:05 UTC": staff work across time zones, so the console speaks UTC. */
export function dateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

/** "Oct 21, 2026". */
export function day(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "2026-10-21 14:05:33" (the audit log's monospace stamp). */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Minutes as "45m" / "5h" / "—". */
export function minutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v >= 120 ? `${Math.round(v / 60)}h` : `${Math.round(v)}m`;
}

export function percent(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
