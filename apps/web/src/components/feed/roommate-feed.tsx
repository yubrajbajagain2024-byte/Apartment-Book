"use client";

import { useCallback } from "react";
import { budgetLabel, formatDistance, isVerifiedPoster, listRoommatePosts, listingMedia, type RoommateFilters, type RoommatePostWithAuthor } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { RoommateCard } from "@/components/roommates/roommate-card";
import { PostCard } from "@/components/posts/post-card";
import { PostFeed } from "@/components/posts/post-feed";
import { FeedFooter, SkeletonCard } from "./feed-bits";
import { useInfinitePages } from "./use-infinite-pages";

export function RoommateFeed({
  initial,
  totalPages,
  filters,
  savedIds,
  signedIn,
  currentUserId,
}: {
  initial: RoommatePostWithAuthor[];
  totalPages: number;
  filters: RoommateFilters;
  savedIds: string[];
  signedIn: boolean;
  currentUserId: string | null;
}) {
  const load = useCallback(async (page: number) => (await listRoommatePosts(createClient(), { ...filters, page })).data, [filters]);
  const feed = useInfinitePages({ initial, totalPages, load });
  const saved = new Set(savedIds);

  return (
    <PostFeed
      items={feed.items}
      mediaOf={(p) => listingMedia(p.images, p.image_meta)}
      render={(p, compact, i) => {
        const media = listingMedia(p.images, p.image_meta);
        // Posts without any media keep the text card; posts with media become Instagram posts.
        if (media.length === 0) return <RoommateCard post={p} saved={saved.has(p.id)} signedIn={signedIn} />;
        const budget = budgetLabel(p);
        return (
          <PostCard
            href={`/roommates/${p.id}`}
            targetType="roommate"
            targetId={p.id}
            poster={{ id: p.author.id, name: p.author.full_name, avatarUrl: p.author.avatar_url, verified: isVerifiedPoster(p.author) }}
            subtitle={[p.distance_km !== null ? `${formatDistance(p.distance_km)} from campus` : null, p.location].filter(Boolean).join(" · ")}
            media={media}
            title={p.title}
            caption={p.description}
            lead={[p.post_type === "has_room" ? "Has a room" : "Looking for a room", budget ? `${budget}/mo` : null].filter(Boolean).join(" · ")}
            createdAt={p.created_at}
            saved={saved.has(p.id)}
            signedIn={signedIn}
            currentUserId={currentUserId}
            messagePrefill={`Hi ${p.author.full_name.split(" ")[0]}! I saw your roommate post "${p.title}" and I'd like to chat.`}
            priority={i < 2}
            compact={compact}
          />
        );
      }}
      trailing={
        <>
          {feed.loading ? (
            <div className="grid grid-cols-2 gap-1 sm:gap-3">
              <SkeletonCard aspect="aspect-[4/5]" lines={2} />
              <SkeletonCard aspect="aspect-[4/5]" lines={2} />
            </div>
          ) : null}
          <FeedFooter sentinelRef={feed.sentinelRef} loading={feed.loading} done={feed.done} error={feed.error} onRetry={feed.loadMore} count={feed.items.length} />
        </>
      }
    />
  );
}
