"use client";

/**
 * A small query cache for Buzz (the website has no React Query): one entry per key, shared by every screen, so the
 * feed is still there when you come back from a thread, a vote shows everywhere at once and a write can refresh the
 * lists it touches. Same defaults as UniVerse's client: data is fresh for 30 s, one retry for network / server
 * errors, never for 4xx. A `buzz_gate_required` from any call re-checks the gate, so the panel comes back by itself.
 *
 * Memory only, and wiped when the signed-in account changes (`onBuzzOwnerChange`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { isBuzzError, toBuzzError, type Buzz, type BuzzPage, type BuzzReply, type MyBuzzItem } from "@apartment-book/shared";
import { onBuzzOwnerChange } from "./store";

export type QueryKey = readonly (string | number | boolean | null)[];

interface Entry {
  readonly key: QueryKey;
  readonly data: unknown;
  readonly error: unknown;
  readonly updatedAt: number;
  readonly fetching: boolean;
  /** Invalidated: refetch the next time it is used. */
  readonly stale: boolean;
  /** Bumped whenever the data is replaced by a fresh fetch (infinite lists drop a next page that raced it). */
  readonly generation: number;
  readonly nextFetching: boolean;
  readonly nextError: unknown;
}

const EMPTY: Entry = { key: [], data: undefined, error: null, updatedAt: 0, fetching: false, stale: true, generation: 0, nextFetching: false, nextError: null };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();
/** The fetcher of every mounted query, so an invalidation can refetch what is on screen. */
const fetchers = new Map<string, Set<() => Promise<unknown>>>();
let epoch = 0;

const keyOf = (key: QueryKey): string => JSON.stringify(key);

function emit(k: string): void {
  listeners.get(k)?.forEach((l) => l());
}

function write(k: string, key: QueryKey, patch: Partial<Entry>): Entry {
  const next: Entry = { ...(entries.get(k) ?? EMPTY), key, ...patch };
  entries.set(k, next);
  emit(k);
  return next;
}

function startsWith(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((p, i) => key[i] === p);
}

