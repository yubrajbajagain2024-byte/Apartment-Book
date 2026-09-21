import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View, type ViewToken } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { isVerifiedPoster, listFeedPosts, listingMedia, type FeedPostWithAuthor } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { FEED_GAP, FEED_HEADER_PADDING, PostCard } from "@/components/post-card";
import { Chip, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useFeed } from "@/lib/hooks";
import { onPostRemoved, takePostsStale } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { useEngagement } from "@/lib/use-engagement";

/** Home → Posts: Facebook-style posts from students, newest first. */
export function PostsSection({ active, topInset }: { active: boolean; topInset: number }) {
  const { user, profile } = useSession();
  const router = useRouter();
  const [allCampuses, setAllCampuses] = useState(false);
  const universityId = allCampuses ? undefined : (profile?.university_id ?? undefined);
  const feed = useFeed<FeedPostWithAuthor>((page) => listFeedPosts(supabase, { universityId, page }), [universityId]);
  const { savedIds, engagement } = useEngagement("post", feed.items, user?.id ?? null);
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

  const compose = () => router.push((user ? "/create/post" : "/(auth)/login") as never);

  return (
    <View style={{ flex: 1, paddingTop: topInset }}>
      <FlatList
        ref={listRef}
        data={feed.items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ gap: FEED_GAP, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ gap: 8, paddingHorizontal: FEED_HEADER_PADDING, paddingTop: FEED_HEADER_PADDING, paddingBottom: 4 }}>
            <Pressable onPress={compose} style={styles.composer} accessibilityRole="button" accessibilityLabel="Create a post">
              {user ? <Avatar name={profile?.full_name} url={profile?.avatar_url} size="md" online={false} /> : <Ionicons name="person-circle-outline" size={40} color={colors.faint} />}
              <View style={styles.composerInput}>
                <Text style={{ color: colors.muted, fontSize: 15 }}>What's on your mind?</Text>
              </View>
              <Ionicons name="images-outline" size={22} color={colors.green} />
            </Pressable>
            {profile?.university_id ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Chip label={allCampuses ? "All universities" : (profile.university?.name ?? "My campus")} icon="school-outline" active={!allCampuses} onPress={() => setAllCampuses((v) => !v)} />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item: p }) => (
          <PostCard
            targetType="post"
            targetId={p.id}
            path={`/posts/${p.id}`}
            poster={{ id: p.author.id, name: p.author.full_name, avatarUrl: p.author.avatar_url, verified: isVerifiedPoster(p.author) }}
            description={p.body}
            media={listingMedia(p.images, p.image_meta, p.videos)}
            createdAt={p.created_at}
            saved={savedIds.has(p.id)}
            engagement={engagement[p.id]}
            active={active && visible.has(p.id)}
          />
        )}
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <View style={{ paddingHorizontal: FEED_HEADER_PADDING }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View> : <EmptyState icon="newspaper-outline" title="No posts yet" body={universityId ? "Say hello to your campus, or switch to all universities." : "Be the first to share something."} />}
        ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={{ textAlign: "center", color: colors.faint, padding: 12 }}>Loading more…</Text> : null}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: radius.lg, padding: 12 },
  composerInput: { flex: 1, height: 40, borderRadius: radius.pill, backgroundColor: colors.input, justifyContent: "center", paddingHorizontal: 14 },
});
