"use client";

/**
 * What tapping things in Buzz does: votes (optimistic, tap again to undo, rolled back on failure, one request in the
 * air per item so the server's numbers always win), poll votes, delete, hide thread, hide this anon, share / copy
 * link. Every result is written into the query cache, so every list showing the item updates together.
 */
import { BUZZ_MENU_COPY, buzzErrorMessage, nextBuzzVote, type Buzz, type BuzzReply, type BuzzVoteState } from "@apartment-book/shared";
import { buzzApi } from "./api";
import { handleBuzzWriteError } from "./moderation";
import { buzzKeys, invalidateQueries, patchBuzzItem, removeBuzzItem } from "./query";
import { toast } from "./toast";

type Item = Buzz | BuzzReply;

/* ───────────────────────────── votes ───────────────────────────── */

interface VoteFlight {
  desired: -1 | 0 | 1;
  confirmed: BuzzVoteState;
  running: boolean;
}
const flights = new Map<string, VoteFlight>();

export function castVote(item: Item, pressed: -1 | 1): void {
  if (item.isMine || item.status !== "active") return;
  const next = nextBuzzVote(item, pressed);
  patchBuzzItem(item.id, (it) => ({ ...it, myVote: next.value, score: next.score }));
  let flight = flights.get(item.id);
  if (!flight) {
    flight = { desired: next.value, confirmed: { score: item.score, myVote: item.myVote, collapsed: item.collapsed }, running: false };
    flights.set(item.id, flight);
  }
  flight.desired = next.value;
  if (!flight.running) void fly(item.id, flight);
}

async function fly(id: string, flight: VoteFlight): Promise<void> {
  flight.running = true;
  try {
    for (;;) {
      const sending = flight.desired;
      try {
        const state = await buzzApi.vote(id, sending);
        flight.confirmed = state;
        if (flight.desired !== sending) continue;
        patchBuzzItem(id, (it) => ({ ...it, score: state.score, myVote: state.myVote, collapsed: state.collapsed }));
        return;
      } catch (e) {
        const back = flight.confirmed;
        patchBuzzItem(id, (it) => ({ ...it, score: back.score, myVote: back.myVote, collapsed: back.collapsed }));
        if (!handleBuzzWriteError(e)) toast.error(buzzErrorMessage(e));
        return;
      }
    }
  } finally {
    flights.delete(id);
  }
}

/* ───────────────────────────── polls ───────────────────────────── */

export async function castPollVote(threadId: string, optionId: string): Promise<void> {
  try {
    const poll = await buzzApi.pollVote(threadId, optionId);
    patchBuzzItem(threadId, (it) => (it.kind === "buzz" ? { ...it, poll } : it));
  } catch (e) {
    if (!handleBuzzWriteError(e)) toast.error(buzzErrorMessage(e));
    invalidateQueries(buzzKeys.thread(threadId));
  }
}

/* ───────────────────────────── delete / hide ───────────────────────────── */

export async function deleteBuzzOrReply(item: Item, onDeleted?: () => void): Promise<void> {
  try {
    await buzzApi.remove(item.id);
    removeBuzzItem(item.id);
    toast.show(BUZZ_MENU_COPY.deleted);
    invalidateQueries(buzzKeys.thread(item.threadId));
    invalidateQueries(buzzKeys.karma);
    if (item.kind === "reply") patchBuzzItem(item.threadId, (it) => (it.kind === "buzz" ? { ...it, replyCount: Math.max(0, it.replyCount - 1) } : it));
    onDeleted?.();
  } catch (e) {
    toast.error(buzzErrorMessage(e));
  }
}

/** The whole thread leaves your feeds (for you only). */
export async function hideThread(threadId: string, onHidden?: () => void): Promise<void> {
  removeBuzzItem(threadId);
  try {
    await buzzApi.hideThread(threadId, true);
    toast.show(BUZZ_MENU_COPY.threadHidden);
    onHidden?.();
  } catch (e) {
    toast.error(buzzErrorMessage(e));
    invalidateQueries(buzzKeys.feeds);
  }
}

/** This anon's replies in THIS thread fold for you (keyed thread + author in the database; never linkable). */
export async function hideAnon(reply: BuzzReply): Promise<void> {
  try {
    await buzzApi.hideAuthor(reply.id);
    patchBuzzItem(reply.id, (it) => ({ ...it, collapsed: true }));
    toast.show(BUZZ_MENU_COPY.anonHidden);
    // Their other replies in the thread fold too: the server knows which ones, we don't.
    invalidateQueries(buzzKeys.thread(reply.threadId));
  } catch (e) {
    toast.error(buzzErrorMessage(e));
  }
}

/* ───────────────────────────── share ───────────────────────────── */

function threadUrl(threadId: string): string {
  return `${window.location.origin}/buzz/${threadId}`;
}

export async function copyBuzzLink(threadId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(threadUrl(threadId));
    toast.success("Link copied");
  } catch {
    toast.error("Couldn't copy the link.");
  }
}

/**
 * The system share sheet where there is one, else the link is copied. Text-only: the link and a short line of the
 * buzz, never an alias (there is no share card for Buzz on the website).
 */
export async function shareBuzz(item: Buzz): Promise<void> {
  const url = threadUrl(item.threadId);
  const line = (item.title || item.text).replace(/\s+/g, " ").trim().slice(0, 140);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Buzz", text: line, url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  await copyBuzzLink(item.threadId);
}
