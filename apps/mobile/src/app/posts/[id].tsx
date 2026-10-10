import { useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getFeedPost, getPostEngagement, getPostPreviewsMany, isSaved, recordView, type FeedPostWithAuthor, type PostEngagement, type PostPreview } from "@apartment-book/shared";
import { Comments } from "@/components/comments";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { InstaPost } from "@/components/home/insta-post";
import { markReelsStale } from "@/components/home/reels-section";
import { useQuery } from "@/lib/hooks";
import { emitPostRemoved } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";

const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

export default function PostScreen() {
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const { user } = useSession();
  const { data, loading, error, refresh } = useQuery(async () => {
    const post = await getFeedPost(supabase, id);
    if (!post) return null;
    const [engagement, saved, previews] = await Promise.all([
      getPostEngagement(supabase, "post", id).catch(() => NO_ENGAGEMENT),
      user ? isSaved(supabase, user.id, "post", id).catch(() => false) : Promise.resolve(false),
      getPostPreviewsMany(supabase, "post", [id]).catch(() => ({}) as Record<string, PostPreview>),
    ]);
    recordView(supabase, "post", id).catch(() => {});
    return { post, engagement, saved, preview: previews[id] };
  }, [id, user?.id]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <View style={{ padding: 16 }}><ErrorBanner message={error} onRetry={refresh} /></View>;
  if (!data) return <EmptyState icon="newspaper-outline" title="This post is no longer available" />;
  return <PostDetail key={`${data.post.id}:${user?.id ?? "guest"}`} post={data.post} engagement={data.engagement} saved={data.saved} preview={data.preview} focusComments={comment === "1"} />;
}

function PostDetail({ post, engagement, saved, preview, focusComments }: { post: FeedPostWithAuthor; engagement: PostEngagement; saved: boolean; preview?: PostPreview; focusComments: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const { user } = useSession();
  const router = useRouter();
  const [comments, setComments] = useState(engagement.comments);
  const scroll = useRef<ScrollView>(null);
  const commentsY = useRef(0);
  /** Bring the thread, composer first, to the top of the screen. */
  const showThread = () => scroll.current?.scrollTo({ y: commentsY.current, animated: true });

  function deleted() {
    // Home drops it straight away: Posts and For you remove the post (For you shows reels too), Reels reloads next time it is opened.
    if (post.kind === "reel") markReelsStale();
    emitPostRemoved(post.id);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }

  return (
    <ScrollView ref={scroll} style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <InstaPost
        post={post}
        saved={saved}
        engagement={engagement}
        preview={preview}
        comments={comments}
        subtitle={post.university?.name}
        detail
        onComments={() => (user ? showThread() : router.push("/(auth)/login"))}
        onDeleted={deleted}
      />
      <View style={styles.thread} onLayout={(e) => (commentsY.current = e.nativeEvent.layout.y)}>
        <Comments targetType="post" targetId={post.id} ownerId={post.author.id} autoFocus={focusComments} revealComposer={showThread} onCountChange={(d) => setComments((n) => Math.max(0, n + d))} />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  thread: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
}));
