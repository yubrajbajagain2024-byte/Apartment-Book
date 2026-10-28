import { useMemo, useRef, useState } from "react";
import { RefreshControl, Text, View, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent, type ListViewToken } from "react-native";
import { ADS_EVERY, interleaveAds, KM_PER_MILE, listApartments, videosFor, type ApartmentWithOwner } from "@apartment-book/shared";
import { SponsoredCard } from "@/components/ads/sponsored-card";
import { isAdRow, useAdImpressions, useFeedAds, type AdRow } from "@/lib/use-feed-ads";
import type { RoomFilters } from "@/components/housing/filter-sheet";
import { HousingCard } from "@/components/housing/housing-card";
import { FEED_HEADER_PADDING } from "@/components/post-card";
import { EmptyState, ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useColors } from "@/lib/theme-provider";
import { useEngagement } from "@/lib/use-engagement";
import { useTabReselect } from "@/lib/tab-reselect";
import { refreshWithHaptic } from "@/lib/haptics";

/** The room between two cards, YouTube style. */
function CardGap() {
  return <View style={{ height: 12 }} />;
}

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
  // Tapping Explore again while Housing is on screen: back to the top.
  const listRef = useRef<FlatList<ApartmentWithOwner | AdRow>>(null);
  // Housing ads (only housing ads run here) between the listings, at most one per ADS_EVERY.
  const ads = useFeedAds("housing", feed.items.length, Boolean(user));
  const rows = useMemo<(ApartmentWithOwner | AdRow)[]>(() => interleaveAds(feed.items, ads, ADS_EVERY).map((r) => (r.kind === "ad" ? { id: `ad-${r.ad.id}`, ad: r.ad } : r.item)), [feed.items, ads]);
  const countAds = useAdImpressions("housing");
  const countAdsRef = useRef(countAds);
  // Rows fade in once as they first arrive (not when scrolled back into view).
  const appearCells = useAppearingCells();
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);
  // One video tour plays at a time, the first listing on screen (at least 60% of it) that has one, and only while this
  // half of Explore is the one shown: sound is one switch for every video, so two playing at once would both be heard.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && !isAdRow(v.item) && videosFor((v.item as ApartmentWithOwner).videos).length > 0);
    setPlayingId(first ? String(first.key) : null);
    countAdsRef.current(viewableItems);
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const tabBar = useTabBarInset();

  return (
    <View style={{ flex: 1 }}>
      <AnimatedFlatList
        ref={listRef}
        data={rows}
        keyExtractor={(a) => a.id}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 90 + tabBar, paddingTop: inset.paddingTop }}
        CellRendererComponent={appearCells}
        renderItem={({ item: a }) => (isAdRow(a) ? <SponsoredCard ad={a.ad} placement="housing" /> : <HousingCard apartment={a} saved={savedIds.has(a.id)} engagement={engagement[a.id]} playing={active && playingId === a.id} />)}
        ItemSeparatorComponent={CardGap}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        windowSize={9}
        initialNumToRender={3}
        maxToRenderPerBatch={4}
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <View style={{ paddingHorizontal: FEED_HEADER_PADDING }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View> : <EmptyState icon={filtered || q ? "search-outline" : "home-outline"} title={filtered || q ? "No apartments match" : "No apartments yet"} body={filtered ? "Try fewer filters." : q ? "Try another word." : "Be the first to list a place."} />}
        ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={{ textAlign: "center", color: colors.faint, padding: 12 }}>Loading more…</Text> : undefined}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refreshWithHaptic(feed.refresh)} progressViewOffset={inset.progressViewOffset} />}
      />
    </View>
  );
}
