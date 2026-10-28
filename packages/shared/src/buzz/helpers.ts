/**
 * Pure Buzz v2 helpers shared by the website and the app (no network, no React). Ported from UniVerse's
 * `features/buzz/{ThreadPage,parts}.tsx` and `services/buzz/store.ts`.
 */
import type { FeedMedia } from "../types/models";
import type { Buzz, BuzzErrorCode, BuzzItemStatus, BuzzMedia, BuzzReply, BuzzReplySort, ContentBlockedDetails } from "./types";

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

/** A reply with the replies under it, at any depth. */
export interface BuzzReplyTreeNode {
  reply: BuzzReply;
  children: BuzzReplyTreeNode[];
  /** Every reply below this one, at any depth. */
  descendants: number;
}

/**
 * Nests a thread's replies at any depth, as Reddit does, each under the reply it answers: `treeParentId` (databases with
 * 20261108000000_buzz_reply_tree.sql), else the server's two levels (`parentId`). `items` come oldest first, and a
 * reply only hangs from one listed before it, so the result is always a tree; one whose parent is not loaded hangs from
 * the thread. Siblings follow `sort` at every level: best (the higher score, then the busier branch, then the older),
 * new or old. With `keep` (positions from `buzzReplyForestOrder` of an earlier build), replies already placed keep
 * their order and new ones follow them, so a thread that reloads in the background does not reshuffle under the reader.
 */
export function buildBuzzReplyForest(threadId: string, items: readonly BuzzReply[], sort: BuzzReplySort = "best", keep?: ReadonlyMap<string, number>): BuzzReplyTreeNode[] {
  const roots: BuzzReplyTreeNode[] = [];
  const index = new Map<string, BuzzReplyTreeNode>();
  const pos = new Map<BuzzReplyTreeNode, number>();
  for (const reply of items) {
    if (index.has(reply.id)) continue;
    const node: BuzzReplyTreeNode = { reply, children: [], descendants: 0 };
    const parentId = reply.treeParentId ?? (reply.depth === 1 ? threadId : reply.parentId);
    const parent = parentId === threadId ? undefined : index.get(parentId);
    (parent ? parent.children : roots).push(node);
    index.set(reply.id, node);
    pos.set(node, pos.size);
  }
  const at = (n: BuzzReplyTreeNode) => pos.get(n) ?? 0;
  const by: (a: BuzzReplyTreeNode, b: BuzzReplyTreeNode) => number =
    sort === "old"
      ? (a, b) => at(a) - at(b)
      : sort === "new"
        ? (a, b) => b.reply.createdAt - a.reply.createdAt || at(b) - at(a)
        : (a, b) => b.reply.score - a.reply.score || b.descendants - a.descendants || at(a) - at(b);
  const order = (a: BuzzReplyTreeNode, b: BuzzReplyTreeNode) => {
    const ka = keep?.get(a.reply.id);
    const kb = keep?.get(b.reply.id);
    if (ka !== undefined && kb !== undefined) return ka - kb;
    if (ka !== undefined || kb !== undefined) return ka !== undefined ? -1 : 1;
    return by(a, b);
  };
  // Counts first (best weighs the busier branch), then each level in order.
  const settle = (nodes: BuzzReplyTreeNode[]): number => {
    let total = 0;
    for (const n of nodes) {
      n.descendants = settle(n.children);
      total += 1 + n.descendants;
    }
    nodes.sort(order);
    return total;
  };
  settle(roots);
  return roots;
}

/** Each reply's position in the forest, depth first: the `keep` of the next build. */
export function buzzReplyForestOrder(forest: readonly BuzzReplyTreeNode[]): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (nodes: readonly BuzzReplyTreeNode[]) => {
    for (const n of nodes) {
      out.set(n.reply.id, out.size);
      walk(n.children);
    }
  };
  walk(forest);
  return out;
}

/**
 * The thread lines of a row at depth d, one per level above it, left to right. `pass`: a line runs past the row (a
 * reply above it has more replies below); `none`: nothing. The last one links the row to the reply it answers: `tee`
 * when more replies to that reply follow, `end` when it is the last of them.
 */
export type BuzzRail = "pass" | "none" | "tee" | "end";

interface BuzzRowBase {
  key: string;
  /** 0 for a reply to the thread itself. */
  depth: number;
  rails: BuzzRail[];
  /** The reply each rail belongs to (rails[k] is the line of the reply at depth k above this row). */
  railIds: string[];
}

/**
 * A line of the thread screen: a reply (`stem` when its replies follow it, so a line runs down from it; `collapsed`
 * with the number of replies it folds away), "N more replies" under a reply whose further replies are folded, or
 * "Continue this thread" where the tree gets too deep for the screen.
 */
export type BuzzThreadRow =
  | (BuzzRowBase & { kind: "reply"; id: string; stem: boolean; collapsed: boolean; hidden: number })
  | (BuzzRowBase & { kind: "more"; parentId: string; count: number })
  | (BuzzRowBase & { kind: "continue"; id: string; count: number });

/** How the app draws a thread: six levels (0-5), then "Continue this thread"; three replies under a top-level one, two deeper. */
export const BUZZ_THREAD_SHAPE = {
  maxDepth: 5,
  shown: (depth: number) => (depth === 0 ? 3 : 2),
} as const;

