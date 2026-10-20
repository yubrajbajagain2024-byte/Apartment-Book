import "server-only";

import {
  contentBlocked, enqueueSecondPass, flushSecondPass, getSecondPassClassifier, moderateWrite, toAuthorNotice, toModerationRecord,
  type ModerationSurface, type WriteField, type WriteModeration,
} from "@apartment-book/moderation";
import type { Buzz, BuzzReply, WithModeration } from "@apartment-book/shared";
import type { z } from "zod";
import {
  BuzzApiError, errorResponse, fromDbError, GENERIC_MESSAGE, jsonResponse, NOT_FOUND_MESSAGE, SETUP_MESSAGE, toErrorResponse,
} from "./http";
import { createBuzzSchema, createReplySchema, describeIssues, toCreateInput, toReplyInput, UUID_RE } from "./schemas";
import { secondPassSink } from "./second-pass";
import type { BuzzServerDeps, RpcClient } from "./types";
import { effectiveRulePacks, loadWriterContext, moderationContext, pollFailure, postingFailure, type WriterContext } from "./writer-context";

/**
 * The moderated Buzz write API (Buzz v2 contract §5), with every outside dependency injected (`BuzzServerDeps`).
 * `app/api/buzz/route.ts` and `app/api/buzz/[threadId]/replies/route.ts` are thin wrappers around these.
 *
 * Flow (both routes):
 *   caller (cookie or Bearer) → 401 · service-role client → 503 · `ts_writer_context` · posting status → 403 ·
 *   body + zod → 400 · moderate every field · block → `ts_record_blocked` + 422 `content_blocked` ·
 *   else `buzz_v2_create` / `buzz_v2_reply` (status `held` if any field is held, support flag, `p_moderation`) ·
 *   `buzz:`/`ts:` errors → 404 / 403 / 429 / 400 · 201 `{ ...item, moderation: AuthorNotice }` · AI second pass after.
 */

export const CREATE_ROUTE = "/api/buzz";
export const REPLY_ROUTE = "/api/buzz/[threadId]/replies";
/** A Buzz write body is small (≤ 500 + 100 chars of text, 4 photo URLs, a poll); anything bigger is refused unread. */
const MAX_BODY_BYTES = 64 * 1024;

/* ───────────────────────────── plumbing ───────────────────────────── */

async function withRequestLog(deps: BuzzServerDeps, route: string, run: () => Promise<Response>): Promise<Response> {
  const clock = deps.clock ?? (() => performance.now());
  const t0 = clock();
  let res: Response;
  try {
    res = await run();
  } catch (err) {
    res = err instanceof BuzzApiError ? toErrorResponse(err) : errorResponse(500, "unknown", GENERIC_MESSAGE);
  }
  try {
    deps.log({ method: "POST", route, status: res.status, durationMs: clock() - t0 });
  } catch {
    /* logging never breaks a request */
  }
  return res;
}

/** The JSON body, read with a size cap. Refuses non-JSON bodies (a cross-site form post cannot send one). */
async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type.trim())) throw new BuzzApiError(415, "validation_failed", "Send the post as JSON.");
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BuzzApiError(413, "validation_failed", "That request is too large.");
  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new BuzzApiError(413, "validation_failed", "That request is too large.");
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    text = new TextDecoder().decode(all);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BuzzApiError(400, "validation_failed", "Malformed request body.");
  }
}

function parseBody<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const { message, details } = describeIssues(parsed.error);
    throw new BuzzApiError(400, "validation_failed", message, details);
  }
  return parsed.data;
}

/** Signed in, and the service-role client is configured. */
async function authorize(request: Request, deps: BuzzServerDeps): Promise<{ userId: string; db: RpcClient }> {
  const userId = await deps.getUserId(request);
  if (!userId) throw new BuzzApiError(401, "unauthenticated", "Log in to use Buzz.");
  const db = deps.serviceClient();
  if (!db) throw new BuzzApiError(503, "unavailable", SETUP_MESSAGE);
  return { userId, db };
}

async function writerFor(deps: BuzzServerDeps, db: RpcClient, userId: string): Promise<WriterContext> {
  const writer = await loadWriterContext(db, userId);
  const refused = postingFailure(writer.posting);
  if (refused) throw refused;
  if (effectiveRulePacks(writer.enabledRulePacks).unknown.length > 0) deps.warn("ts_writer_context lists rule packs this engine does not ship");
  return writer;
}

/**
 * A blocked write: record it (`ts_record_blocked` — event rows, plus a queue item holding the blocked text when the
 * engine escalates: threats, minors, self-harm methods), then answer 422. Recording never changes the answer.
 */
