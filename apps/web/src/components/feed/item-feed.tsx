"use client";

import { useCallback } from "react";
import { listItems, type ItemFilters, type ItemWithSeller } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { ItemCard } from "@/components/marketplace/item-card";
import { FeedFooter, SkeletonCard } from "./feed-bits";
import { useInfinitePages } from "./use-infinite-pages";

export function ItemFeed({
  initial,
  totalPages,
  filters,
  savedIds,
  signedIn,
}: {
  initial: ItemWithSeller[];
  totalPages: number;
  filters: ItemFilters;
  savedIds: string[];
  signedIn: boolean;
}) {
  const load = useCallback(async (page: number) => (await listItems(createClient(), { ...filters, page })).data, [filters]);
  const feed = useInfinitePages({ initial, totalPages, load });
  const saved = new Set(savedIds);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {feed.items.map((item, i) => (
          <div key={item.id} className={i >= initial.length ? "ab-fade-in" : undefined}>
            <ItemCard item={item} saved={saved.has(item.id)} signedIn={signedIn} priority={i < 4} />
          </div>
        ))}
        {feed.loading ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={`s-${i}`} aspect="aspect-square" lines={2} />) : null}
      </div>
      <FeedFooter sentinelRef={feed.sentinelRef} loading={feed.loading} done={feed.done} error={feed.error} onRetry={feed.loadMore} count={feed.items.length} />
    </>
  );
}
