/**
 * Buzz v2 — the anonymous Home tab, ported from UniVerse (its `shared/src/buzz.ts`). Types only.
 *
 * FIREWALL: no field in this file may be named like an identity key
 * (`authorId, author_id, userId, user_id, handle, name, displayName, avatar, avatarUrl, email, profile`).
 * Every Buzz payload is built field by field by ONE serializer in the database (`buzz_root_json` /
 * `buzz_reply_json` in migration `20261103000100_buzz_v2.sql`); the client only ever sees these shapes.
 */

export interface BuzzAlias {
  emoji: string;
  /** "Anon Comet" (+ " 2" on an in-thread collision). */
  label: string;
  /** Hex colour from the server-side alias palette. */
  color: string;
}

export type BuzzScope = "campus" | "global";
/** What a buzz is about, picked by its author (or none). BUZZ_CATEGORIES names them; the database has the same list. */
export type BuzzCategory = "confession" | "question" | "hot_take" | "rant" | "dating" | "classes" | "funny" | "events" | "housing" | "career";
export type BuzzFeedSort = "hot" | "new" | "top";
/** How a thread's replies are ordered among their siblings: the best first (Reddit's default), the newest or the oldest. */
export type BuzzReplySort = "best" | "new" | "old";
export type BuzzTopWindow = "day" | "week" | "all";
export type BuzzPollDuration = 1 | 3 | 7;
/** Canonical status of a Buzz item (same values as the moderation queue uses). */
export type BuzzItemStatus = "active" | "held" | "hidden" | "removed" | "deleted";

/**
 * A photo or a video on a root buzz. Photos sit in the anonymous `buzz/anon/<random>` storage folder (re-encoded on the
 * device, so no camera metadata); a video is a Mux playback id with nothing that points at its uploader.
 */
export type BuzzMedia =
  | { type: "image"; url: string; width: number | null; height: number | null; blur: string | null }
  | { type: "video"; playbackId: string; posterUrl: string | null; width: number | null; height: number | null; durationSeconds: number | null };

export interface BuzzPollOption {
  id: string;
  text: string;
  /** null until `resultsVisible`. */
  votes: number | null;
  /** 0–100, null until `resultsVisible`. */
  pct: number | null;
}

export interface BuzzPoll {
  options: BuzzPollOption[];
  totalVotes: number | null;
  /** Epoch ms, floored to the minute. */
  closesAt: number;
  closed: boolean;
  myChoice: string | null;
  /** Results stay hidden until the viewer has voted, the poll has closed, or it is the viewer's own poll. */
  resultsVisible: boolean;
}

interface BuzzBase {
  id: string;
  /** Root buzz id (a root's own id). */
  threadId: string;
  alias: BuzzAlias;
  isOp: boolean;
  isMine: boolean;
  /** '' when the item is a placeholder (hidden / removed / deleted, for other viewers). */
  text: string;
  score: number;
  myVote: -1 | 0 | 1;
  /** Community collapse (eligible score ≤ −5 with ≥ 8 eligible votes) or "Hide this anon in this thread". */
  collapsed: boolean;
  status: BuzzItemStatus;
  /** The text triggered the self-harm support resources: the item offers a "Support resources" link. */
  supportLink: boolean;
  /** Epoch ms of the (jittered) publication, floored to the minute. Never the real write time. */
  createdAt: number;
}

export interface Buzz extends BuzzBase {
  kind: "buzz";
  /** Optional headline; '' when none (or when the item is a placeholder). */
  title: string;
  /** [] when none (or when the item is a placeholder). */
  media: BuzzMedia[];
  /** The feed this buzz was posted to. Campus and Global are separate: a buzz shows in exactly one. */
  scope: BuzzScope;
  /**
   * The category its author picked; null when none (or when the item is a placeholder). Sent by databases with
   * 20261108000300_buzz_categories.sql; absent before it. Show it with buzzCategory(), which ignores a value this
   * build does not know.
   */
  category?: BuzzCategory | null;
  poll: BuzzPoll | null;
  replyCount: number;
  locked: boolean;
  /** Global buzzes only, and only for campuses large enough to be named; null otherwise. */
  campusShortName: string | null;
  promptId: string | null;
  /**
   * The reply its feed card shows under it, or null when none has earned it. Sent by the feed and Buzz search on
   * databases with 20261108000100_buzz_top_reply.sql; absent before it and everywhere else (a thread, My buzzes).
   */
  topReply?: BuzzTopReply | null;
  /** The thread of a day's prompt (owned by no one, titled with the prompt; its replies are the answers). */
  isPromptThread?: boolean;
  /** An answer posted as its own buzz: that day's prompt thread on its feed, once anyone answered there; else null. */
  promptThreadId?: string | null;
}

/**
 * "Top reply" under a buzz in the feed: its most upvoted reply that anyone may read, with at least
 * BUZZ_TOP_REPLY_MIN_UPVOTES upvotes and more up than down (never one that touched on self-harm). Its alias is the one
 * it has in the thread.
 */
export interface BuzzTopReply {
  id: string;
  alias: BuzzAlias;
  isOp: boolean;
  isMine: boolean;
  text: string;
  score: number;
  /** Floored to the minute, like every Buzz time. */
  createdAt: number;
}

