import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, type ViewToken } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { forYouKey, listForYou, type BuzzPost, type FeedPostWithAuthor, type ForYouItem } from "@apartment-book/shared";
import { CommentsSheet, type CommentsTarget } from "@/components/comments-sheet";
import { FEED_HEADER_PADDING } from "@/components/post-card";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useHomeScope } from "@/lib/home-scope";
import { errorText } from "@/lib/hooks";
import { emitPostRemoved, onPostRemoved, takeForYouStale } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";
import { useEngagement, usePostPreviews } from "@/lib/use-engagement";
import { BUZZ_GUTTER, BuzzCard, emitBuzzEvent, onBuzzEvent } from "./buzz-card";
import { InstaPost } from "./insta-post";
import { markReelsStale } from "./reels-section";

/** Replaces one Buzz thread in the blended list; posts and the other threads are left alone. */
function patchBuzz(items: ForYouItem[], id: string, patch: (post: BuzzPost) => BuzzPost): ForYouItem[] {
  return items.map((i) => (i.type === "buzz" && i.post.id === id ? { type: "buzz", post: patch(i.post) } : i));
}

/** Drops one row by kind and id: a post and a Buzz thread are different tables, so an id alone is not enough. */
function drop(items: ForYouItem[], type: ForYouItem["type"], id: string): ForYouItem[] {
  return items.filter((i) => i.type !== type || i.post.id !== id);
}

/**
 * Home → For you, the landing page: posts, reels and anonymous Buzz threads blended into one list (listForYou).
 * Rows reuse the Instagram-style post and the Reddit-style Buzz row, so nothing here looks different from its own tab.
 */
