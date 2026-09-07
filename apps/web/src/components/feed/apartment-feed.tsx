"use client";

import { useCallback } from "react";
import { listApartments, type ApartmentFilters, type ApartmentWithOwner } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { ApartmentCard } from "@/components/apartments/apartment-card";
import { FeedFooter, SkeletonCard } from "./feed-bits";
import { useInfinitePages } from "./use-infinite-pages";

export function ApartmentFeed({
  initial,
  totalPages,
  filters,
  savedIds,
  signedIn,
}: {
  initial: ApartmentWithOwner[];
  totalPages: number;
  filters: ApartmentFilters;
  savedIds: string[];
  signedIn: boolean;
}) {
  const load = useCallback(async (page: number) => (await listApartments(createClient(), { ...filters, page })).data, [filters]);
  const feed = useInfinitePages({ initial, totalPages, load });
  const saved = new Set(savedIds);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {feed.items.map((apartment, i) => (
          <div key={apartment.id} className={i >= initial.length ? "ab-fade-in" : undefined}>
            <ApartmentCard apartment={apartment} saved={saved.has(apartment.id)} signedIn={signedIn} priority={i < 2} />
          </div>
        ))}
        {feed.loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={`s-${i}`} />) : null}
      </div>
      <FeedFooter sentinelRef={feed.sentinelRef} loading={feed.loading} done={feed.done} error={feed.error} onRetry={feed.loadMore} count={feed.items.length} />
    </>
  );
}