function retryable(e: unknown): boolean {
  const err = toBuzzError(e);
  if (err.status === 0 || err.status >= 500) return true;
  return err.code === "unknown" && /fetch|network|timeout/i.test(err.message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetches (or joins the request already in the air) and stores the result. */
export function fetchQuery<T>(key: QueryKey, fetcher: () => Promise<T>): Promise<T> {
  const k = keyOf(key);
  const running = inflight.get(k);
  if (running) return running as Promise<T>;
  const myEpoch = epoch;
  const run = async (): Promise<T> => {
    try {
      return await fetcher();
    } catch (e) {
      if (!retryable(e)) throw e;
      await sleep(800);
      return fetcher();
    }
  };
  const promise = run().then(
    (data) => {
      if (myEpoch === epoch) {
        const prev = entries.get(k) ?? EMPTY;
        write(k, key, { data, error: null, updatedAt: Date.now(), fetching: false, stale: false, generation: prev.generation + 1, nextFetching: false, nextError: null });
      }
      return data;
    },
    (error: unknown) => {
      if (myEpoch === epoch) {
        write(k, key, { error: toBuzzError(error), fetching: false, stale: false, updatedAt: Date.now() });
        // The gate was bumped (or never accepted on this device's session): ask again, the panel shows itself.
        if (isBuzzError(toBuzzError(error), "buzz_gate_required") && key[0] !== "gate") invalidateQueries(["gate"]);
      }
      throw toBuzzError(error);
    },
  );
  const tracked = promise.finally(() => {
    if (inflight.get(k) === tracked) inflight.delete(k);
  });
  inflight.set(k, tracked);
  write(k, key, { fetching: true });
  return tracked;
}

export function getQueryData<T>(key: QueryKey): T | undefined {
  return entries.get(keyOf(key))?.data as T | undefined;
}

export function setQueryData<T>(key: QueryKey, updater: T | ((prev: T | undefined) => T | undefined)): void {
  const k = keyOf(key);
  const prev = entries.get(k)?.data as T | undefined;
  const next = typeof updater === "function" ? (updater as (p: T | undefined) => T | undefined)(prev) : updater;
  if (next === prev) return;
  write(k, key, { data: next, updatedAt: Date.now() });
}

/** Applies `fn` to the data of every cached entry under `prefix`. */
export function updateQueries<T>(prefix: QueryKey, fn: (data: T) => T): void {
  for (const [k, e] of entries) {
    if (e.data === undefined || !startsWith(e.key, prefix)) continue;
    const next = fn(e.data as T);
    if (next !== e.data) write(k, e.key, { data: next });
  }
}

/** Marks everything under `prefix` stale and refetches what is on screen right now. */
export function invalidateQueries(prefix: QueryKey): void {
  for (const [k, e] of entries) {
    if (!startsWith(e.key, prefix)) continue;
    const active = fetchers.get(k);
    const fetcher = active ? [...active][0] : undefined;
    if (fetcher) void fetchQuery(e.key, fetcher).catch(() => {});
    else write(k, e.key, { stale: true });
  }
}

/** Forget everything (account change). In-flight answers are dropped when they land. */
export function clearBuzzCache(): void {
  epoch += 1;
  inflight.clear();
  const keys = [...entries.keys()];
  entries.clear();
  keys.forEach(emit);
}
onBuzzOwnerChange(clearBuzzCache);

/* ───────────────────────────── hooks ───────────────────────────── */

export interface QueryOptions {
  /** Default 30 s. */
  staleTime?: number;
  /** Refetch while mounted (threads poll every 30 s: Buzz writes have no realtime push, see the jitter rules). */
  refetchInterval?: number;
  /** Refetch when the tab comes back into view. */
  refetchOnFocus?: boolean;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: unknown;
  /** No data yet and still trying. */
  isLoading: boolean;
  /** No data and the last try failed. */
  isError: boolean;
  isFetching: boolean;
  refetch(): Promise<T | undefined>;
}

function useEntry(k: string | null): Entry {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!k) return () => {};
      let set = listeners.get(k);
      if (!set) listeners.set(k, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(k);
      };
    },
    [k],
  );
  return useSyncExternalStore(
    subscribe,
    () => (k ? (entries.get(k) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
}

/** `key: null` = disabled (nothing is fetched: before the gate is accepted, for example). */
export function useBuzzQuery<T>(key: QueryKey | null, fetcher: () => Promise<T>, opts: QueryOptions = {}): QueryResult<T> {
  const k = key ? keyOf(key) : null;
  const entry = useEntry(k);
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });
  const { staleTime = 30_000, refetchInterval, refetchOnFocus } = opts;

  useEffect(() => {
    if (!k) return;
    const parsed = JSON.parse(k) as QueryKey;
    const run = () => fetcherRef.current();
    let set = fetchers.get(k);
    if (!set) fetchers.set(k, (set = new Set()));
    set.add(run);
    const e = entries.get(k);
    if (!e || e.data === undefined || e.stale || Date.now() - e.updatedAt > staleTime) void fetchQuery(parsed, run).catch(() => {});
    return () => {
      set.delete(run);
      if (set.size === 0) fetchers.delete(k);
    };
  }, [k, staleTime]);

  useEffect(() => {
    if (!k || !refetchInterval) return;
    const parsed = JSON.parse(k) as QueryKey;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void fetchQuery(parsed, () => fetcherRef.current()).catch(() => {});
    }, refetchInterval);
    return () => clearInterval(timer);
  }, [k, refetchInterval]);

  useEffect(() => {
    if (!k || !refetchOnFocus) return;
    const parsed = JSON.parse(k) as QueryKey;
    let last = Date.now();
    const onFocus = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 5_000) return;
      last = Date.now();
      void fetchQuery(parsed, () => fetcherRef.current()).catch(() => {});
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [k, refetchOnFocus]);

  const refetch = useCallback(async () => {
    if (!k) return undefined;
    return fetchQuery(JSON.parse(k) as QueryKey, () => fetcherRef.current()).catch(() => undefined) as Promise<T | undefined>;
  }, [k]);

  const hasData = entry.data !== undefined;
  return {
    data: entry.data as T | undefined,
    error: entry.error,
    isLoading: k !== null && !hasData && (entry.fetching || !entry.error),
    isError: k !== null && !hasData && Boolean(entry.error) && !entry.fetching,
    isFetching: entry.fetching,
    refetch,
  };
}

/* ───────────────────────────── infinite lists ───────────────────────────── */

export interface InfinitePage<T> extends BuzzPage<T> {
  /** Feeds: the instant Hot ranked against, passed back with every following page. */
  rankAt?: string;
}

export interface InfiniteData<T> {
  pages: InfinitePage<T>[];
}

