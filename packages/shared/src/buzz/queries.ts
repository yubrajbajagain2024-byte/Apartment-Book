/**
 * Buzz v2 data access for the website and the app.
 *
 *  - Reads, votes, polls, hides, deletes, reports and the guidelines gate are RPCs to `buzz_v2_*` database functions
 *    (security definer; the Buzz tables themselves stay closed to the API). Every function requires a signed-in caller
 *    and, except the gate ones, an accepted gate: until then they raise `buzz:buzz_gate_required:…`.
 *  - Creating a buzz or a reply goes through the website's write API (`POST /api/buzz`, `POST /api/buzz/:id/replies`),
 *    because the text is moderated there first; the database only accepts those writes from the server.
 *
 * Every call throws a `BuzzError` (see helpers.ts) on failure.
 */
import type { Client } from "../types/models";
import { BUZZ_PAGE } from "./constants";
import { BuzzError, toBuzzError } from "./helpers";
import type {
  Buzz, BuzzFeedMeta, BuzzFeedPage, BuzzFeedSort, BuzzGateState, BuzzPage, BuzzPoll, BuzzPostingStatus, BuzzReply, BuzzReportReason,
  BuzzScope, BuzzThread, BuzzTopWindow, BuzzVoteState, CreateBuzzReplyRequest, CreateBuzzRequest, MyBuzzItem, MyBuzzKind, WithModeration,
} from "./types";

/** The `buzz_v2_*` functions are not in the generated Database types; they all take named args and return JSON. */
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function call<T>(supabase: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const rpc = (supabase.rpc as unknown as Rpc).bind(supabase);
  const { data, error } = await rpc(fn, args);
  if (error) throw toBuzzError(error);
  return data as T;
}

/* ───────────────────────────── gate ───────────────────────────── */

export function getBuzzGate(supabase: Client): Promise<BuzzGateState> {
  return call<BuzzGateState>(supabase, "buzz_v2_gate");
}

/** [I understand] on the gate panel. Pass BUZZ_GUIDELINES_VERSION. */
export function acceptBuzzGate(supabase: Client, version: string): Promise<BuzzGateState> {
  return call<BuzzGateState>(supabase, "buzz_v2_accept_gate", { p_version: version });
}

/* ───────────────────────────── reads ───────────────────────────── */

export interface BuzzFeedQuery {
  scope: BuzzScope;
  sort: BuzzFeedSort;
  /** Top only. */
  window?: BuzzTopWindow;
  /** Search: every word must appear in the title or the body. */
  q?: string | null;
  offset?: number;
  limit?: number;
  /** The `rankAt` of the first page, for the following pages. */
  rankAt?: string | null;
}

export function getBuzzFeed(supabase: Client, q: BuzzFeedQuery): Promise<BuzzFeedPage> {
  return call<BuzzFeedPage>(supabase, "buzz_v2_feed", {
    p_scope: q.scope,
    p_sort: q.sort,
    p_window: q.sort === "top" ? (q.window ?? "day") : "day",
    p_q: q.q?.trim() ? q.q.trim() : null,
    p_limit: q.limit ?? BUZZ_PAGE.feed,
    p_offset: q.offset ?? 0,
    p_rank_at: q.rankAt ?? null,
  });
}

export function getBuzzMeta(supabase: Client, scope: BuzzScope): Promise<BuzzFeedMeta> {
  return call<BuzzFeedMeta>(supabase, "buzz_v2_meta", { p_scope: scope });
}

/**
 * The thread of today's prompt on a feed, made by the first answer (20261108000200_buzz_prompt_threads.sql): answer in
 * it with createBuzzReply. Fails with `prompt_ended` once the day has moved on to the next prompt.
 */
export function getBuzzPromptThread(supabase: Client, promptId: string, scope: BuzzScope): Promise<string> {
  return call<string>(supabase, "buzz_v2_prompt_thread", { p_prompt: promptId, p_scope: scope });
}

export function getBuzzThread(supabase: Client, threadId: string, limit: number = BUZZ_PAGE.replies): Promise<BuzzThread> {
  return call<BuzzThread>(supabase, "buzz_v2_thread", { p_thread: threadId, p_limit: limit });
}

export function getBuzzReplies(supabase: Client, threadId: string, offset: number, limit: number = BUZZ_PAGE.replies): Promise<BuzzPage<BuzzReply>> {
  return call<BuzzPage<BuzzReply>>(supabase, "buzz_v2_replies", { p_thread: threadId, p_offset: offset, p_limit: limit });
}

