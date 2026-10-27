import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ListViewToken } from "react-native";
import { useIsFocused, useRouter } from "expo-router";
import { listForYou, reelFromFeedPost, videosFor, type FeedPostWithAuthor, type ForYouItem, type PostEngagement } from "@apartment-book/shared";
import { CommentsSheet, type CommentsTarget } from "@/components/comments-sheet";
import { FEED_HEADER_PADDING } from "@/components/post-card";
import { EmptyState, ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { useHomeScope } from "@/lib/home-scope";
import { useTabBarInset } from "@/lib/tab-bar";
import { errorText } from "@/lib/hooks";
import { emitPostRemoved, onPostRemoved, takeForYouStale } from "@/lib/posts-events";
import { entryOf, forYouAfter, openReel, openViewer, viewerItemFromPost, type ViewerEntry, type ViewerOrigin } from "@/lib/reel-viewer";
import type { VideoPlayer } from "expo-video";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useEngagement, usePostPreviews } from "@/lib/use-engagement";
import { CaughtUp } from "./caught-up";
import { InstaPost } from "./insta-post";
import { markReelsStale } from "./reels-section";
import { useTabReselect } from "@/lib/tab-reselect";
import { refreshWithHaptic } from "@/lib/haptics";

/** The list's key: posts and reels share one table, so the id alone tells rows apart. */
const keyOf = (post: ForYouItem) => post.id;

/**
 * How much of the feed stays mounted around the screen: a post is nearly a screen tall and carries photos or a video,
 * so four screens each way (not FlatList's ten) keeps memory and the JS thread free while a fling still never shows a gap.
 */
const WINDOW = { windowSize: 9, initialNumToRender: 3, maxToRenderPerBatch: 4, updateCellsBatchingPeriod: 40 } as const;

/**
 * One row, memoised: scrolling changes which posts are on screen (and so which videos play), and only the rows whose
 * own props changed draw again, not every post in the window. The callbacks take the post, so they stay the same.
 */
const ForYouRow = memo(function ForYouRow({
  item,
  saved,
  engagement,
  preview,
  comments,
  subtitle,
  active,
  onOpenComments,
  onRemoved,
  onOpenViewer,
}: {
  item: ForYouItem;
  saved: boolean;
  engagement: PostEngagement | undefined;
  preview: ReturnType<typeof usePostPreviews>["previews"][string] | undefined;
  comments: number;
  subtitle: string | undefined;
  active: boolean;
  onOpenComments: (item: ForYouItem) => void;
  onRemoved: (item: ForYouItem) => void;
  onOpenViewer: (item: ForYouItem, live: { engagement: PostEngagement; saved: boolean; slide: number; origin?: ViewerOrigin; time: number | null; player: VideoPlayer | null }) => void;
}) {
  return (
    <InstaPost
      post={item}
      saved={saved}
      engagement={engagement}
      preview={preview}
      comments={comments}
      subtitle={subtitle}
      active={active}
      onComments={() => onOpenComments(item)}
      onDeleted={() => onRemoved(item)}
      onOpen={(live) => onOpenViewer(item, live)}
    />
  );
});

/**
 * Home → For you, the landing page: posts and reels blended into one list (listForYou). Rows reuse the Instagram-style
 * post, so nothing here looks different from the Posts section. Anonymous Buzz threads stay on the Buzz page.
 */