async function refuseBlocked(deps: BuzzServerDeps, db: RpcClient, userId: string, surface: ModerationSurface, mod: WriteModeration): Promise<never> {
  const record = toModerationRecord(mod);
  try {
    const { error } = await db.rpc("ts_record_blocked", {
      p_author: userId,
      p_surface: surface,
      p_text: mod.fields.map((f) => f.text).join("\n"),
      p_moderation: record,
    });
    if (error) deps.warn(`could not record a blocked write (${surface})`);
  } catch {
    deps.warn(`could not record a blocked write (${surface})`);
  }
  const { message, details } = contentBlocked(mod.merged);
  throw new BuzzApiError(422, "content_blocked", message, details);
}

function asItem<T extends { id: string }>(data: unknown): T {
  const value = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { id?: unknown }).id !== "string") {
    throw new BuzzApiError(500, "unknown", GENERIC_MESSAGE);
  }
  return value as T;
}

/** Optional AI second pass (escalate-only, after the response). A no-op without MODERATION_AI_API_KEY. */
function scheduleSecondPass(
  deps: BuzzServerDeps,
  db: RpcClient,
  mod: WriteModeration,
  target: { entityType: "buzz" | "buzz_reply"; entityId: string; authorId: string; universityId: string | null; surface: ModerationSurface },
): void {
  try {
    if (!getSecondPassClassifier()) return;
    const queued = enqueueSecondPass({
      text: mod.fields.map((f) => f.text).join("\n"),
      firstPass: { action: mod.merged.action, category: mod.merged.category, severity: mod.merged.severity },
      target: { ...target, status: mod.merged.persistStatus ?? "active" },
      sink: secondPassSink(db),
    });
    if (queued) deps.defer(() => flushSecondPass());
  } catch {
    deps.warn("could not schedule the second pass");
  }
}

/* ───────────────────────────── POST /api/buzz ───────────────────────────── */

export function handleCreateBuzz(request: Request, deps: BuzzServerDeps): Promise<Response> {
  return withRequestLog(deps, CREATE_ROUTE, async () => {
    const { userId, db } = await authorize(request, deps);
    const writer = await writerFor(deps, db, userId);
    const body = parseBody(createBuzzSchema, await readJson(request));
    if (body.poll) {
      const tooNew = pollFailure(writer, (deps.now ?? Date.now)());
      if (tooNew) throw tooNew;
    }

    const fields: WriteField[] = [
      ...(body.title ? [{ text: body.title, field: "title" as const }] : []),
      { text: body.text, field: "body" },
      ...(body.poll?.options ?? []).map((text) => ({ text, field: "option" as const, surface: "buzz_poll" as const })),
    ];
    const mod = moderateWrite(fields, moderationContext(writer, "buzz"));
    if (mod.merged.action === "block") return refuseBlocked(deps, db, userId, "buzz", mod);

    const { data, error } = await db.rpc("buzz_v2_create", {
      p_author: userId,
      p_input: toCreateInput(body),
      p_status: mod.merged.persistStatus ?? "active",
      p_support_link: mod.merged.support !== null,
      p_moderation: toModerationRecord(mod),
    });
    if (error) throw fromDbError(error);
    const item = asItem<Buzz>(data);
    scheduleSecondPass(deps, db, mod, { entityType: "buzz", entityId: item.id, authorId: userId, universityId: writer.universityId, surface: "buzz" });
    const out: WithModeration<Buzz> = { ...item, moderation: toAuthorNotice(mod.merged) };
    return jsonResponse(201, out);
  });
}

/* ───────────────────────────── POST /api/buzz/:threadId/replies ───────────────────────────── */

export function handleCreateBuzzReply(request: Request, threadId: string, deps: BuzzServerDeps): Promise<Response> {
  return withRequestLog(deps, REPLY_ROUTE, async () => {
    const { userId, db } = await authorize(request, deps);
    // a thread id that cannot exist answers exactly like a missing thread (404 parity)
    if (!UUID_RE.test(threadId)) throw new BuzzApiError(404, "not_found", NOT_FOUND_MESSAGE);
    const writer = await writerFor(deps, db, userId);
    const body = parseBody(createReplySchema, await readJson(request));

    const mod = moderateWrite([{ text: body.text, field: "body" }], moderationContext(writer, "buzz_reply"));
    if (mod.merged.action === "block") return refuseBlocked(deps, db, userId, "buzz_reply", mod);

    const { data, error } = await db.rpc("buzz_v2_reply", {
      p_author: userId,
      p_thread: threadId,
      p_input: toReplyInput(body),
      p_status: mod.merged.persistStatus ?? "active",
      p_support_link: mod.merged.support !== null,
      p_moderation: toModerationRecord(mod),
    });
    if (error) throw fromDbError(error);
    const item = asItem<BuzzReply>(data);
    scheduleSecondPass(deps, db, mod, {
      entityType: "buzz_reply", entityId: item.id, authorId: userId, universityId: writer.universityId, surface: "buzz_reply",
    });
    const out: WithModeration<BuzzReply> = { ...item, moderation: toAuthorNotice(mod.merged) };
    return jsonResponse(201, out);
  });
}
