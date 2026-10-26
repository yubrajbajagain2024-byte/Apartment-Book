"use client";

/**
 * Buzz reads as hooks over the query cache. Every one of them is disabled (makes no request) until the gate is
 * accepted: pass `enabled` from `useBuzzGate().accepted`.
 */
import { useCallback, useSyncExternalStore } from "react";
import { BUZZ_PAGE, type Buzz, type BuzzFeedSort, type BuzzReply, type BuzzScope, type BuzzTopWindow, type MyBuzzItem, type MyBuzzKind } from "@apartment-book/shared";
import { buzzApi } from "./api";
import { buzzKeys, fetchQuery, getQueryData, setQueryData, useBuzzInfinite, useBuzzQuery, type ThreadData } from "./query";

export function useBuzzFeed(sort: BuzzFeedSort, window: BuzzTopWindow, scope: BuzzScope, enabled: boolean) {
  return useBuzzInfinite<Buzz>(enabled ? buzzKeys.feed(sort, window, scope) : null, (offset, rankAt) => buzzApi.feed({ scope, sort, window, offset, rankAt }));
}

/** Search: every word must appear in the title or the body. Idle until there are 2+ characters. */
export function useBuzzSearch(q: string, scope: BuzzScope, sort: "new" | "top", enabled: boolean) {
  const query = q.trim();
  return useBuzzInfinite<Buzz>(enabled && query.length >= 2 ? buzzKeys.search(query.toLowerCase(), scope, sort) : null, (offset, rankAt) =>
    buzzApi.feed({ scope, sort, window: sort === "top" ? "all" : undefined, q: query, offset, rankAt }),
  );
}

export function useBuzzMeta(scope: BuzzScope, enabled: boolean) {
  return useBuzzQuery(enabled ? buzzKeys.meta(scope) : null, () => buzzApi.meta(scope), { staleTime: 5 * 60_000 });
}

export function usePostingStatus(enabled: boolean) {
  return useBuzzQuery(enabled ? buzzKeys.posting : null, () => buzzApi.postingStatus(), { staleTime: 60_000 });
}

export function useMyBuzz(kind: MyBuzzKind, enabled: boolean) {
  return useBuzzInfinite<MyBuzzItem>(enabled ? buzzKeys.mineKind(kind) : null, (offset) => buzzApi.mine(kind, offset));
}

export function useBuzzKarma(enabled: boolean) {
  return useBuzzQuery(enabled ? buzzKeys.karma : null, () => buzzApi.karma());
}

/* ───────────────────────────── a thread ───────────────────────────── */

/** How many replies a refresh asks for: everything already on screen (at least one page), so polling never drops any. */
function refreshLimit(prev: ThreadData | undefined): number {
  return Math.min(200, Math.max(BUZZ_PAGE.replies, prev?.replies.length ?? 0));
}

async function loadThread(threadId: string): Promise<ThreadData> {
  const key = buzzKeys.thread(threadId);
  const prev = getQueryData<ThreadData>(key);
  const t = await buzzApi.thread(threadId, refreshLimit(prev));
  const fresh = t.replies.items;
  // The server may cap a page: keep replies loaded beyond what came back, after the fresh ones.
  const extra = prev && t.replies.nextOffset !== null && prev.replies.length > fresh.length ? prev.replies.slice(fresh.length).filter((r) => !fresh.some((f) => f.id === r.id)) : [];
  return {
    root: t.root,
    replies: [...fresh, ...extra],
    nextOffset: extra.length ? (prev?.nextOffset ?? null) : t.replies.nextOffset,
    smallCampusNote: t.smallCampusNote,
  };
}

/**
 * The thread with every reply loaded so far. No realtime on Buzz (publication is jittered, a push would give the
 * real write time away): it polls every 30 s, refreshes when the tab comes back, and after your own writes.
 */
export function useBuzzThread(threadId: string, enabled: boolean) {
  return useBuzzQuery<ThreadData>(enabled ? buzzKeys.thread(threadId) : null, () => loadThread(threadId), { refetchInterval: 30_000, refetchOnFocus: true });
}

const moreReplies = new Map<string, Promise<void>>();
const moreListeners = new Set<() => void>();
const moreErrors = new Map<string, unknown>();
function notifyMore() {
  moreListeners.forEach((l) => l());
}

/** Loads the next page of replies (append). One request at a time per thread. */
export function loadMoreReplies(threadId: string): void {
  const key = buzzKeys.thread(threadId);
  const t = getQueryData<ThreadData>(key);
  if (!t || t.nextOffset === null || moreReplies.has(threadId)) return;
  const offset = t.nextOffset;
  moreErrors.delete(threadId);
  const run = buzzApi
    .replies(threadId, offset)
    .then((page) => {
      setQueryData<ThreadData>(key, (cur) => {
        if (!cur) return cur;
        const seen = new Set(cur.replies.map((r) => r.id));
        return { ...cur, replies: [...cur.replies, ...page.items.filter((r: BuzzReply) => !seen.has(r.id))], nextOffset: page.nextOffset };
      });
    })
    .catch((e: unknown) => {
      moreErrors.set(threadId, e);
    })
    .finally(() => {
      moreReplies.delete(threadId);
      notifyMore();
    });
  moreReplies.set(threadId, run);
  notifyMore();
}

export function useMoreRepliesState(threadId: string): { loading: boolean; error: unknown } {
  const subscribe = useCallback((l: () => void) => {
    moreListeners.add(l);
    return () => moreListeners.delete(l);
  }, []);
  const loading = useSyncExternalStore(
    subscribe,
    () => moreReplies.has(threadId),
    () => false,
  );
  const error = useSyncExternalStore(
    subscribe,
    () => moreErrors.get(threadId) ?? null,
    () => null,
  );
  return { loading, error };
}

/** Refresh a thread now (after your own reply, a hide …). */
export function refreshThread(threadId: string): Promise<unknown> {
  return fetchQuery(buzzKeys.thread(threadId), () => loadThread(threadId)).catch(() => undefined);
}