export interface InfiniteResult<T> extends Omit<QueryResult<InfiniteData<T>>, "data"> {
  items: T[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  nextError: unknown;
  fetchNextPage(): void;
}

export function useBuzzInfinite<T>(key: QueryKey | null, fetchPage: (offset: number, rankAt: string | null) => Promise<InfinitePage<T>>, opts: QueryOptions = {}): InfiniteResult<T> {
  const pageRef = useRef(fetchPage);
  useLayoutEffect(() => {
    pageRef.current = fetchPage;
  });
  const query = useBuzzQuery<InfiniteData<T>>(key, async () => ({ pages: [await pageRef.current(0, null)] }), opts);
  const k = key ? keyOf(key) : null;
  const entry = useEntry(k);
  const data = query.data;
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const last = data?.pages[data.pages.length - 1];
  const hasNextPage = Boolean(last && last.nextOffset !== null);

  const fetchNextPage = useCallback(() => {
    if (!k) return;
    const current = entries.get(k);
    const pages = (current?.data as InfiniteData<T> | undefined)?.pages;
    const tail = pages?.[pages.length - 1];
    if (!current || !pages || !tail || tail.nextOffset === null || current.nextFetching || current.fetching) return;
    const parsed = JSON.parse(k) as QueryKey;
    const generation = current.generation;
    const myEpoch = epoch;
    write(k, parsed, { nextFetching: true, nextError: null });
    pageRef
      .current(tail.nextOffset, pages[0]?.rankAt ?? null)
      .then((page) => {
        const now = entries.get(k);
        if (myEpoch !== epoch || !now || now.generation !== generation) return;
        const have = (now.data as InfiniteData<T>).pages;
        write(k, parsed, { data: { pages: [...have, page] }, nextFetching: false });
      })
      .catch((error: unknown) => {
        if (myEpoch !== epoch) return;
        write(k, parsed, { nextFetching: false, nextError: toBuzzError(error) });
      });
  }, [k]);

  return {
    items,
    error: query.error,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch as unknown as InfiniteResult<T>["refetch"],
    hasNextPage,
    isFetchingNextPage: entry.nextFetching,
    nextError: entry.nextError,
    fetchNextPage,
  };
}

/* ───────────────────────────── patching Buzz items everywhere ───────────────────────────── */

/** A thread as the cache keeps it: the root and every reply loaded so far, oldest first. */
export interface ThreadData {
  root: Buzz;
  replies: BuzzReply[];
  nextOffset: number | null;
  smallCampusNote: boolean;
}

export const buzzKeys = {
  gate: ["gate"] as const,
  posting: ["posting"] as const,
  feeds: ["feed"] as const,
  feed: (sort: string, window: string, scope: string) => ["feed", "list", sort, sort === "top" ? window : "day", scope] as const,
  /** Under `feed` on purpose: votes, deletes and new buzzes patch and refresh search results like any feed. */
  search: (q: string, scope: string, sort: string) => ["feed", "search", q, scope, sort] as const,
  meta: (scope: string) => ["meta", scope] as const,
  threads: ["thread"] as const,
  thread: (id: string) => ["thread", id] as const,
  mine: ["mine"] as const,
  mineKind: (kind: string) => ["mine", kind] as const,
  karma: ["karma"] as const,
};

function mapPages<T>(data: InfiniteData<T>, fn: (items: T[]) => T[]): InfiniteData<T> {
  let changed = false;
  const pages = data.pages.map((p) => {
    const items = fn(p.items);
    if (items !== p.items) changed = true;
    return items === p.items ? p : { ...p, items };
  });
  return changed ? { pages } : data;
}

function mapIfAny<T>(items: T[], match: (t: T) => boolean, fn: (t: T) => T | null): T[] {
  if (!items.some(match)) return items;
  const out: T[] = [];
  for (const it of items) {
    if (!match(it)) out.push(it);
    else {
      const next = fn(it);
      if (next) out.push(next);
    }
  }
  return out;
}

/** Applies `fn` to every cached copy of the item (feeds, search, My buzzes, threads). Return null to drop it. */
export function patchBuzzItem(id: string, fn: (item: Buzz | BuzzReply) => Buzz | BuzzReply | null): void {
  updateQueries<InfiniteData<Buzz>>(buzzKeys.feeds, (d) => mapPages(d, (items) => mapIfAny(items, (b) => b.id === id, (b) => fn(b) as Buzz | null)));
  updateQueries<InfiniteData<MyBuzzItem>>(buzzKeys.mine, (d) =>
    mapPages(d, (items) =>
      mapIfAny(
        items,
        (m) => m.item.id === id,
        (m) => {
          const item = fn(m.item);
          return item ? { ...m, item } : null;
        },
      ),
    ),
  );
  updateQueries<ThreadData>(buzzKeys.threads, (t) => {
    const replies = mapIfAny(t.replies, (r) => r.id === id, (r) => fn(r) as BuzzReply | null);
    const root = t.root.id === id ? ((fn(t.root) as Buzz | null) ?? t.root) : t.root;
    return root === t.root && replies === t.replies ? t : { ...t, root, replies };
  });
}

/** The item leaves every list (deleted, hidden, reported). A thread root stays in its own thread entry. */
export function removeBuzzItem(id: string): void {
  updateQueries<InfiniteData<Buzz>>(buzzKeys.feeds, (d) => mapPages(d, (items) => mapIfAny(items, (b) => b.id === id || b.threadId === id, () => null)));
  updateQueries<InfiniteData<MyBuzzItem>>(buzzKeys.mine, (d) => mapPages(d, (items) => mapIfAny(items, (m) => m.item.id === id, () => null)));
  updateQueries<ThreadData>(buzzKeys.threads, (t) => {
    const replies = mapIfAny(t.replies, (r) => r.id === id, () => null);
    return replies === t.replies ? t : { ...t, replies };
  });
}
