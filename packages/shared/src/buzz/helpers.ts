/**
 * Pure Buzz v2 helpers shared by the website and the app (no network, no React). Ported from UniVerse's
 * `features/buzz/{ThreadPage,parts}.tsx` and `services/buzz/store.ts`.
 */
import type { FeedMedia } from "../types/models";
import type { Buzz, BuzzErrorCode, BuzzItemStatus, BuzzMedia, BuzzReply, ContentBlockedDetails } from "./types";

/** Placeholder text for items whose words other viewers may not read. `held` never reaches another viewer. */
export const BUZZ_PLACEHOLDERS: Partial<Record<BuzzItemStatus, string>> = {
  held: "[held for review]",
  hidden: "[hidden pending review]",
  removed: "[removed by moderators]",
  deleted: "[deleted]",
};

/** Same as `muxPlaybackUrl` (media.ts), inlined so this file stays loadable without a bundler. */
const MUX_STREAM = "https://stream.mux.com";

/** A depth-1 reply with its (already flattened, depth-2) children, oldest first. */
export interface BuzzReplyNode {
  reply: BuzzReply;
  children: BuzzReply[];
}

/**
 * Groups a flat, oldest-first reply list into depth-1 nodes with their depth-2 children. The server has already
 * flattened anything deeper (with `replyingTo`); a reply whose parent is not on the loaded pages becomes its own node.
 */
export function buildBuzzReplyTree(threadId: string, items: readonly BuzzReply[]): BuzzReplyNode[] {
  const nodes: BuzzReplyNode[] = [];
  const index = new Map<string, BuzzReplyNode>();
  const orphans: BuzzReply[] = [];
  for (const r of items) {
    if (r.parentId === threadId || r.depth === 1) {
      const node: BuzzReplyNode = { reply: r, children: [] };
      nodes.push(node);
      index.set(r.id, node);
    } else {
      const parent = index.get(r.parentId);
      if (parent) parent.children.push(r);
      else orphans.push(r);
    }
  }
  for (const o of orphans) nodes.push({ reply: o, children: [] });
  return nodes;
}

/** "5h left" / "2d left" / "closed". */
export function buzzPollTimeLeft(closesAt: number, now = Date.now()): string {
  const ms = closesAt - now;
  if (ms <= 0) return "closed";
  const h = Math.ceil(ms / 3_600_000);
  if (h < 24) return `${h}h left`;
  return `${Math.ceil(h / 24)}d left`;
}

/** The poll's caption under its options. */
export function buzzPollCaption(poll: { closed: boolean; resultsVisible: boolean; totalVotes: number | null; closesAt: number }, now = Date.now()): string {
  const votes = poll.totalVotes ?? 0;
  if (poll.closed) return `Poll closed · ${votes} ${votes === 1 ? "vote" : "votes"}`;
  if (poll.resultsVisible) return `${votes} ${votes === 1 ? "vote" : "votes"} · ${buzzPollTimeLeft(poll.closesAt, now)}`;
  return `Vote to see results · ${buzzPollTimeLeft(poll.closesAt, now)}`;
}

/** The text to show for an item, or its placeholder ("[removed by moderators]") when the words are withheld. */
export function buzzPlaceholder(item: { text: string; status: BuzzItemStatus }): string | null {
  return item.text === "" ? (BUZZ_PLACEHOLDERS[item.status] ?? null) : null;
}

/** What a buzz is "about" in one line: its title when it has one, else its body. */
export function buzzHeadline(buzz: Pick<Buzz, "title" | "text">, max = 120): string {
  const t = (buzz.title.trim() ? buzz.title : buzz.text).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "N reply" / "N replies". */
export function buzzReplyCountLabel(count: number): string {
  return count === 1 ? "reply" : "replies";
}

/** Optimistic vote: tap the same arrow again to undo. Returns the next vote and the next score. */
export function nextBuzzVote(item: { myVote: -1 | 0 | 1; score: number }, pressed: -1 | 1): { value: -1 | 0 | 1; score: number } {
  const value = item.myVote === pressed ? 0 : pressed;
  return { value, score: item.score - item.myVote + value };
}

/** Buzz media in the shape the existing photo / video viewers of both apps take. */
export function buzzFeedMedia(media: readonly BuzzMedia[]): FeedMedia[] {
  return media.map((m) =>
    m.type === "image"
      ? { type: "photo", url: m.url, width: m.width, height: m.height, blur: m.blur }
      : { type: "video", playbackUrl: `${MUX_STREAM}/${m.playbackId}.m3u8`, poster: m.posterUrl, width: m.width, height: m.height, durationSeconds: m.durationSeconds },
  );
}

/** Words a Buzz search matches on, the way the database splits them: lower-cased, ≥ 2 characters, at most 6. */
export function buzzSearchTerms(q: string | null | undefined): string[] {
  if (!q) return [];
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}'&+#.-]+/u)
    .map((w) => w.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 6);
}

/* ───────────────────────────── errors ───────────────────────────── */

export class BuzzError extends Error {
  readonly code: BuzzErrorCode;
  readonly status: number;
  readonly details: unknown;
  constructor(code: BuzzErrorCode, message: string, status = 400, details: unknown = null) {
    super(message);
    this.name = "BuzzError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isBuzzError(e: unknown, code?: BuzzErrorCode): e is BuzzError {
  return e instanceof BuzzError && (code === undefined || e.code === code);
}

/** `details` of a content_blocked error, when that is what it is. */
export function contentBlockedDetails(e: unknown): ContentBlockedDetails | null {
  return isBuzzError(e, "content_blocked") ? (e.details as ContentBlockedDetails) : null;
}

const FRIENDLY: Partial<Record<BuzzErrorCode, string>> = {
  buzz_gate_required: "Accept the Buzz guidelines to continue.",
  not_found: "That buzz isn't available.",
  unauthenticated: "Log in to use Buzz.",
  locked: "This thread is locked.",
  rate_limited: "You're doing that a lot. Try again in a little while.",
  unknown: "Something went wrong. Try again.",
};

/**
 * Turns whatever a Buzz call threw into a BuzzError. Database functions raise `buzz:<code>:<message>`
 * (for example `buzz:not_found:That buzz isn't available.`); the write API answers `{ error: { code, message, details } }`.
 */
export function toBuzzError(e: unknown, status = 400): BuzzError {
  if (e instanceof BuzzError) return e;
  const raw = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : typeof e === "string" ? e : "";
  const m = /buzz:([a-z_]+):([\s\S]*)$/.exec(raw);
  if (m) {
    const code = m[1] as BuzzErrorCode;
    return new BuzzError(code, m[2]!.trim() || FRIENDLY[code] || FRIENDLY.unknown!, code === "not_found" ? 404 : code === "buzz_gate_required" || code === "muted" || code === "suspended" || code === "banned" || code === "locked" ? 403 : code === "rate_limited" ? 429 : status);
  }
  if (/not authenticated|jwt/i.test(raw)) return new BuzzError("unauthenticated", FRIENDLY.unauthenticated!, 401);
  return new BuzzError("unknown", raw || FRIENDLY.unknown!, status);
}

/** A sentence to show for any Buzz error. */
export function buzzErrorMessage(e: unknown): string {
  const err = toBuzzError(e);
  return err.message || FRIENDLY[err.code] || FRIENDLY.unknown!;
}
