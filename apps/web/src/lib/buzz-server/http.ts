import "server-only";

/**
 * Responses and error mapping of the Buzz write API (`POST /api/buzz`, `POST /api/buzz/:threadId/replies`).
 *
 * Every failure is `{ error: { code, message, details? } }` — the shape `createBuzzPost` / `createBuzzReply`
 * (`packages/shared/src/buzz/queries.ts`) turn into a `BuzzError`. Codes are `BuzzErrorCode`s. Database functions
 * raise `buzz:<code>:<message>` / `ts:<code>:<message>`; those messages are written for people and pass through. Any
 * other database or server error becomes a generic message: raw Postgres text never reaches a client.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export const NO_STORE: Record<string, string> = { "Cache-Control": "no-store" };

export const GENERIC_MESSAGE = "Something went wrong. Try again.";
export const SETUP_MESSAGE = "Posting to Buzz isn't set up on this server yet.";
export const NOT_FOUND_MESSAGE = "That buzz isn't available.";

/** A failure with its HTTP status (thrown inside the handlers, turned into a response once). */
export class BuzzApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BuzzApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  const body: ApiErrorBody = { error: details === undefined ? { code, message } : { code, message, details } };
  return Response.json(body, { status, headers: NO_STORE });
}

export function toErrorResponse(err: BuzzApiError): Response {
  return errorResponse(err.status, err.code, err.message, err.details);
}

export function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** HTTP status for each error code a Buzz / T&S database function can raise. Unlisted codes are 400. */
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  unauthenticated: 401,
  buzz_gate_required: 403,
  forbidden: 403,
  locked: 403,
  muted: 403,
  suspended: 403,
  banned: 403,
  warning_unacknowledged: 403,
  too_new: 403,
  own_item: 403,
  rate_limited: 429,
  content_blocked: 422,
  unavailable: 503,
};

const FRIENDLY: Record<string, string> = {
  buzz_gate_required: "Accept the Buzz guidelines to continue.",
  not_found: NOT_FOUND_MESSAGE,
  unauthenticated: "Log in to use Buzz.",
  locked: "This thread is locked.",
  rate_limited: "You're doing that a lot. Try again in a little while.",
};

/** What PostgREST / supabase-js hand back on a failed `rpc()`. */
export interface RpcError {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

const PREFIXED = /\b(?:buzz|ts):([a-z_]+):([\s\S]*)$/;

/** A database error → the API error to answer with. */
export function fromDbError(error: RpcError | null | undefined): BuzzApiError {
  const raw = typeof error?.message === "string" ? error.message : "";
  const m = PREFIXED.exec(raw);
  if (m) {
    const code = m[1]!;
    const message = m[2]!.trim() || FRIENDLY[code] || GENERIC_MESSAGE;
    return new BuzzApiError(STATUS_BY_CODE[code] ?? 400, code, message);
  }
  const pgCode = error?.code ?? "";
  // the function is missing (migration not applied yet) or the service role may not call it: a setup problem
  if (pgCode === "PGRST202" || pgCode === "42883" || /could not find the function/i.test(raw)) {
    return new BuzzApiError(503, "unavailable", SETUP_MESSAGE);
  }
  if (pgCode === "42501" || pgCode === "PGRST301" || /permission denied|invalid api key|jwt/i.test(raw)) {
    return new BuzzApiError(503, "unavailable", SETUP_MESSAGE);
  }
  return new BuzzApiError(500, "unknown", GENERIC_MESSAGE);
}