export interface BuzzReply extends BuzzBase {
  kind: "reply";
  /** The depth-1 ancestor for flattened replies (so the client nests them under it); the root id for depth 1. */
  parentId: string;
  depth: 1 | 2;
  /** Set when the reply was deeper than 2 and got flattened: the alias it was replying to. */
  replyingTo: BuzzAlias | null;
  /**
   * The reply this one answers, at any depth (the thread for a direct reply): the nearest one the viewer can see.
   * Sent by databases with 20261108000000_buzz_reply_tree.sql; without it, `parentId` and `depth` give two levels.
   */
  treeParentId?: string;
}

/** A page of a list. `nextOffset` is null at the end. */
export interface BuzzPage<T> {
  items: T[];
  nextOffset: number | null;
}

/** A feed page. Pass `rankAt` back with the next page so Hot ranks every page against the same instant. */
export interface BuzzFeedPage extends BuzzPage<Buzz> {
  rankAt: string;
}

export interface BuzzThread {
  root: Buzz;
  /** First page of replies (oldest first). Further pages: getBuzzReplies(). */
  replies: BuzzPage<BuzzReply>;
  smallCampusNote: boolean;
}

export interface BuzzFeedMeta {
  /**
   * Today's Daily Campus Prompt. With 20261108000200_buzz_prompt_threads.sql it also says which thread is today's on
   * this feed (`threadId`, null until someone answers there) and how many answers it has; both are absent before it.
   */
  prompt: { id: string; text: string; threadId?: string | null; answers?: number } | null;
  /** The viewer's campus is small (fewer than 50 students): details can identify people. */
  smallCampusNote: boolean;
  /** The viewer's campus, for "Search Texas State buzz" and the cold-start banner; null without a university. */
  campus: { name: string; shortName: string } | null;
}

export interface BuzzGateState {
  /** The guidelines version the viewer accepted, null if never. */
  acceptedVersion: string | null;
  currentVersion: string;
  accepted: boolean;
}

/** What the composer may do right now (mirrors the server's checks so the UI never offers a dead button). */
export interface BuzzPostingStatus {
  allowed: boolean;
  /** Muted / suspended until (epoch ms); null when allowed or open-ended. */
  mutedUntil: number | null;
  reason: "muted" | "suspended" | "banned" | "warning" | null;
  /** Unacknowledged warning that must be read before posting again. */
  warningId: string | null;
  /** Polls unlock 24 hours after joining (epoch ms); null once unlocked. */
  pollsUnlockAt: number | null;
}

export interface CreateBuzzRequest {
  /** Body (≤ 500). May be empty when a title is given. */
  text: string;
  /** Optional headline (≤ 100). */
  title?: string;
  /** Default 'campus'. */
  scope?: BuzzScope;
  /** One of BUZZ_CATEGORIES, or left out for none. */
  category?: BuzzCategory;
  /** Up to 4 anonymous photo URLs (uploaded with kind "buzz"). Not together with `video`. */
  images?: string[];
  imageMeta?: { url: string; width: number | null; height: number | null; blur: string | null }[];
  /** One ready Mux video (≤ 60 s). */
  video?: { playbackId: string; posterUrl: string | null; width: number | null; height: number | null; durationSeconds: number | null };
  poll?: { options: string[]; durationDays: BuzzPollDuration };
  promptId?: string;
}

export interface CreateBuzzReplyRequest {
  text: string;
  /** A reply in the same thread; omitted = reply to the root. */
  parentId?: string;
}

export interface BuzzVoteState {
  score: number;
  myVote: -1 | 0 | 1;
  collapsed: boolean;
}

export type MyBuzzKind = "threads" | "replies";

export interface MyBuzzItem {
  item: Buzz | BuzzReply;
  /** The root's headline (own threads: the buzz itself), ≤ 120 chars; '' when the thread is gone. */
  threadSnippet: string;
}

/* ───────────────────────────── moderation (author-facing) ───────────────────────────── */

export type ModerationCategory =
  | "threat_violence" | "harassment_bullying" | "hate"
  | "sexual_minors" | "sexual_explicit"
  | "drugs_illegal_sales" | "self_harm"
  | "pii_doxxing" | "named_accusation" | "impersonation"
  | "spam_scam" | "academic_dishonesty" | "profanity";

export interface SupportResources {
  kind: "self_harm";
  headline: string;
  body: string;
  lines: Array<{ label: string; detail: string; href: string }>;
  emergencyNote: string;
}

export interface ModerationUserMessage {
  id: string;
  title: string;
  body: string;
  guidelineAnchor: string | null;
}

/** The ONLY moderation data a non-staff client ever receives. */
export interface AuthorNotice {
  status: "active" | "held";
  userMessage: ModerationUserMessage | null;
  support: SupportResources | null;
}

export type WithModeration<T> = T & { moderation: AuthorNotice };

/** `details` of a 422 `content_blocked`. */
export interface ContentBlockedDetails {
  messageId: string;
  title: string;
  category: ModerationCategory | null;
  guidelineAnchor: string | null;
  support: SupportResources | null;
}

export type BuzzReportReason =
  | "self_harm" | "threat" | "minor_safety" | "doxxing" | "harassment" | "hate" | "sexual"
  | "drugs_illegal" | "impersonation" | "spam_scam" | "academic_dishonesty" | "other";

/** Error codes the Buzz client layer turns server errors into (see `toBuzzError`). */
export type BuzzErrorCode =
  | "buzz_gate_required" | "not_found" | "unauthenticated" | "forbidden" | "locked"
  | "muted" | "suspended" | "banned" | "warning_unacknowledged"
  | "rate_limited" | "content_blocked" | "validation_failed" | "too_new"
  | "poll_closed" | "already_voted" | "own_item" | "prompt_ended" | "unavailable" | "unknown";