export function ForYouSection({ active, topInset, onScroll }: { active: boolean; topInset: number; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
  const { user, profile } = useSession();
  const router = useRouter();
  const colors = useColors();
  const styles = useStyles();
  const userId = user?.id ?? null;
  const [scope] = useHomeScope();
  // The campus is chosen from the dropdown in the top bar; someone without a university sees every campus.
  const chosenUniversity = scope.campus === "all" || !profile?.university_id ? undefined : profile.university_id;
  // Under the full-screen viewer the list stays exactly as it is, the viewer's own Campus | Global toggle included: the
  // row it was opened from (and the player it lent) must still be there, and in place, when it closes. A choice made
  // meanwhile reloads the list once Home is back on screen.
  const homeShown = useIsFocused();
  const [universityId, setUniversityId] = useState(chosenUniversity);
  useEffect(() => {
    if (homeShown) setUniversityId(chosenUniversity);
  }, [homeShown, chosenUniversity]);

  const [items, setItems] = useState<ForYouItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState(false);
  /** The page the list on screen ends with. A ref, so paging on does not re-create `load` and start over from page 1. */
  const page = useRef(1);
  const seq = useRef(0);

  const load = useCallback(
    async (mode: "replace" | "more") => {
      const id = ++seq.current;
      try {
        const result = await listForYou(supabase, { universityId, page: mode === "more" ? page.current + 1 : 1 });
        if (id !== seq.current) return;
        setItems((prev) => {
          if (mode === "replace") return result.items;
          // A post published between two requests shifts every page by one row: never show the same post twice.
          const seen = new Set(prev.map(keyOf));
          return [...prev, ...result.items.filter((p) => !seen.has(p.id))];
        });
        page.current = result.page;
        setHasMore(result.hasMore);
        setError(null);
        setMoreError(false);
      } catch (e) {
        if (id !== seq.current) return;
        // A failed "load more" only shows a retry row at the bottom: the list above is still good.
        if (mode === "more") setMoreError(true);
        else setError(errorText(e, "Could not load your feed. Please try again."));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    // The signed-in user is part of the key: likes, saves and "You" markers differ per person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [universityId, userId],
  );

  useEffect(() => {
    setLoading(true);
    void load("replace");
  }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load("replace");
  }, [load]);

  const fetchMore = useCallback(() => {
    if (loading || refreshing || loadingMore || !hasMore || items.length === 0) return;
    setMoreError(false);
    setLoadingMore(true);
    void load("more");
  }, [load, loading, refreshing, loadingMore, hasMore, items.length]);

  // Scrolling to the end loads the next page. After a failure the person retries with a tap, so a dead connection is not hammered.
  const loadMore = useCallback(() => {
    if (!moreError) fetchMore();
  }, [fetchMore, moreError]);

  // Likes, saves, "Liked by …" and the newest comment, per post (reels are posts too).
  const { savedIds, engagement } = useEngagement("post", items, userId);
  const { previews, refresh: refreshPreview } = usePostPreviews("post", items, userId);
  /** Comments added or deleted in the sheet since the counts were loaded. */
  const [commentDelta, setCommentDelta] = useState<Record<string, number>>({});
  const [commenting, setCommenting] = useState<FeedPostWithAuthor | null>(null);
  const commentsOf = (id: string) => Math.max(0, (engagement[id]?.comments ?? 0) + (commentDelta[id] ?? 0));
  const commentingCount = commenting ? commentsOf(commenting.id) : 0;
  const target = useMemo<CommentsTarget | null>(() => (commenting ? { targetType: "post", targetId: commenting.id, ownerId: commenting.author.id, comments: commentingCount, commentsOff: commenting.comments_off ?? false } : null), [commenting, commentingCount]);
  /** Ids of the rows at least 60% on screen: only that reel or video plays. */
  // One video plays at a time, the first row on screen (at least 60% of it) that has one: sound is one switch for every
  // video, so two playing at once would both be heard.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && videosFor((v.item as ForYouItem).videos).length > 0);
    setPlayingId(first ? String(first.key) : null);
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;
  // The list starts under the floating bar and scrolls beneath it as the bar slides away.
  const inset = useMemo(() => listInset(topInset), [topInset]);
  const tabBar = useTabBarInset();

  // Coming back to For you keeps the list and the scroll position. It reloads only when something new was published
  // while another page was showing: a post or a reel by this person.
  const listRef = useRef<FlatList<ForYouItem>>(null);
  // Rows fade in once as they first arrive (not when scrolled back into view).
  const appearCells = useAppearingCells();
  // Tapping Home again while For you is on screen: back to the top, as on every iOS tab (the bar slides back with it).
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);
  const wasActive = useRef(active);
  useEffect(() => {
    // The first load on mount already includes anything posted before.
    takeForYouStale();
  }, []);
  useEffect(() => {
    if (active && !wasActive.current && takeForYouStale()) {
      listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: false });
      refresh();
    }
    wasActive.current = active;
  }, [active, refresh, inset.topOffset]);
  // A post deleted on its own screen disappears here without a reload.
  useEffect(() => onPostRemoved((id) => setItems((prev) => prev.filter((p) => p.id !== id))), []);

  const openComments = useCallback((item: ForYouItem) => (user ? setCommenting(item) : router.push("/(auth)/login")), [user, router]);
  // Posts and Reels list the same row: the event drops it here (see onPostRemoved) and there.
  const removeRow = useCallback((item: ForYouItem) => {
    if (item.kind === "reel") markReelsStale();
    emitPostRemoved(item.id);
  }, []);

  // The latest list, counts and saves, read when a row is tapped, so the handler can stay the same for the memoised rows.
  const latest = useRef({ items, engagement, savedIds, commentsOf, hasMore });
  latest.current = { items, engagement, savedIds, commentsOf, hasMore };
  /**
   * A tap on a post's photo or video: the viewer opens on it with For you's other posts with pictures around it, in feed
   * order (a swipe up goes on down the feed, its next pages loading as needed). A reel opens on its own, followed by the
   * Reels feed, as it always has. A video goes on from where it had got to here (`live.time`), rather than starting again.
   */
  const openInViewer = useCallback(
    (tapped: ForYouItem, live: { engagement: PostEngagement; saved: boolean; slide: number; origin?: ViewerOrigin; time: number | null; player: VideoPlayer | null }) => {
      // A video opened full screen is the one that plays here when the viewer closes: it lands moving, never paused
      // because another row on screen was first in line.
      if (live.time !== null) setPlayingId(tapped.id);
      if (tapped.kind === "reel") {
        const reel = reelFromFeedPost(tapped, live.engagement, live.saved);
        if (reel) openReel(router, reel, live.origin, live.time ?? undefined, live.player ?? undefined);
        return;
      }
      const { items: list, engagement: counts, savedIds: saved, commentsOf: commentCount, hasMore: more } = latest.current;
      const entries: ViewerEntry[] = [];
      let index = -1;
      for (const p of list) {
        const isTapped = p.id === tapped.id;
        const e = isTapped ? live.engagement : { likes: counts[p.id]?.likes ?? 0, comments: commentCount(p.id), likedByMe: counts[p.id]?.likedByMe ?? false };
        const item = viewerItemFromPost(p, e, isTapped ? live.saved : saved.has(p.id));
        if (!item) continue;
        if (isTapped) index = entries.length;
        entries.push(entryOf(item, isTapped ? live.slide : undefined, isTapped ? (live.time ?? undefined) : undefined, isTapped ? (live.player ?? undefined) : undefined));
      }
      if (index < 0) return;
      openViewer(router, {
        entries,
        index,
        origin: live.origin,
        then: {
          more: forYouAfter({ universityId, userId, page: page.current, hasMore: more, seen: new Set(list.map((p) => p.id)) }),
          // The other campus choice in the viewer: For you's feed for it, from its first page.
          rescope: (nextUniversity, seen) => forYouAfter({ universityId: nextUniversity, userId, page: 0, hasMore: true, seen }),
        },
      });
    },
    [router, universityId, userId],
  );

  function closeComments() {
    // The line under the post shows the newest comment: reload it for the post that was open.
    if (commenting) refreshPreview(commenting.id);
    setCommenting(null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AnimatedFlatList
        ref={listRef}
        data={items}
        keyExtractor={keyOf}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Room under the last post for the floating bottom bar.
        contentContainerStyle={{ paddingBottom: 96 + tabBar, paddingTop: inset.paddingTop }}
        ListHeaderComponent={
          error && items.length > 0 ? (
            <View style={styles.banner}>
              <ErrorBanner message={error} onRetry={refresh} />
            </View>
          ) : undefined
        }
        CellRendererComponent={appearCells}
        {...WINDOW}
        renderItem={({ item }) => (
          <ForYouRow
            item={item}
            saved={savedIds.has(item.id)}
            engagement={engagement[item.id]}
            preview={previews[item.id]}
            comments={commentsOf(item.id)}
            // Browsing every campus: say which university the post is from.
            subtitle={universityId ? undefined : (item.university?.name ?? undefined)}
            active={active && playingId === item.id}
            onOpenComments={openComments}
            onRemoved={removeRow}
            onOpenViewer={openInViewer}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <Loading />
          ) : error ? (
            <View style={styles.banner}>
              <ErrorBanner message={error} onRetry={refresh} />
            </View>
          ) : (
            <EmptyState icon="sparkles-outline" title="Nothing here yet" body={universityId ? "Posts and reels from your campus show up here. Try all universities." : "Posts and reels from students show up here."} />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.brand} style={{ paddingVertical: 12 }} />
          ) : moreError ? (
            <Pressable onPress={fetchMore} accessibilityRole="button" style={{ paddingVertical: 12 }}>
              <Text style={styles.retry}>Could not load more. Tap to try again.</Text>
            </Pressable>
          ) : !hasMore && items.length > 0 ? (
            <CaughtUp />
          ) : undefined
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(refresh)} progressViewOffset={inset.progressViewOffset} />}
      />
      <CommentsSheet target={target} onClose={closeComments} onCountChange={(d) => commenting && setCommentDelta((prev) => ({ ...prev, [commenting.id]: (prev[commenting.id] ?? 0) + d }))} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  banner: { paddingHorizontal: FEED_HEADER_PADDING, paddingTop: 10 },
  retry: { textAlign: "center", color: colors.brand, fontSize: 13, fontWeight: "600" },
}));
