import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, Text, View, type ViewToken } from "react-native";
import { useRouter } from "expo-router";
import { listFeedPosts, type FeedPostWithAuthor } from "@apartment-book/shared";
import { CommentsSheet, type CommentsTarget } from "@/components/comments-sheet";
import { FEED_HEADER_PADDING } from "@/components/post-card";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useHomeScope } from "@/lib/home-scope";
import { useFeed } from "@/lib/hooks";
import { emitPostRemoved, onPostRemoved, takePostsStale } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme-provider";
import { useEngagement, usePostPreviews } from "@/lib/use-engagement";
import { InstaPost } from "./insta-post";

/** Home → Posts: Instagram-style posts from students, newest first. The campus and "Following" (only the people you follow) are chosen from the dropdown in the top bar; new posts are made with its "+". */
export function PostsSection({ active, topInset }: { active: boolean; topInset: number }) {
  const { user, profile } = useSession();
  const router = useRouter();
  const colors = useColors();
  const [scope] = useHomeScope();
  // The campus is chosen from the dropdown in the top bar; someone without a university sees every campus.
  const universityId = scope.campus === "all" || !profile?.university_id ? undefined : profile.university_id;
  // Signed out there is nobody you follow (and the menu has no "Following" row), so the filter drops instead of emptying the feed.
  const following = Boolean(user) && scope.following;
  // Following means everyone you follow, whatever their campus (Instagram does the same), so the campus filter steps aside.
  const campusId = following ? undefined : universityId;
  const feed = useFeed<FeedPostWithAuthor>((page) => listFeedPosts(supabase, { universityId: campusId, page, following }), [campusId, following]);
  const { savedIds, engagement } = useEngagement("post", feed.items, user?.id ?? null);
  const { previews, refresh: refreshPreview } = usePostPreviews("post", feed.items, user?.id ?? null);
  /** Comments added or deleted in the sheet since the counts were loaded. */
  const [commentDelta, setCommentDelta] = useState<Record<string, number>>({});
  const [commenting, setCommenting] = useState<FeedPostWithAuthor | null>(null);
  const commentsOf = (id: string) => Math.max(0, (engagement[id]?.comments ?? 0) + (commentDelta[id] ?? 0));
  const commentingCount = commenting ? commentsOf(commenting.id) : 0;
  const target = useMemo<CommentsTarget | null>(() => (commenting ? { targetType: "post", targetId: commenting.id, ownerId: commenting.author.id, comments: commentingCount } : null), [commenting, commentingCount]);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => setVisible(new Set(viewableItems.map((v) => String(v.key))))).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // Coming back to Posts keeps the list and the scroll position. It only reloads when this person has just published a post.
  const listRef = useRef<FlatList<FeedPostWithAuthor>>(null);
  const wasActive = useRef(active);
  const { refresh, setItems } = feed;
  useEffect(() => {
    // The first load on mount already includes anything posted before.
    takePostsStale();
  }, []);
  useEffect(() => {
    if (active && !wasActive.current && takePostsStale()) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      refresh();
    }
    wasActive.current = active;
  }, [active, refresh]);
  // A post deleted on its own screen disappears here without a reload.
  useEffect(() => onPostRemoved((id) => setItems((prev) => prev.filter((p) => p.id !== id))), [setItems]);

  function closeComments() {
    // The line under the post shows the newest comment: reload it for the post that was open.
    if (commenting) refreshPreview(commenting.id);
    setCommenting(null);
  }

  return (
    <View style={{ flex: 1, paddingTop: topInset, backgroundColor: colors.bg }}>
      <FlatList
        ref={listRef}
        data={feed.items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item: p }) => (
          <InstaPost
            post={p}
            saved={savedIds.has(p.id)}
            engagement={engagement[p.id]}
            preview={previews[p.id]}
            comments={commentsOf(p.id)}
            // Browsing every campus: say which university the post is from.
            subtitle={campusId ? undefined : (p.university?.name ?? undefined)}
            active={active && visible.has(p.id)}
            onComments={() => (user ? setCommenting(p) : router.push("/(auth)/login"))}
            // For you lists the same posts: the event drops the row here (see onPostRemoved) and there.
            onDeleted={() => emitPostRemoved(p.id)}
          />
        )}
        ListEmptyComponent={
          feed.loading ? (
            <Loading />
          ) : feed.error ? (
            <View style={{ paddingHorizontal: FEED_HEADER_PADDING }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View>
          ) : following ? (
            <EmptyState icon="people-outline" title="Nothing from the people you follow yet" body="Follow someone from their profile and their posts show up here." />
          ) : (
            <EmptyState icon="newspaper-outline" title="No posts yet" body={following ? "Posts from people you follow show up here." : campusId ? "Say hello to your campus, or switch to all universities." : "Be the first to share something."} />
          )
        }
        ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={{ textAlign: "center", color: colors.faint, padding: 12 }}>Loading more…</Text> : null}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} />}
      />
      <CommentsSheet target={target} onClose={closeComments} onCountChange={(d) => commenting && setCommentDelta((prev) => ({ ...prev, [commenting.id]: (prev[commenting.id] ?? 0) + d }))} />
    </View>
  );
}
