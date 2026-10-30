import type { Client } from "@apartment-book/shared";

/**
 * Calling the Analytics and Business functions (migration 59's console_* functions) from CampConnect Admin. They raise
 * 'ts:<code>:<message>' (the codes of migration 41: not_found, forbidden, validation_failed, conflict, mfa_required…);
 * Business v2's own functions, which the Business section reuses, raise plain messages.
 */
export class ConsoleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConsoleError";
    this.code = code;
  }
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; error: string };

export function toConsoleError(e: unknown): ConsoleError {
  if (e instanceof ConsoleError) return e;
  const raw = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : typeof e === "string" ? e : "";
  const m = /(?:ts|buzz):([a-z_]+):([\s\S]*)$/.exec(raw);
  if (m) return new ConsoleError(m[1]!, m[2]!.trim() || "Something went wrong. Try again.");
  if (/permission denied/i.test(raw)) return new ConsoleError("not_found", "Not found");
  // A function or table a migration adds, on a database that does not have it yet.
  if (/Could not find the function|PGRST202|(function|relation) [^ ]+ does not exist/i.test(raw)) return new ConsoleError("not_deployed", "This needs a database migration that is not applied here yet.");
  return new ConsoleError("unknown", raw || "Something went wrong. Try again.");
}

/** The console functions are not in the hand-written Database types: they take named arguments and return JSON. */
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export async function consoleRpc<T>(supabase: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const rpc = (supabase.rpc as unknown as Rpc).bind(supabase);
  const { data, error } = await rpc(fn, args);
  if (error) throw toConsoleError(error);
  return data as T;
}
