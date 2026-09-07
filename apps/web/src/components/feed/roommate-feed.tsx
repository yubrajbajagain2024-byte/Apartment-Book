"use client";

import { useCallback } from "react";
import { listRoommatePosts, type RoommateFilters, type RoommatePostWithAuthor } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { RoommateCard } from "@/components/roommates/roommate-card";
import { FeedFooter, SkeletonCard } from "./feed-bits";
import { useInfinitePages } from "./use-infinite-pages";

export function RoommateFeed({
  initial,
  totalPages,
  filters,
  savedIds,
  signedIn,
}: {
  initial: RoommatePostWithAuthor[];
  totalPages: number;
  filters: RoommateFilters;
  savedIds: string[];
  signedIn: boolean;
}) {
  const load = useCallback(async (page: number) => (await listRoommatePosts(createClient(), { ...filters, page })).data, [filters]);
  const feed = useInfinitePages({ initial, totalPages, load });
  const saved = new Set(savedIds);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {feed.items.map((post, i) => (
          <div key={post.id} className={i >= initial.length ? "ab-fade-in" : undefined}>
            <RoommateCard post={post} saved={saved.has(post.id)} signedIn={signedIn} />
          </div>
        ))}
        {feed.loading ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={`s-${i}`} aspect="aspect-[16/9]" />) : null}
      </div>
      <FeedFooter sentinelRef={feed.sentinelRef} loading={feed.loading} done={feed.done} error={feed.error} onRetry={feed.loadMore} count={feed.items.length} />
    </>
  );
}
