import type { RpcError } from "./http";

/** The one Supabase call the Buzz write API makes: `rpc()` on the service-role client. Tests pass a fake. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

/** One request log line: method + route template + status + duration. Nothing else (no body, no user id). */
export interface RequestLogLine {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

/** What the handlers need from the outside world (route.ts wires the real ones, tests the fakes). */
export interface BuzzServerDeps {
  /** The signed-in caller (website cookie or the app's Bearer token) → their user id, or null. */
  getUserId(request: Request): Promise<string | null>;
  /** The service-role client, or null when `SUPABASE_SERVICE_ROLE_KEY` (or the project URL) is not configured. */
  serviceClient(): RpcClient | null;
  /** One line per request. */
  log(line: RequestLogLine): void;
  /** A fixed operational warning (never user data). */
  warn(message: string): void;
  /** Run work after the response is sent (Next's `after()`); the AI second pass uses it. */
  defer(task: () => Promise<void>): void;
  /** Monotonic ms clock for durations (default `performance.now`). */
  clock?: () => number;
  /** Wall clock (default `Date.now`). */
  now?: () => number;
}
