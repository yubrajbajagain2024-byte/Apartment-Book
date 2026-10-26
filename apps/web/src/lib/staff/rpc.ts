import type { Client } from "@apartment-book/shared";

/** A staff function's error: `ts:<code>:<message>` (or `buzz:<code>:<message>`) from the database. */
export class StaffError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StaffError";
    this.code = code;
  }
}

export function toStaffError(e: unknown): StaffError {
  if (e instanceof StaffError) return e;
  const raw = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : typeof e === "string" ? e : "";
  const m = /(?:ts|buzz):([a-z_]+):([\s\S]*)$/.exec(raw);
  if (m) return new StaffError(m[1]!, m[2]!.trim() || "Something went wrong. Try again.");
  if (/permission denied/i.test(raw)) return new StaffError("not_found", "Not found");
  return new StaffError("unknown", raw || "Something went wrong. Try again.");
}

/** The staff functions are not in the generated Database types; they take named args and return JSON. */
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export async function staffRpc<T>(supabase: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const rpc = (supabase.rpc as unknown as Rpc).bind(supabase);
  const { data, error } = await rpc(fn, args);
  if (error) throw toStaffError(error);
  return data as T;
}