export interface BuzzThreadRowsOptions {
  /** Replies the reader folded: one line each, and nothing under them. */
  collapsed?: ReadonlySet<string>;
  /** Replies whose replies all show ("N more replies" was opened under them). */
  expanded?: ReadonlySet<string>;
  /** "Continue this thread": only this reply, at the top, and what is under it. */
  focusId?: string | null;
  /** The deepest level drawn; the replies under a reply there wait behind "Continue this thread". */
  maxDepth?: number;
  /** How many replies of a reply at `depth` show before "N more replies" (every reply to the thread shows). */
  shown?: (depth: number) => number;
}

const NONE: ReadonlySet<string> = new Set();

/** The subtree of `id` in the forest, or null. */
export function findBuzzReplyNode(forest: readonly BuzzReplyTreeNode[], id: string): BuzzReplyTreeNode | null {
  for (const n of forest) {
    if (n.reply.id === id) return n;
    const inner = findBuzzReplyNode(n.children, id);
    if (inner) return inner;
  }
  return null;
}

/** The replies from the top of the forest down to `id` (itself last), or [] when it is not there. */
export function buzzReplyPath(forest: readonly BuzzReplyTreeNode[], id: string): BuzzReplyTreeNode[] {
  for (const n of forest) {
    if (n.reply.id === id) return [n];
    const inner = buzzReplyPath(n.children, id);
    if (inner.length > 0) return [n, ...inner];
  }
  return [];
}

/** The forest as the screen's rows, depth first, with the thread lines each row draws. */
export function buzzThreadRows(forest: readonly BuzzReplyTreeNode[], opts: BuzzThreadRowsOptions = {}): BuzzThreadRow[] {
  const collapsed = opts.collapsed ?? NONE;
  const expanded = opts.expanded ?? NONE;
  const maxDepth = opts.maxDepth ?? BUZZ_THREAD_SHAPE.maxDepth;
  const shown = opts.shown ?? BUZZ_THREAD_SHAPE.shown;
  const focus = opts.focusId ? findBuzzReplyNode(forest, opts.focusId) : null;
  const rows: BuzzThreadRow[] = [];
  const railsOf = (open: readonly boolean[], last: boolean): BuzzRail[] => [...open.map((o): BuzzRail => (o ? "pass" : "none")), last ? "end" : "tee"];

  // `nodes` are the replies of `parentId` (null: the top level), at `depth`; open[k] says whether the line at level k
  // runs on below them, and ids[k] whose line it is.
  const emit = (nodes: readonly BuzzReplyTreeNode[], depth: number, parentId: string | null, open: readonly boolean[], ids: readonly string[]) => {
    const limit = parentId === null || expanded.has(parentId) ? nodes.length : Math.min(nodes.length, shown(depth - 1));
    const rest = nodes.slice(limit);
    // The "N more replies" line is the last child when there is one.
    const lastIndex = limit - (rest.length > 0 ? 0 : 1);
    nodes.slice(0, limit).forEach((node, i) => {
      const last = i === lastIndex;
      const id = node.reply.id;
      const folded = collapsed.has(id);
      const below = !folded && node.children.length > 0;
      rows.push({ kind: "reply", key: id, id, depth, rails: depth === 0 ? [] : railsOf(open, last), railIds: [...ids], stem: below, collapsed: folded, hidden: folded ? node.descendants : 0 });
      if (!below) return;
      const nextOpen = depth === 0 ? [] : [...open, !last];
      const nextIds = [...ids, id];
      if (depth >= maxDepth) rows.push({ kind: "continue", key: `continue:${id}`, id, depth: depth + 1, rails: railsOf(nextOpen, true), railIds: nextIds, count: node.descendants });
      else emit(node.children, depth + 1, id, nextOpen, nextIds);
    });
    if (rest.length > 0 && parentId !== null) {
      rows.push({ kind: "more", key: `more:${parentId}`, parentId, depth, rails: railsOf(open, true), railIds: [...ids], count: rest.reduce((n, x) => n + 1 + x.descendants, 0) });
    }
  };
  emit(focus ? [focus] : forest, 0, null, [], []);
  return rows;
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
  prompt_ended: "That prompt has ended. Today's is waiting for you.",
  unauthenticated: "Log in to use Buzz.",
  locked: "This thread is locked.",
  rate_limited: "You're doing that a lot. Try again in a little while.",
  suspended: "Your account is suspended right now, so you can't do that on Buzz.",
  unavailable: "Buzz isn't available right now. Try again in a little while.",
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
  // CampConnect Admin's suspension trigger (a vote by a suspended account): "Your account is suspended", hint ACCOUNT_SUSPENDED.
  const hint = typeof e === "object" && e !== null && "hint" in e ? String((e as { hint: unknown }).hint) : "";
  if (hint === "ACCOUNT_SUSPENDED" || /your account is suspended/i.test(raw)) return new BuzzError("suspended", FRIENDLY.suspended!, 403);
  // The database has no such Buzz function (the migration is not applied, or the API's schema cache is stale): never
  // show PostgREST's wording.
  if (/could not find the function|schema cache|PGRST202|function .* does not exist/i.test(raw)) {
    return new BuzzError("unavailable", FRIENDLY.unavailable!, 503);
  }
  return new BuzzError("unknown", raw || FRIENDLY.unknown!, status);
}

/** A sentence to show for any Buzz error. */
export function buzzErrorMessage(e: unknown): string {
  const err = toBuzzError(e);
  return err.message || FRIENDLY[err.code] || FRIENDLY.unknown!;
}
