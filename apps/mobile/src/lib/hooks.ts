import { useCallback, useEffect, useRef, useState } from "react";

/** Load something once (and again when `deps` change), with a manual refresh. */
export function useQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const result = await load();
      if (id === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, error, loading, refresh: run, setData };
}

/** Paged feed: first page on mount, `loadMore` appends, `refresh` restarts. */
export function useFeed<T extends { id: string }>(loadPage: (page: number) => Promise<{ data: T[]; totalPages: number }>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const fetchPage = useCallback(
    async (p: number, replace: boolean) => {
      const id = ++seq.current;
      try {
        const result = await loadPage(p);
        if (id !== seq.current) return;
        setItems((prev) => (replace ? result.data : [...prev, ...result.data.filter((r) => !prev.some((x) => x.id === r.id))]));
        setTotalPages(result.totalPages);
        setPage(p);
        setError(null);
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : "Could not load");
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    setLoading(true);
    void fetchPage(1, true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || refreshing || page >= totalPages) return;
    void fetchPage(page + 1, false);
  }, [fetchPage, loading, refreshing, page, totalPages]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchPage(1, true);
  }, [fetchPage]);

  return { items, setItems, loading, refreshing, error, loadMore, refresh, hasMore: page < totalPages };
}

export function errorText(e: unknown, fallback = "Something went wrong. Please try again."): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
