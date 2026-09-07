"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Infinite scrolling over server-paginated data. The first page comes from
 * the server (SEO); later pages are fetched in the browser when a sentinel
 * near the bottom scrolls into view.
 */
export function useInfinitePages<T extends { id: string }>(opts: {
  initial: T[];
  totalPages: number;
  load: (page: number) => Promise<T[]>;
}) {
  const [items, setItems] = useState<T[]>(opts.initial);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const done = page >= opts.totalPages;
  const { load } = opts;

  const loadMore = useCallback(async () => {
    if (busy.current || page >= opts.totalPages) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await load(page + 1);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...next.filter((n) => !seen.has(n.id))];
      });
      setPage((p) => p + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [load, page, opts.totalPages]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, done]);

  return { items, loading, error, done, sentinelRef, loadMore };
}
