"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, MapPin } from "lucide-react";
import {
  budgetLabel,
  formatDate,
  formatDistance,
  getPostEngagementMany,
  isVerifiedPoster,
  listRoommatePosts,
  listingMedia,
  type PostEngagement,
  type RoommateFilters,
  type RoommatePostWithAuthor,
} from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { PostCard } from "@/components/posts/post-card";
import { FeedFooter, SkeletonCard } from "./feed-bits";
import { useInfinitePages } from "./use-infinite-pages";

export type RoommateFeedProps = {
  initial: RoommatePostWithAuthor[];
  totalPages: number;
  filters: RoommateFilters;
  savedIds: string[];
  signedIn: boolean;
  currentUserId: string | null;
  currentUser: { id: string; name: string; avatarUrl: string | null } | null;
  /** Like/comment counts for the first page (server-rendered); later pages are fetched here. */
  engagement: Record<string, PostEngagement>;
};

/** Roommate posts as a single column of Facebook-style posts: text first, then media, then Like / Comment / Message. */
export function RoommateFeed({ initial, totalPages, filters, savedIds, signedIn, currentUserId, currentUser, engagement: initialEngagement }: RoommateFeedProps) {
  const load = useCallback(async (page: number) => (await listRoommatePosts(createClient(), { ...filters, page })).data, [filters]);
  const feed = useInfinitePages({ initial, totalPages, load });
  const saved = new Set(savedIds);
  const [engagement, setEngagement] = useState(initialEngagement);

  // Counts for posts that arrived through "load more".
  useEffect(() => {
    const missing = feed.items.filter((p) => !(p.id in engagement)).map((p) => p.id);
    if (missing.length === 0) return;
    let cancelled = false;
    getPostEngagementMany(createClient(), "roommate", missing)
      .then((rows) => {
        if (!cancelled) setEngagement((prev) => ({ ...prev, ...rows }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [feed.items, engagement]);

  return (
    <div className="-mx-3 flex flex-col gap-1 sm:mx-0 sm:gap-4">
      {feed.items.map((p, i) => {
        const budget = budgetLabel(p);
        return (
          <PostCard
            key={p.id}
            layout="facebook"
            href={`/roommates/${p.id}`}
            targetType="roommate"
            targetId={p.id}
            poster={{ id: p.author.id, name: p.author.full_name, avatarUrl: p.author.avatar_url, verified: isVerifiedPoster(p.author) }}
            subtitle={[p.university?.name ?? null, p.distance_km !== null ? `${formatDistance(p.distance_km)} from campus` : null].filter(Boolean).join(" · ")}
            media={listingMedia(p.images, p.image_meta, p.videos)}
            title={p.title}
            caption={p.description}
            lead={budget ? `${budget}/mo` : undefined}
            details={<RoommateDetails post={p} />}
            createdAt={p.created_at}
            saved={saved.has(p.id)}
            signedIn={signedIn}
            currentUserId={currentUserId}
            currentUser={currentUser}
            engagement={engagement[p.id]}
            messagePrefill={`Hi ${p.author.full_name.split(" ")[0]}! I saw your roommate post "${p.title}" and I'd like to chat.`}
            priority={i < 2}
          />
        );
      })}
      {feed.loading ? <SkeletonCard aspect="aspect-[4/5]" lines={3} /> : null}
      <FeedFooter sentinelRef={feed.sentinelRef} loading={feed.loading} done={feed.done} error={feed.error} onRetry={feed.loadMore} count={feed.items.length} />
    </div>
  );
}

/** Room type, location and move-in chips shown under the description. */
export function RoommateDetails({ post }: { post: RoommatePostWithAuthor }) {
  return (
    <>
      <Badge tone={post.post_type === "has_room" ? "green" : "blue"}>{post.post_type === "has_room" ? "Has a room" : "Looking for a room"}</Badge>
      {post.location ? (
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> {post.location}
        </span>
      ) : null}
      {post.move_in_date ? (
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5" /> Move in {formatDate(post.move_in_date)}
        </span>
      ) : null}
    </>
  );
}
