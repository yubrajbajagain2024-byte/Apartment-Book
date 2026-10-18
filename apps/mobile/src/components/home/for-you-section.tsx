import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from "react-native";
import { useRouter } from "expo-router";
import { listForYou, type FeedPostWithAuthor, type ForYouItem } from "@apartment-book/shared";
import { CommentsSheet, type CommentsTarget } from "@/components/comments-sheet";
import { FEED_HEADER_PADDING } from "@/components/post-card";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { useHomeScope } from "@/lib/home-scope";
import { useTabBarInset } from "@/lib/tab-bar";
import { errorText } from "@/lib/hooks";
import { emitPostRemoved, onPostRemoved, takeForYouStale } from "@/lib/posts-events";
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
  const universityId = scope.campus === "all" || !profile?.university_id ? undefined : profile.university_id;

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
  const target = useMemo<CommentsTarget | null>(() => (commenting ? { targetType: "post", targetId: commenting.id, ownerId: commenting.author.id, comments: commentingCount } : null), [commenting, commentingCount]);
  /** Ids of the rows at least 60% on screen: only that reel or video plays. */
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => setVisible(new Set(viewableItems.map((v) => String(v.key))))).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;
  // The list starts under the floating bar and scrolls beneath it as the bar slides away.
  const inset = useMemo(() => listInset(topInset), [topInset]);
  const tabBar = useTabBarInset();

  // Coming back to For you keeps the list and the scroll position. It reloads only when something new was published
  // while another page was showing: a post or a reel by this person.
  const listRef = useRef<FlatList<ForYouItem>>(null);
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
          ) : null
        }
        renderItem={({ item }) => (
          <InstaPost
            post={item}
            saved={savedIds.has(item.id)}
            engagement={engagement[item.id]}
            preview={previews[item.id]}
            comments={commentsOf(item.id)}
            // Browsing every campus: say which university the post is from.
            subtitle={universityId ? undefined : (item.university?.name ?? undefined)}
            active={active && visible.has(item.id)}
            onComments={() => (user ? setCommenting(item) : router.push("/(auth)/login"))}
            // Posts and Reels list the same row: the event drops it here (see onPostRemoved) and there.
            onDeleted={() => {
              if (item.kind === "reel") markReelsStale();
              emitPostRemoved(item.id);
            }}
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
          ) : null
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
