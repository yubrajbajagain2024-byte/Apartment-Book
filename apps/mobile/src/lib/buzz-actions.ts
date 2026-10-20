import { Platform, Share } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  BUZZ_MENU_COPY,
  buzzErrorMessage,
  buzzHeadline,
  deleteBuzzItem,
  formatDate,
  getBuzzMeta,
  hideBuzzAuthor,
  hideBuzzThread,
  isBuzzError,
  nextBuzzVote,
  reportBuzzItem,
  voteBuzzItem,
  voteBuzzPoll,
  type Buzz,
  type BuzzReply,
  type BuzzReportReason,
  type BuzzScope,
  type BuzzVoteState,
  type BuzzWriteTarget,
} from "@apartment-book/shared";
import { phosphor } from "./palette";
import { buzzState, emitBuzzEvent, getBuzzItem, getBuzzState, heldReplies, markVotePending, patchBuzzItem } from "./buzz-store";
import { hapticSelect, hapticTap } from "./haptics";
import { shortDate } from "./short-date";
import { SITE_URL, supabase } from "./supabase";

/**
 * What the Buzz screens do to an item, in one place: votes (optimistic, one request at a time per item, undone by
 * tapping the same arrow again), poll votes, hiding a thread or an anon, deleting your own, reporting, sharing. Each
 * updates the item store (lib/buzz-store) so every screen showing the item follows, and failures become a toast.
 * Writes of new buzzes and replies go through the website (createBuzzPost / createBuzzReply), see buzzWriteTarget.
 */

type Item = Buzz | BuzzReply;

/** Where the app sends new buzzes and replies: the website's moderated write API, as the signed-in person. */
export async function buzzWriteTarget(): Promise<BuzzWriteTarget> {
  const { data } = await supabase.auth.getSession();
  return { baseUrl: SITE_URL, accessToken: data.session?.access_token ?? null };
}

/** A Buzz read failed: a `buzz_gate_required` brings the guidelines gate back (a new version mid-session); the sentence to show. */
export function noteBuzzReadError(e: unknown): string {
  if (isBuzzError(e, "buzz_gate_required")) buzzState.setGate("required");
  return buzzErrorMessage(e);
}

/** A Buzz action failed: the toast that says so (a rate limit in UniVerse's words). */
export function toastBuzzError(e: unknown): void {
  if (isBuzzError(e, "buzz_gate_required")) {
    buzzState.setGate("required");
    return;
  }
  if (isBuzzError(e, "rate_limited")) {
    buzzState.toast("You're going fast. Take a breather and try again in a moment.", { tone: "error" });
    return;
  }
  if (isBuzzError(e, "muted") || isBuzzError(e, "suspended") || isBuzzError(e, "banned")) {
    const until = (e as { details?: { until?: unknown } }).details?.until;
    buzzState.setPosting(null);
    buzzState.toast(typeof until === "number" ? `You're muted until ${formatDate(new Date(until).toISOString())}. You can read and vote, but you can't post.` : buzzErrorMessage(e), { tone: "error" });
    return;
  }
  buzzState.toast(buzzErrorMessage(e), { tone: "error" });
}

const metaLoading = new Set<BuzzScope>();

/**
 * A feed's meta (today's prompt, the small-campus note, the campus's name for "Search Texas State buzz"), loaded once if
 * nothing has it yet: Search, My buzzes or the composer can come up before Home's Buzz page has asked.
 */
export function ensureBuzzMeta(scope: BuzzScope = "campus"): void {
  if (getBuzzState().meta[scope] || metaLoading.has(scope)) return;
  metaLoading.add(scope);
  getBuzzMeta(supabase, scope)
    .then(
      (m) => buzzState.setMeta(scope, m),
      () => {},
    )
    .finally(() => metaLoading.delete(scope));
}

/** "5m", "3h", "Sep 30": when an item was published (its jittered, minute-floored time; never the real write time). */
export function buzzTime(ms: number): string {
  return shortDate(new Date(ms).toISOString());
}

