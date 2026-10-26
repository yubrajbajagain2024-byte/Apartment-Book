import { useCallback, useEffect, useRef, useState } from "react";
import type { Buzz, BuzzReply } from "@apartment-book/shared";
import { noteBuzzReadError } from "@/lib/buzz-actions";
import { putBuzzItems } from "@/lib/buzz-store";

/** One page as a list loads it: its rows (ids, and whatever a row needs besides), the items behind them, what follows. */
export type BuzzListPage<R extends { id: string }> = { rows: R[]; items: readonly (Buzz | BuzzReply)[]; nextOffset: number | null; rankAt?: string | null };

/** A list's state kept between visits (the feed's cache in the Buzz store). */
export type BuzzListSnapshot<R extends { id: string }> = { rows: R[]; nextOffset: number | null; rankAt: string | null; at: number };

type State<R> = {
  key: string | null;
  rows: R[];
  nextOffset: number | null;
  rankAt: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
};

/** A snapshot older than this is shown at once and loaded again behind it. */
const STALE_MS = 60_000;

/**
 * A paged Buzz list (the feed, search results, My buzzes): the first page when `key` changes (null = nothing to load,
 * before the gate is accepted or with fewer than two letters typed), the next page on `loadMore`, pull to refresh,
 * rows dropped as items go away. Items go to the Buzz item store; the rows hold ids. Hot ranks every page against the
 * first page's `rankAt`. A cached snapshot (`restore`) shows at once and refreshes behind the scenes when stale. A new
 * key never shows the previous key's rows, not even for a frame.
 */
export function useBuzzList<R extends { id: string }>({
  key,
  load,
  restore,
  onLoaded,
}: {
  key: string | null;
  load: (offset: number, rankAt: string | null) => Promise<BuzzListPage<R>>;
  restore?: (key: string) => BuzzListSnapshot<R> | null;
  onLoaded?: (key: string, snapshot: Omit<BuzzListSnapshot<R>, "at">) => void;
}) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const seq = useRef(0);

  const initialFor = (k: string | null): State<R> => {
    if (k === null) return { key: null, rows: [], nextOffset: null, rankAt: null, status: "idle", error: null };
    const snap = restoreRef.current?.(k) ?? null;
    return snap ? { key: k, rows: snap.rows, nextOffset: snap.nextOffset, rankAt: snap.rankAt, status: "ready", error: null } : { key: k, rows: [], nextOffset: null, rankAt: null, status: "loading", error: null };
  };
  const [state, setState] = useState<State<R>>(() => initialFor(key));
  // A new key takes its own state in this very render (React re-renders before anything is drawn).
  if (state.key !== key) setState(initialFor(key));
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(async (forKey: string, mode: "initial" | "refresh" | "background") => {
    const id = ++seq.current;
    try {
      const page = await loadRef.current(0, null);
      if (id !== seq.current) return;
      putBuzzItems(page.items);
      setState({ key: forKey, rows: page.rows, nextOffset: page.nextOffset, rankAt: page.rankAt ?? null, status: "ready", error: null });
      setMoreError(false);
    } catch (e) {
      if (id !== seq.current) return;
      const message = noteBuzzReadError(e);
      // A refresh that fails keeps the rows on screen; a first load shows the error state.
      setState((s) => (s.key !== forKey ? s : mode === "initial" || s.rows.length === 0 ? { ...s, status: "error", error: message } : { ...s, error: message }));
    } finally {
      if (id === seq.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoadingMore(false);
    setMoreError(false);
    if (key === null) {
      seq.current++;
      return;
    }
    const snap = restoreRef.current?.(key) ?? null;
    if (snap && Date.now() - snap.at <= STALE_MS) {
      // Fresh enough: nothing to load, and nothing still loading for an older key may land.
      seq.current++;
      return;
    }
    void reload(key, snap ? "background" : "initial");
  }, [key, reload]);

  // What is on screen is what a later visit starts from (the feed keeps it in the Buzz store).
  useEffect(() => {
    if (state.status === "ready" && state.key) onLoadedRef.current?.(state.key, { rows: state.rows, nextOffset: state.nextOffset, rankAt: state.rankAt });
  }, [state]);

  const refresh = useCallback(() => {
    const k = stateRef.current.key;
    if (!k) return;
    setRefreshing(true);
    void reload(k, "refresh");
  }, [reload]);

  /** Loads the first page again without the pull-to-refresh spinner (a write of your own, a fold, a return to the screen). */
  const reloadQuietly = useCallback(() => {
    const k = stateRef.current.key;
    if (k) void reload(k, stateRef.current.status === "ready" ? "background" : "initial");
  }, [reload]);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.status !== "ready" || s.nextOffset === null || loadingMore || !s.key) return;
    const id = seq.current;
    const forKey = s.key;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await loadRef.current(s.nextOffset, s.rankAt);
      if (id !== seq.current) return;
      putBuzzItems(page.items);
      setState((cur) => {
        if (cur.key !== forKey) return cur;
        const seen = new Set(cur.rows.map((r) => r.id));
        return { ...cur, rows: [...cur.rows, ...page.rows.filter((r) => !seen.has(r.id))], nextOffset: page.nextOffset };
      });
    } catch (e) {
      if (id === seq.current) {
        noteBuzzReadError(e);
        setMoreError(true);
      }
    } finally {
      if (id === seq.current) setLoadingMore(false);
    }
  }, [loadingMore]);

  const remove = useCallback((id: string) => {
    setState((s) => (s.rows.some((r) => r.id === id) ? { ...s, rows: s.rows.filter((r) => r.id !== id) } : s));
  }, []);

  return {
    key: state.key,
    rows: state.rows,
    status: state.status,
    error: state.error,
    ended: state.status === "ready" && state.nextOffset === null,
    refreshing,
    loadingMore,
    moreError,
    refresh,
    reloadQuietly,
    loadMore,
    remove,
  };
}
