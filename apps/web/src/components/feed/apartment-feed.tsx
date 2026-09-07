"use client";

import { useCallback } from "react";
import { formatDistance, formatPrice, isVerifiedPoster, listApartments, listingMedia, type ApartmentFilters, type ApartmentWithOwner } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/posts/post-card";
import { PostFeed } from "@/components/posts/post-feed";
import { FeedFooter, SkeletonCard } from "./feed-bits";
import { useInfinitePages } from "./use-infinite-pages";

export function apartmentLead(a: ApartmentWithOwner): string {
  return `${formatPrice(a.price_per_month, a.currency)}/mo · ${a.bedrooms === 0 ? "Studio" : `${a.bedrooms} bd`} · ${a.bathrooms} ba`;
}

export function ApartmentFeed({
  initial,
  totalPages,
  filters,
  savedIds,
  signedIn,
  currentUserId,
}: {
  initial: ApartmentWithOwner[];
  totalPages: number;
  filters: ApartmentFilters;
  savedIds: string[];
  signedIn: boolean;
  currentUserId: string | null;
}) {
  const load = useCallback(async (page: number) => (await listApartments(createClient(), { ...filters, page })).data, [filters]);
  const feed = useInfinitePages({ initial, totalPages, load });
  const saved = new Set(savedIds);

  return (
    <PostFeed
      items={feed.items}
      mediaOf={(a) => listingMedia(a.images, a.image_meta, a.videos)}
      render={(a, compact, i) => (
        <PostCard
          href={`/apartments/${a.id}`}
          targetType="apartment"
          targetId={a.id}
          poster={{ id: a.owner.id, name: a.owner.full_name, avatarUrl: a.owner.avatar_url, verified: isVerifiedPoster(a.owner) }}
          subtitle={[a.distance_km !== null ? `${formatDistance(a.distance_km)} from campus` : null, a.city || a.address].filter(Boolean).join(" · ")}
          media={listingMedia(a.images, a.image_meta, a.videos)}
          title={a.title}
          caption={a.description}
          lead={apartmentLead(a)}
          createdAt={a.created_at}
          saved={saved.has(a.id)}
          signedIn={signedIn}
          currentUserId={currentUserId}
          messagePrefill={`Hi! I'm interested in "${a.title}". Is it still available?`}
          priority={i < 2}
          compact={compact}
        />
      )}
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
