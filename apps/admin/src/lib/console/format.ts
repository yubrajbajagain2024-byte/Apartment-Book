/** Formatting for the Analytics and Business pages (epoch-ms times). Pure: safe on the server and in the browser. */

/** "2026-10-21 14:05:33" (the audit log's monospace stamp, UTC). */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export function percent(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
