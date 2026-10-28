"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ADS_EVERY, adSlotCount, formatDistance, formatPrice, inquiryPrefill, interleaveAds, isVerifiedPoster, listApartments, listFeedAds, listingMedia, listingPoster, businessLabel, type ApartmentFilters, type ApartmentWithOwner, type FeedAd } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/posts/post-card";
import { PostFeed } from "@/components/posts/post-feed";
import { SponsoredListing } from "@/components/ads/sponsored";
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
  // Housing ads (only housing ads run here): at most one after every ADS_EVERY listings, for the student's campus.
  const [ads, setAds] = useState<FeedAd[]>([]);
  const adsDone = useRef(false);
  const adsBusy = useRef(false);
  useEffect(() => {
    if (!signedIn || adsDone.current || adsBusy.current) return;
    const need = adSlotCount(feed.items.length, ADS_EVERY) - ads.length;
    if (need <= 0) return;
    adsBusy.current = true;
    listFeedAds(createClient(), "housing", need, ads.length)
      .then((more) => {
        if (more.length < need) adsDone.current = true;
        setAds((prev) => [...prev, ...more.filter((a) => !prev.some((p) => p.id === a.id))]);
      })
      .finally(() => {
        adsBusy.current = false;
      });
  }, [feed.items.length, ads.length, signedIn]);
  const rows: (ApartmentWithOwner | { id: string; ad: FeedAd })[] = interleaveAds(feed.items, ads, ADS_EVERY).map((r) => (r.kind === "ad" ? { id: `ad-${r.ad.id}`, ad: r.ad } : r.item));

  return (
    <PostFeed
      items={rows}
      mediaOf={(a) => ("ad" in a ? [] : listingMedia(a.images, a.image_meta, a.videos))}
      render={(a, compact, i) => "ad" in a ? <SponsoredListing ad={a.ad} compact={compact} /> : (
        <PostCard
          href={`/apartments/${a.id}`}
          targetType="apartment"
          targetId={a.id}
          poster={{ ...listingPoster(a.owner, a.business), verified: !a.business && isVerifiedPoster(a.owner), badge: businessLabel(a.business, a.sponsored) }}
          businessId={a.business?.id ?? null}
          subtitle={[a.distance_km !== null ? `${formatDistance(a.distance_km)} from campus` : null, a.city || a.address].filter(Boolean).join(" · ")}
          media={listingMedia(a.images, a.image_meta, a.videos)}
          title={a.title}
          caption={a.description}
          lead={apartmentLead(a)}
          createdAt={a.created_at}
          saved={saved.has(a.id)}
          signedIn={signedIn}
          currentUserId={currentUserId}
          messagePrefill={a.business ? inquiryPrefill(a.business.name, a.title) : `Hi! I'm interested in "${a.title}". Is it still available?`}
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
