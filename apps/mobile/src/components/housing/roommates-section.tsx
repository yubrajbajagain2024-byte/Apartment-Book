import { memo, useMemo, useRef, useState } from "react";
import { RefreshControl, View, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent, type ListViewToken } from "react-native";
import { budgetLabel, KM_PER_MILE, listRoommatePosts, listingMedia, videosFor, type PostEngagement, type RoommatePostWithAuthor } from "@apartment-book/shared";
import { listingPoster } from "@/lib/listing-poster";
import type { RoommateFilters } from "@/components/housing/filter-sheet";
import { OnlineStrip } from "@/components/online-strip";
import { FEED_HEADER_PADDING, PostCard } from "@/components/post-card";
import { EmptyState, ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useEngagement } from "@/lib/use-engagement";
import { useTabReselect } from "@/lib/tab-reselect";
import { refreshWithHaptic } from "@/lib/haptics";

/** The two kinds of roommate post the "Has a room" and "Looking for a room" pills pick between. */
export type RoommateType = "has_room" | "needs_room";

/**
 * One roommate post, memoised: only a row whose post, save or counts changed draws again as the feed scrolls and loads.
 */
const RoommateRow = memo(function RoommateRow({ p, saved, engagement, playing }: { p: RoommatePostWithAuthor; saved: boolean; engagement: PostEngagement | undefined; playing: boolean }) {
  const budget = budgetLabel(p);
  return (
    <PostCard
      active={playing}
      targetType="roommate"
      targetId={p.id}
      path={`/roommates/${p.id}`}
      poster={listingPoster(p.author)}
      // Everyone here is at the same university: under the name, what kind of post it is instead.
      subtitle={p.post_type === "has_room" ? "Has a Room" : "Looking for a Room"}
      title={p.title}
      // The budget goes on the share card; the post's own page shows it with the place and the dates.
      lead={budget ? `${budget}/mo` : undefined}
      description={p.description}
      // Heart, share, Inbox and the bookmark: no comment button here (the thread is on the post's own screen).
      messageLabel="Inbox"
      messageBeside
      comments={false}
      media={listingMedia(p.images, p.image_meta, p.videos)}
      createdAt={p.created_at}
      saved={saved}
      engagement={engagement}
    />
  );
});

/**
 * The Roommates half of the Explore tab: who is online, then the posts feed, starting `topInset` under the floating labels
 * and pills and reporting its scroll through `onScroll`. The search (`q`), the campus and the kind of post come from the
 * Housing screen's own bar, which also owns the "+" button.
 */
export function RoommatesSection({ topInset, onScroll, q, campus, type, filters, filtered, active = true }: { topInset: number; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void; q: string; campus: "mine" | "all"; type: RoommateType | undefined; filters: RoommateFilters; filtered: boolean; active?: boolean }) {
  const { user, profile } = useSession();
  const universityId = campus === "all" ? undefined : (profile?.university_id ?? undefined);
  // The filter sheet's choices; distance needs a campus to measure from, so it is dropped on "every university".
  const radiusKm = universityId && filters.radiusMiles ? filters.radiusMiles * KM_PER_MILE : undefined;
  const feed = useFeed<RoommatePostWithAuthor>(
    (page) => listRoommatePosts(supabase, { q: q || undefined, universityId, postType: type, page, maxBudget: filters.maxBudget, genderPreference: filters.genderPreference, videoOnly: filters.videoOnly, radiusKm }),
    [q, universityId, type, filters.maxBudget, filters.genderPreference, filters.videoOnly, radiusKm],
  );
  const { savedIds, engagement } = useEngagement("roommate", feed.items, user?.id ?? null);
  const inset = useMemo(() => listInset(topInset), [topInset]);
  // Tapping Explore again while Roommate is on screen: back to the top.
  const listRef = useRef<FlatList<RoommatePostWithAuthor>>(null);
  // Rows fade in once as they first arrive (not when scrolled back into view).
  const appearCells = useAppearingCells();
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);
  // One video tour plays at a time, the first post on screen (at least 60% of it) that has one, and only while this half
  // of Explore is the one shown: sound is one switch for every video, so two playing at once would both be heard.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && videosFor((v.item as RoommatePostWithAuthor).videos).length > 0);
    setPlayingId(first ? String(first.key) : null);
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const tabBar = useTabBarInset();

  return (
    <View style={{ flex: 1 }}>
      <AnimatedFlatList
        ref={listRef}
        data={feed.items}
        keyExtractor={(p) => p.id}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 90 + tabBar, paddingTop: inset.paddingTop }}
        ListHeaderComponent={
          <View style={{ paddingTop: FEED_HEADER_PADDING }}>
            <OnlineStrip />
          </View>
        }
        CellRendererComponent={appearCells}
        renderItem={({ item: p }) => <RoommateRow p={p} saved={savedIds.has(p.id)} engagement={engagement[p.id]} playing={active && playingId === p.id} />}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        windowSize={9}
        initialNumToRender={3}
        maxToRenderPerBatch={4}
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <View style={{ paddingHorizontal: FEED_HEADER_PADDING }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View> : <EmptyState icon={filtered || q ? "search-outline" : "people-outline"} title={filtered || q ? "No roommate posts match" : "No roommate posts yet"} body={filtered ? "Try fewer filters." : q ? "Try another word." : "Be the first to post for your campus."} />}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refreshWithHaptic(feed.refresh)} progressViewOffset={inset.progressViewOffset} />}
      />
    </View>
  );
}
