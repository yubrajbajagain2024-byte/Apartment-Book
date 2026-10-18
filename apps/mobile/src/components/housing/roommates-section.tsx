import { useMemo, useRef } from "react";
import { RefreshControl, View, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { budgetLabel, formatDate, formatDistance, isVerifiedPoster, KM_PER_MILE, listRoommatePosts, listingMedia, type RoommatePostWithAuthor } from "@apartment-book/shared";
import type { RoommateFilters } from "@/components/housing/filter-sheet";
import { OnlineStrip } from "@/components/online-strip";
import { FEED_HEADER_PADDING, PostCard } from "@/components/post-card";
import { EmptyState, ErrorBanner, FeedSkeleton, Tag, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useEngagement } from "@/lib/use-engagement";
import { refreshWithHaptic } from "@/lib/haptics";
import { useTabReselect } from "@/lib/tab-reselect";

/** The two kinds of roommate post the "Has a room" and "Looking for a room" pills pick between. */
export type RoommateType = "has_room" | "needs_room";

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
  const appearCells = useAppearingCells();
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);
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
        renderItem={({ item: p }) => {
          const budget = budgetLabel(p);
          return (
            <PostCard
              targetType="roommate"
              targetId={p.id}
              path={`/roommates/${p.id}`}
              poster={{ id: p.author.id, name: p.author.full_name, avatarUrl: p.author.avatar_url, verified: isVerifiedPoster(p.author) }}
              subtitle={[p.university?.name, p.distance_km !== null ? `${formatDistance(p.distance_km)} from campus` : null].filter(Boolean).join(" · ")}
              title={p.title}
              lead={budget ? `${budget}/mo` : undefined}
              description={p.description}
              // The description stays behind "more…" until it is wanted: the title, the budget and the chips say enough.
              descriptionLines={0}
              // Heart, share, Inbox and the bookmark: no comment button here (the thread is on the post's own screen).
              messageLabel="Inbox"
              messageBeside
              comments={false}
              media={listingMedia(p.images, p.image_meta, p.videos)}
              createdAt={p.created_at}
              saved={savedIds.has(p.id)}
              engagement={engagement[p.id]}
              // Hairline capsules: the kind of post in ink, then where and when in grey. The pin is the app's vector icon,
              // not an emoji, which differs between phones.
              details={
                <>
                  <Tag label={p.post_type === "has_room" ? "Has a room" : "Looking for a room"} strong />
                  {p.location ? <Tag icon="location-outline" label={p.location} /> : null}
                  {p.move_in_date ? <Tag icon="calendar-outline" label={`Move in ${formatDate(p.move_in_date)}`} /> : null}
                </>
              }
            />
          );
        }}
        // While the first page loads the feed keeps its shape: two posts drawn as grey blocks, no spinner.
        ListEmptyComponent={feed.loading ? <FeedSkeleton rows={2} /> : feed.error ? <View style={{ paddingHorizontal: FEED_HEADER_PADDING }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View> : <EmptyState icon={filtered || q ? "search-outline" : "people-outline"} title={filtered || q ? "No roommate posts match" : "No roommate posts yet"} body={filtered ? "Try fewer filters." : q ? "Try another word." : "Be the first to post for your campus."} />}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refreshWithHaptic(feed.refresh)} progressViewOffset={inset.progressViewOffset} />}
      />
    </View>
  );
}