/** The website's Community Guidelines, at a section, in the in-app browser. */
export function openGuidelines(anchor?: string | null): void {
  void WebBrowser.openBrowserAsync(`${SITE_URL}/guidelines${anchor ? `#${anchor}` : ""}`, { controlsColor: phosphor.accent, toolbarColor: phosphor.canvas, dismissButtonStyle: "close" }).catch(() => {});
}

export function threadUrl(threadId: string): string {
  return `${SITE_URL}/buzz/${threadId}`;
}

/**
 * The system share sheet with the thread's link (and its headline): text only, never a friend card, an alias or a
 * photo, so nothing shared can point at who wrote it. iOS puts Copy in the sheet; the app has no clipboard of its own.
 */
export function shareBuzz(item: Pick<Buzz, "threadId" | "title" | "text">): void {
  const url = threadUrl(item.threadId);
  const words = buzzHeadline(item, 140);
  void Share.share(Platform.OS === "ios" ? { message: words ? `${words}` : undefined, url } : { message: words ? `${words} ${url}` : url, title: "Buzz" }).catch(() => {});
}

/* ───────────────────────────── votes ───────────────────────────── */

type VoteQueue = { wanted: -1 | 0 | 1 | null; sending: boolean; confirmed: BuzzVoteState };
const votes = new Map<string, VoteQueue>();

/**
 * Up or down on a buzz or a reply. The arrow lights at once; votes go to the server one at a time, so quick taps can
 * never land out of order (only the newest tap is sent next), and the server's answer wins in the end. A failure puts
 * back what the server last confirmed. Your own items and items that are not active take no votes (the arrows are
 * disabled; the server refuses them too).
 */
export function voteOnBuzz(id: string, pressed: -1 | 1): void {
  const item = getBuzzItem(id);
  if (!item || item.isMine || item.status !== "active") return;
  const next = nextBuzzVote(item, pressed);
  hapticTap();
  let q = votes.get(id);
  if (!q) {
    q = { wanted: null, sending: false, confirmed: { score: item.score, myVote: item.myVote, collapsed: item.collapsed } };
    votes.set(id, q);
  }
  patchBuzzItem(id, { myVote: next.value, score: next.score });
  q.wanted = next.value;
  if (q.sending) return;
  q.sending = true;
  markVotePending(id, true);
  const queue = q;
  void (async () => {
    try {
      while (queue.wanted !== null) {
        const value = queue.wanted;
        queue.wanted = null;
        if (value === queue.confirmed.myVote) continue;
        queue.confirmed = await voteBuzzItem(supabase, id, value);
      }
      patchBuzzItem(id, { score: queue.confirmed.score, myVote: queue.confirmed.myVote, collapsed: queue.confirmed.collapsed });
    } catch (e) {
      queue.wanted = null;
      patchBuzzItem(id, { score: queue.confirmed.score, myVote: queue.confirmed.myVote, collapsed: queue.confirmed.collapsed });
      toastBuzzError(e);
    } finally {
      queue.sending = false;
      markVotePending(id, false);
      if (votes.get(id) === queue && queue.wanted === null) votes.delete(id);
    }
  })();
}

/* ───────────────────────────── polls ───────────────────────────── */

const pollsVoting = new Set<string>();

export function isPollVoting(threadId: string): boolean {
  return pollsVoting.has(threadId);
}

/** One vote per poll, no changing it; the results show once it lands. */
export async function voteOnPoll(threadId: string, optionId: string): Promise<void> {
  if (pollsVoting.has(threadId)) return;
  pollsVoting.add(threadId);
  hapticSelect();
  try {
    const poll = await voteBuzzPoll(supabase, threadId, optionId);
    patchBuzzItem(threadId, (it) => (it.kind === "buzz" ? { ...it, poll } : it));
  } catch (e) {
    toastBuzzError(e);
  } finally {
    pollsVoting.delete(threadId);
  }
}

/* ───────────────────────────── hide, delete, report ───────────────────────────── */

/** "Hide this thread": it leaves every list for you; whoever wrote it is not told, and you still do not know who they are. */
export async function hideThread(threadId: string): Promise<boolean> {
  try {
    await hideBuzzThread(supabase, threadId, true);
    emitBuzzEvent({ type: "removed", id: threadId, threadId });
    buzzState.toast(BUZZ_MENU_COPY.threadHidden);
    return true;
  } catch (e) {
    toastBuzzError(e);
    return false;
  }
}

/**
 * "Hide this anon in this thread": their replies here fold for you. The server keys it on the thread and the author, so
 * this never learns who they are; an alias belongs to one author in one thread, so every reply with it folds at once.
 */
export async function hideAnon(reply: BuzzReply): Promise<void> {
  try {
    await hideBuzzAuthor(supabase, reply.id);
    for (const r of heldReplies(reply.threadId)) {
      if (r.alias.label === reply.alias.label && !r.isMine) patchBuzzItem(r.id, { collapsed: true });
    }
    buzzState.toast(BUZZ_MENU_COPY.anonHidden);
    emitBuzzEvent({ type: "thread", threadId: reply.threadId });
  } catch (e) {
    toastBuzzError(e);
  }
}

/** Your own buzz or reply. A buzz leaves the lists; a reply stays as "[deleted]" where it has replies under it. */
export async function deleteOwn(item: Item): Promise<boolean> {
  try {
    await deleteBuzzItem(supabase, item.id);
    if (item.kind === "buzz") emitBuzzEvent({ type: "removed", id: item.id, threadId: item.threadId });
    else {
      patchBuzzItem(item.id, { status: "deleted", text: "" });
      emitBuzzEvent({ type: "thread", threadId: item.threadId });
    }
    buzzState.dropFeeds();
    buzzState.toast(BUZZ_MENU_COPY.deleted);
    return true;
  } catch (e) {
    toastBuzzError(e);
    return false;
  }
}

/** Sends a report; the item then leaves your lists. Throws, so the report sheet can stay open on a failure. */
export async function reportItem(item: Item, reason: BuzzReportReason, note: string | null): Promise<void> {
  await reportBuzzItem(supabase, item.id, reason, note);
  emitBuzzEvent({ type: "removed", id: item.id, threadId: item.threadId });
}