export function ForYouSection({ active, topInset }: { active: boolean; topInset: number }) {
  const { user, profile } = useSession();
  const router = useRouter();
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
          // Buzz is ranked by "hot", which can shift between two requests: never show the same thread twice.
          const seen = new Set(prev.map(forYouKey));
          return [...prev, ...result.items.filter((i) => !seen.has(forYouKey(i)))];
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
    // The signed-in user is part of the key: "You" markers and votes on Buzz threads differ per person.
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

  // Likes, saves, "Liked by …" and the newest comment are per post; the Buzz rows carry their own numbers.
  const posts = useMemo(() => items.flatMap((i) => (i.type === "post" ? [i.post] : [])), [items]);
  const { savedIds, engagement } = useEngagement("post", posts, userId);
  const { previews, refresh: refreshPreview } = usePostPreviews("post", posts, userId);
  /** Comments added or deleted in the sheet since the counts were loaded. */
  const [commentDelta, setCommentDelta] = useState<Record<string, number>>({});
  const [commenting, setCommenting] = useState<FeedPostWithAuthor | null>(null);
  const commentsOf = (id: string) => Math.max(0, (engagement[id]?.comments ?? 0) + (commentDelta[id] ?? 0));
  const commentingCount = commenting ? commentsOf(commenting.id) : 0;
  const target = useMemo<CommentsTarget | null>(() => (commenting ? { targetType: "post", targetId: commenting.id, ownerId: commenting.author.id, comments: commentingCount } : null), [commenting, commentingCount]);
  /** Keys of the rows at least 60% on screen: only that reel or video plays. */
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => setVisible(new Set(viewableItems.map((v) => String(v.key))))).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // Coming back to For you keeps the list and the scroll position. It reloads only when something new was published
  // while another page was showing: a post or a reel by this person, or a Buzz thread (its "reload" event).
  const listRef = useRef<FlatList<ForYouItem>>(null);
  const wasActive = useRef(active);
  const reloadLater = useRef(false);
  useEffect(() => {
    // The first load on mount already includes anything posted before.
    takeForYouStale();
  }, []);
  useEffect(() => {
    if (active && !wasActive.current && (takeForYouStale() || reloadLater.current)) {
      reloadLater.current = false;
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      refresh();
    }
    wasActive.current = active;
  }, [active, refresh]);
  // A post deleted on its own screen disappears here without a reload.
  useEffect(() => onPostRemoved((id) => setItems((prev) => drop(prev, "post", id))), []);
  // Things that happened to a thread on its own screen or on the create screen.
  useEffect(
    () =>
      onBuzzEvent((e) => {
        if (e.type === "patch") setItems((prev) => patchBuzz(prev, e.post.id, () => e.post));
        else if (e.type === "vote") setItems((prev) => patchBuzz(prev, e.id, (p) => ({ ...p, score: e.vote.score, myVote: e.vote.myVote })));
        else if (e.type === "remove") setItems((prev) => drop(prev, "buzz", e.id));
        else if (active) refresh();
        else reloadLater.current = true;
      }),
    [active, refresh],
  );

  function closeComments() {
    // The line under the post shows the newest comment: reload it for the post that was open.
    if (commenting) refreshPreview(commenting.id);
    setCommenting(null);
  }

  return (
    <View style={{ flex: 1, paddingTop: topInset, backgroundColor: colors.card }}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={forYouKey}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          error && items.length > 0 ? (
            <View style={styles.banner}>
              <ErrorBanner message={error} onRetry={refresh} />
            </View>
          ) : null
        }
        renderItem={({ item }) =>
          item.type === "buzz" ? (
            <View style={styles.buzz}>
              <View style={styles.buzzLabel}>
                <Ionicons name="eye-off-outline" size={12} color={colors.faint} />
                <Text style={styles.buzzLabelText}>Buzz · anonymous</Text>
              </View>
              {/* The same thread is also on the Buzz page: go through the event bus so both lists change (this one listens too). */}
              <BuzzCard post={item.post} onVote={(v) => emitBuzzEvent({ type: "vote", id: item.post.id, vote: v })} onRemoved={(id) => emitBuzzEvent({ type: "remove", id })} onMuted={() => emitBuzzEvent({ type: "reload" })} />
            </View>
          ) : (
            <InstaPost
              post={item.post}
              saved={savedIds.has(item.post.id)}
              engagement={engagement[item.post.id]}
              preview={previews[item.post.id]}
              comments={commentsOf(item.post.id)}
              // Browsing every campus: say which university the post is from.
              subtitle={universityId ? undefined : (item.post.university?.name ?? undefined)}
              active={active && visible.has(forYouKey(item))}
              onComments={() => (user ? setCommenting(item.post) : router.push("/(auth)/login"))}
              // Posts and Reels list the same row: the event drops it here (see onPostRemoved) and there.
              onDeleted={() => {
                if (item.post.kind === "reel") markReelsStale();
                emitPostRemoved(item.post.id);
              }}
            />
          )
        }
        ListEmptyComponent={
          loading ? (
            <Loading />
          ) : error ? (
            <View style={styles.banner}>
              <ErrorBanner message={error} onRetry={refresh} />
            </View>
          ) : (
            <EmptyState icon="sparkles-outline" title="Nothing here yet" body={universityId ? "Posts, reels and Buzz threads from your campus show up here. Try all universities." : "Posts, reels and Buzz threads from students show up here."} />
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
            <Text style={styles.end}>You're all caught up</Text>
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      />
      <CommentsSheet target={target} onClose={closeComments} onCountChange={(d) => commenting && setCommentDelta((prev) => ({ ...prev, [commenting.id]: (prev[commenting.id] ?? 0) + d }))} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: FEED_HEADER_PADDING, paddingTop: 10 },
  // A Buzz thread between posts keeps Reddit's flat row; the hairlines and the small label say what it is and that it is anonymous.
  buzz: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  buzzLabel: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: BUZZ_GUTTER, paddingTop: 8 },
  buzzLabelText: { fontSize: 11, color: colors.faint },
  retry: { textAlign: "center", color: colors.brand, fontSize: 13, fontWeight: "600" },
  end: { textAlign: "center", color: colors.faint, fontSize: 12, paddingVertical: 12 },
});
