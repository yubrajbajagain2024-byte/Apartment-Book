import { useMemo, useRef } from "react";
import { RefreshControl, Text, View, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { formatDistance, formatPrice, isVerifiedPoster, KM_PER_MILE, listApartments, listingMedia, type ApartmentWithOwner } from "@apartment-book/shared";
import type { RoomFilters } from "@/components/housing/filter-sheet";
import { FEED_HEADER_PADDING, PostCard } from "@/components/post-card";
import { Badge, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useColors } from "@/lib/theme-provider";
import { useEngagement } from "@/lib/use-engagement";
import { useTabReselect } from "@/lib/tab-reselect";
import { refreshWithHaptic } from "@/lib/haptics";

/**
 * The Apartments half of the Explore tab: the listings feed, starting `topInset` under the floating labels and pills and
 * reporting its scroll through `onScroll`. The search (`q`) and the campus come from the Housing screen's own bar, which
 * also owns the "+" button.
 */
export function ApartmentsSection({ topInset, onScroll, q, campus, filters, filtered, active = true }: { topInset: number; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void; q: string; campus: "mine" | "all"; filters: RoomFilters; filtered: boolean; active?: boolean }) {
  const colors = useColors();
  const { user, profile } = useSession();
  const universityId = campus === "all" ? undefined : (profile?.university_id ?? undefined);
  // The filter sheet's choices; distance needs a campus to measure from, so it is dropped on "every university".
  const radiusKm = universityId && filters.radiusMiles ? filters.radiusMiles * KM_PER_MILE : undefined;
  const feed = useFeed<ApartmentWithOwner>(
    (page) => listApartments(supabase, { q: q || undefined, universityId, page, sort: filters.sort, minBedrooms: filters.minBedrooms, minPrice: filters.minPrice, maxPrice: filters.maxPrice, furnished: filters.furnished, petsAllowed: filters.petsAllowed, videoOnly: filters.videoOnly, radiusKm }),
    [q, universityId, filters.sort, filters.minBedrooms, filters.minPrice, filters.maxPrice, filters.furnished, filters.petsAllowed, filters.videoOnly, radiusKm],
  );
  const { savedIds, engagement } = useEngagement("apartment", feed.items, user?.id ?? null);
  const inset = useMemo(() => listInset(topInset), [topInset]);
  // Tapping Explore again while Room is on screen: back to the top.
  const listRef = useRef<FlatList<ApartmentWithOwner>>(null);
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);
  const tabBar = useTabBarInset();

  return (
    <View style={{ flex: 1 }}>
      <AnimatedFlatList
        ref={listRef}
        data={feed.items}
        keyExtractor={(a) => a.id}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 90 + tabBar, paddingTop: inset.paddingTop }}
        renderItem={({ item: a }) => (
          <PostCard
            targetType="apartment"
            targetId={a.id}
            path={`/apartments/${a.id}`}
            poster={{ id: a.owner.id, name: a.owner.full_name, avatarUrl: a.owner.avatar_url, verified: isVerifiedPoster(a.owner) }}
            subtitle={[a.distance_km !== null ? `${formatDistance(a.distance_km)} from campus` : null, a.city].filter(Boolean).join(" · ")}
            title={a.title}
            lead={`${formatPrice(a.price_per_month, a.currency)}/mo · ${a.bedrooms === 0 ? "Studio" : `${a.bedrooms} bd`} · ${a.bathrooms} ba`}
            description={a.description}
            media={listingMedia(a.images, a.image_meta, a.videos)}
            createdAt={a.created_at}
            saved={savedIds.has(a.id)}
            engagement={engagement[a.id]}
            details={
              <>
                {a.furnished ? <Badge label="Furnished" tone="blue" /> : null}
                {a.utilities_included ? <Badge label="Utilities included" tone="green" /> : null}
                {a.pets_allowed ? <Badge label="Pets OK" /> : null}
              </>
            }
          />
        )}
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <View style={{ paddingHorizontal: FEED_HEADER_PADDING }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View> : <EmptyState icon={filtered || q ? "search-outline" : "home-outline"} title={filtered || q ? "No apartments match" : "No apartments yet"} body={filtered ? "Try fewer filters." : q ? "Try another word." : "Be the first to list a place."} />}
        ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={{ textAlign: "center", color: colors.faint, padding: 12 }}>Loading more…</Text> : null}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refreshWithHaptic(feed.refresh)} progressViewOffset={inset.progressViewOffset} />}
      />
    </View>
  );
}
