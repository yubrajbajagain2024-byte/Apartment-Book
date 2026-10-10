import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileTile } from "@apartment-book/shared";
import { errorText } from "@/lib/hooks";

/** Where the next page starts: a page number (Posts, Reels) or the time of the last row (Saved, Liked). */
export type GridCursor = number | string;
export type GridPage = { tiles: ProfileTile[]; next: GridCursor | null };
export type TileGrid = ReturnType<typeof useTileGrid>;

/** Saved and Liked drop what the reader may no longer see, so a page can come back empty with more behind it. */
const MAX_EMPTY_HOPS = 3;

/**
 * One profile grid (Posts, Reels, Saved or Liked), paged. Nothing loads until `enabled` (the tab was opened and the reader
 * may see it); a new `resetKey` (another profile or another viewer) starts again from the first page. `refresh` reloads the
 * first page while the squares stay up; `quietRefresh` does the same without a spinner or an error, and only while a single
 * page is loaded, so coming back to the screen never throws away a scrolled-down grid. `update` edits the squares in place.
 * The Listings tab uses it too, as a single page (`next` is always null).
 */
export function useTileGrid(load: (cursor: GridCursor | null) => Promise<GridPage>, { resetKey, enabled }: { resetKey: string; enabled: boolean }) {
  const [tiles, setTiles] = useState<ProfileTile[]>([]);
  const [next, setNext] = useState<GridCursor | null>(null);
  /** idle: not asked for yet. loading: the first page is on its way and nothing is shown. ready: a page has arrived. */
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const seq = useRef(0);
  const pages = useRef(0);
  const moreBusy = useRef(false);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const fetchFrom = useCallback(async (cursor: GridCursor | null, id: number): Promise<GridPage> => {
    let page = await loadRef.current(cursor);
    for (let hop = 0; hop < MAX_EMPTY_HOPS && page.tiles.length === 0 && page.next !== null && id === seq.current; hop++) page = await loadRef.current(page.next);
    return page;
  }, []);

  const loadFirst = useCallback(
    async (mode: "initial" | "refresh" | "quiet") => {
      const id = ++seq.current;
      moreBusy.current = false;
      setLoadingMore(false);
      setMoreError(null);
      if (mode === "initial") {
        setStatus("loading");
        setTiles([]);
        setNext(null);
        setError(null);
      }
      try {
        const page = await fetchFrom(null, id);
        if (id !== seq.current) return;
        pages.current = 1;
        setTiles(page.tiles);
        setNext(page.next);
        setError(null);
        setStatus("ready");
      } catch (e) {
        if (id !== seq.current || mode === "quiet") return;
        setError(errorText(e));
        // A failed first load shows its error where the grid would be; a failed refresh keeps the squares it had.
        setStatus((s) => (s === "loading" ? "ready" : s));
      }
    },
    [fetchFrom],
  );

  useEffect(() => {
    if (enabled) {
      void loadFirst("initial");
      return;
    }
    seq.current += 1;
    pages.current = 0;
    setTiles([]);
    setNext(null);
    setError(null);
    setMoreError(null);
    setLoadingMore(false);
    setStatus("idle");
  }, [resetKey, enabled, loadFirst]);

  const loadMore = useCallback(async () => {
    if (status !== "ready" || next === null || moreBusy.current) return;
    const id = seq.current;
    moreBusy.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchFrom(next, id);
      if (id !== seq.current) return;
      pages.current += 1;
      setTiles((prev) => {
        const seen = new Set(prev.map((t) => t.key));
        return [...prev, ...page.tiles.filter((t) => !seen.has(t.key))];
      });
      setNext(page.next);
    } catch (e) {
      if (id === seq.current) setMoreError(errorText(e));
    } finally {
      if (id === seq.current) {
        moreBusy.current = false;
        setLoadingMore(false);
      }
    }
  }, [status, next, fetchFrom]);

  const refresh = useCallback(() => (enabled ? loadFirst(status === "idle" ? "initial" : "refresh") : Promise.resolve()), [enabled, status, loadFirst]);
  const quietRefresh = useCallback(() => {
    if (enabled && status === "ready" && pages.current <= 1 && !error) void loadFirst("quiet");
  }, [enabled, status, error, loadFirst]);
  const update = useCallback((fn: (tiles: ProfileTile[]) => ProfileTile[]) => setTiles(fn), []);

  return { tiles, status, error, hasMore: next !== null, loadingMore, moreError, loadMore, refresh, quietRefresh, update };
}
