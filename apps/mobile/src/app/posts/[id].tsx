import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteFeedPost, getFeedPost, getOrCreateDirectConversation, getPostEngagement, isSaved, isVerifiedPoster, listingMedia, recordView, reportContent, REPORT_REASONS, timeAgo, type FeedPostWithAuthor, type PostEngagement, type ReportReason } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { Avatar } from "@/components/avatar";
import { Comments } from "@/components/comments";
import { EngagementBar, EngagementSummary, useLike, useSave } from "@/components/engagement";
import { PhotoCarousel } from "@/components/photo-carousel";
import { Badge, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { markReelsStale } from "@/components/home/reels-section";
import { useQuery } from "@/lib/hooks";
import { emitPostRemoved } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

export default function PostScreen() {
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const { user } = useSession();
  const { data, loading, error, refresh } = useQuery(async () => {
    const post = await getFeedPost(supabase, id);
    if (!post) return null;
    const [engagement, saved] = await Promise.all([getPostEngagement(supabase, "post", id).catch(() => NO_ENGAGEMENT), user ? isSaved(supabase, user.id, "post", id).catch(() => false) : Promise.resolve(false)]);
    recordView(supabase, "post", id).catch(() => {});
    return { post, engagement, saved };
  }, [id, user?.id]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <View style={{ padding: 16 }}><ErrorBanner message={error} onRetry={refresh} /></View>;
  if (!data) return <EmptyState icon="newspaper-outline" title="This post is no longer available" />;
  return <PostDetail key={`${data.post.id}:${user?.id ?? "guest"}`} post={data.post} engagement={data.engagement} saved={data.saved} focusComments={comment === "1"} />;
}

function PostDetail({ post, engagement, saved, focusComments }: { post: FeedPostWithAuthor; engagement: PostEngagement; saved: boolean; focusComments: boolean }) {
  const { user } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const needLogin = () => router.push("/(auth)/login");
  const like = useLike("post", post.id, engagement, user?.id ?? null, needLogin);
  const save = useSave("post", post.id, saved, user?.id ?? null, needLogin);
  const [comments, setComments] = useState(engagement.comments);
  const scroll = useRef<ScrollView>(null);
  const commentsY = useRef(0);
  const author = post.author;
  const own = user?.id === author.id;
  const isReel = post.kind === "reel";
  const noun = isReel ? "reel" : "post";
  const path = `/posts/${post.id}`;
  const media = listingMedia(post.images, post.image_meta, post.videos);
  const text = post.body?.trim() ?? "";

  async function message() {
    if (!user) return needLogin();
    if (own) return router.push("/(tabs)/messages");
    try {
      const id = await getOrCreateDirectConversation(supabase, author.id);
      router.push({ pathname: "/messages/[id]", params: { id, prefill: `Hi ${author.full_name.split(" ")[0]}! I saw your ${noun} and I'd like to chat.` } });
    } catch (e) {
      Alert.alert("Message", e instanceof Error ? e.message : "Could not open the chat");
    }
  }

  function report() {
    if (!user) return needLogin();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: () => {
          reportContent(supabase, user.id, { targetType: "post", targetId: post.id, reason: r.value as ReportReason }).catch(() => {});
          Alert.alert("Thanks", `Our team will review this ${noun}.`);
        },
      })),
      `Why are you reporting this ${noun}?`,
    );
  }

  function remove() {
    Alert.alert(`Delete this ${noun}?`, "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          deleteFeedPost(supabase, post.id)
            .then(() => {
              // Home drops it straight away: Posts removes the card, Reels reloads next time it is opened.
              if (isReel) markReelsStale();
              else emitPostRemoved(post.id);
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)");
            })
            .catch((e) => Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again")),
      },
    ]);
  }

  function menu() {
    show([
      { label: save.saved ? `Unsave ${noun}` : `Save ${noun}`, icon: save.saved ? "bookmark" : "bookmark-outline", onPress: () => void save.toggle() },
      { label: `Share ${noun}`, icon: "share-outline", onPress: () => void Share.share({ message: `${author.full_name} on Apartment Book · ${SITE_URL}${path}`, url: `${SITE_URL}${path}` }) },
      ...(own ? [{ label: `Delete ${noun}`, icon: "trash-outline" as const, destructive: true, onPress: remove }] : [{ label: `Report ${noun}`, icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  return (
    <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={styles.card}>
        <View style={styles.header}>
          <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: author.id } })}>
            <Avatar name={author.full_name} url={author.avatar_url} size="md" userId={author.id} />
          </Pressable>
          <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push({ pathname: "/profile/[id]", params: { id: author.id } })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={styles.name} numberOfLines={1}>
                {author.full_name}
              </Text>
              {isVerifiedPoster(author) ? <Ionicons name="checkmark-circle" size={15} color={colors.brand} accessibilityLabel="Verified student" /> : null}
            </View>
            <Text style={styles.meta}>{timeAgo(post.created_at)}</Text>
          </Pressable>
          {isReel ? <Badge label="Reel" tone="blue" /> : null}
          <Pressable onPress={menu} hitSlop={8} accessibilityLabel="Post options" accessibilityRole="button" style={styles.dots}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
          </Pressable>
        </View>
        {text ? (
          <Text style={styles.body} selectable>
            {text}
          </Text>
        ) : null}
        {media.length > 0 ? <PhotoCarousel media={media} aspect={isReel ? 9 / 16 : 4 / 5} videoLabel={null} /> : null}
        <EngagementSummary likes={like.likes} comments={comments} />
        <EngagementBar liked={like.liked} likes={like.likes} onLike={() => void like.toggle()} onComment={() => (user ? scroll.current?.scrollTo({ y: commentsY.current, animated: true }) : needLogin())} onMessage={() => void message()} messageLabel={own ? "Inbox" : "Message"} />
      </View>
      <View style={[styles.card, { padding: 16 }]} onLayout={(e) => (commentsY.current = e.nativeEvent.layout.y)}>
        <Comments targetType="post" targetId={post.id} ownerId={author.id} autoFocus={focusComments} onCountChange={(d) => setComments((n) => Math.max(0, n + d))} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, marginTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingBottom: 8 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  meta: { fontSize: 12, color: colors.muted },
  dots: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  body: { fontSize: 16, lineHeight: 23, color: colors.text, paddingHorizontal: 12, paddingBottom: 12 },
});