export function listMyBuzz(supabase: Client, kind: MyBuzzKind, offset = 0, limit: number = BUZZ_PAGE.mine): Promise<BuzzPage<MyBuzzItem>> {
  return call<BuzzPage<MyBuzzItem>>(supabase, "buzz_v2_mine", { p_kind: kind, p_offset: offset, p_limit: limit });
}

/** Private: the sum of the scores of your own buzzes and replies. Never shown to anyone else. */
export async function getBuzzKarma(supabase: Client): Promise<number> {
  return Number(await call<number>(supabase, "buzz_v2_karma"));
}

/** Can the viewer post right now (mute / suspension / unread warning), and when do polls unlock. */
export function getBuzzPostingStatus(supabase: Client): Promise<BuzzPostingStatus> {
  return call<BuzzPostingStatus>(supabase, "buzz_v2_posting_status");
}

/* ───────────────────────────── interactions ───────────────────────────── */

/** 1 up, -1 down, 0 clears (tap again to undo). Works for a buzz or a reply. Your own item → `own_item`. */
export function voteBuzzItem(supabase: Client, id: string, value: -1 | 0 | 1): Promise<BuzzVoteState> {
  return call<BuzzVoteState>(supabase, "buzz_v2_vote", { p_id: id, p_value: value });
}

/** One vote per poll, no changing it. Returns the poll with its results. */
export function voteBuzzPoll(supabase: Client, threadId: string, optionId: string): Promise<BuzzPoll> {
  return call<BuzzPoll>(supabase, "buzz_v2_poll_vote", { p_thread: threadId, p_option: optionId });
}

/** Delete your own buzz or reply (someone else's answers exactly like a missing one: `not_found`). */
export async function deleteBuzzItem(supabase: Client, id: string): Promise<void> {
  await call<null>(supabase, "buzz_v2_delete", { p_id: id });
}

/** Hide (or bring back) a whole thread, for you only. */
export async function hideBuzzThread(supabase: Client, threadId: string, hide = true): Promise<void> {
  await call<null>(supabase, "buzz_v2_hide_thread", { p_thread: threadId, p_hide: hide });
}

/**
 * "Hide this anon in this thread": their replies in THIS thread fold for you. Keyed on thread + author inside the
 * database, so you never learn who they are and it can never link threads together.
 */
export async function hideBuzzAuthor(supabase: Client, itemId: string): Promise<void> {
  await call<null>(supabase, "buzz_v2_hide_author", { p_id: itemId });
}

/** Report a buzz or a reply. The item leaves your feed; the team reviews it without seeing who wrote it. */
export function reportBuzzItem(supabase: Client, id: string, reason: BuzzReportReason, note?: string | null): Promise<{ alreadyReported: boolean }> {
  return call<{ alreadyReported: boolean }>(supabase, "buzz_v2_report", { p_id: id, p_reason: reason, p_note: note?.trim() ? note.trim() : null });
}

/* ───────────────────────────── writes (moderated, through the website) ───────────────────────────── */

export interface BuzzWriteTarget {
  /** The website's origin, e.g. SITE_URL in the app; "" on the website itself (same origin). */
  baseUrl: string;
  /** The app sends its Supabase access token; the website sends its cookie instead. */
  accessToken?: string | null;
  fetch?: typeof fetch;
}

async function post<T>(target: BuzzWriteTarget, path: string, body: unknown): Promise<T> {
  const doFetch = target.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${target.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(target.accessToken ? { Authorization: `Bearer ${target.accessToken}` } : {}) },
      credentials: target.accessToken ? "omit" : "include",
      body: JSON.stringify(body),
    });
  } catch {
    throw new BuzzError("unknown", "Couldn't reach UniBuzz. Check your connection and try again.", 0);
  }
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!res.ok) {
    const err = json?.error;
    throw new BuzzError((err?.code as BuzzError["code"]) ?? "unknown", err?.message ?? "Something went wrong. Try again.", res.status, err?.details ?? null);
  }
  return json as T;
}

/** Post a buzz. 201 → the buzz as its author sees it, plus the moderation notice (held, support resources). */
export function createBuzzPost(target: BuzzWriteTarget, body: CreateBuzzRequest): Promise<WithModeration<Buzz>> {
  return post<WithModeration<Buzz>>(target, "/api/buzz", body);
}

/** Reply in a thread. A locked thread → `locked`. */
export function createBuzzReply(target: BuzzWriteTarget, threadId: string, body: CreateBuzzReplyRequest): Promise<WithModeration<BuzzReply>> {
  return post<WithModeration<BuzzReply>>(target, `/api/buzz/${encodeURIComponent(threadId)}/replies`, body);
}
