import { useEffect, useRef, useState } from "react";
import { Alert, Animated, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { captionParts, compactCount, deleteFeedPost, getOrCreateDirectConversation, isVerifiedPoster, listingMedia, reelFromFeedPost, reportContent, REPORT_REASONS, setPostPinned, sharedPostFromFeedPost, type FeedMedia, type FeedPostWithAuthor, type PostEngagement, type PostPreview, type ReportReason } from "@apartment-book/shared";
import { hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { emitPostPinned, onPostPinned } from "@/lib/posts-events";
import { openReel } from "@/lib/reel-viewer";
import { useSession } from "@/lib/session";
import { shortDate } from "@/lib/short-date";
import { SITE_URL, supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useActionSheet } from "../action-sheet";
import { Avatar } from "../avatar";
import { useLike, useSave } from "../engagement";
import { ExpandableText } from "../expandable-text";
import { PhotoCarousel } from "../photo-carousel";
import { POST_GUTTER, POST_TEXT, PostActions, PostFrame, PostHeader } from "../post-bits";
import { useShareSheet } from "../share-sheet";

export type InstaPostProps = {
  post: FeedPostWithAuthor;
  saved: boolean;
  engagement?: PostEngagement;
  /** Faces for "Liked by …" and the newest comment. */
  preview?: PostPreview;
  /** Live comment count; falls back to the engagement numbers. */
  comments?: number;
  /** Small grey line under the name, e.g. the university; the date joins it after a dot. */
  subtitle?: string;
  /** Videos only play while this is true. */
  active?: boolean;
  /** The post's own screen: the whole caption with no fold, no comment preview (the thread is right below). */
  detail?: boolean;
  onComments: () => void;
  onDeleted?: () => void;
};

const TALLEST = 4 / 5;
const WIDEST = 1.91;

/** A photo keeps its own shape, but never taller than 4:5 or wider than 1.91:1. */
function frameAspect(media: FeedMedia[], reel: boolean): number {
  if (reel) return 9 / 16;
  const first = media[0];
  if (!first?.width || !first.height) return TALLEST;
  return Math.min(WIDEST, Math.max(TALLEST, first.width / first.height));
}

/**
 * A post in the Home feed, laid out like every other post in the app (see post-bits): header → the caption folded to
 * three lines ("more…" / "less") → the photo or video in a rounded frame (a carousel's slide dots on their own row under
 * it) → heart, comment and share with their counts, the bookmark on the right → "Liked by …" → the newest comments.
 */
export function InstaPost({ post, saved, engagement, preview, subtitle, active, detail, onComments, onDeleted, ...props }: InstaPostProps) {
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const { user } = useSession();
  const colors = useColors();
  const styles = useStyles();
  const needLogin = () => router.push("/(auth)/login");
  const like = useLike("post", post.id, engagement, user?.id ?? null, needLogin);
  const save = useSave("post", post.id, saved, user?.id ?? null, needLogin);
  const [slide, setSlide] = useState(0);
  /** Pinned to the top of the author's profile (three at most). Rows read before migration 18 have no pinned_at at all. */
  const [pinned, setPinned] = useState(Boolean(post.pinned_at));
  useEffect(() => setPinned(Boolean(post.pinned_at)), [post.pinned_at]);
  // Pinned from the profile grid (or another copy of this post) while this one is on screen.
  useEffect(() => onPostPinned((id, next) => id === post.id && setPinned(next)), [post.id]);
  const heart = useRef(new Animated.Value(0)).current;
  const lastTextTap = useRef(0);

  const author = post.author;
  const own = user?.id === author.id;
  const reel = post.kind === "reel";
  const noun = reel ? "reel" : "post";
  const path = `/posts/${post.id}`;
  const media = listingMedia(post.images, post.image_meta, post.videos);
  const text = post.body?.trim() ?? "";
  const comments = props.comments ?? engagement?.comments ?? 0;
  const openProfile = (id: string) => router.push({ pathname: "/profile/[id]", params: { id } });
  // "Texas State University · Oct 2", or just the date.
  const meta = [subtitle, shortDate(post.created_at)].filter(Boolean).join(" · ");

  function doubleTap() {
    if (!like.liked) void like.toggle();
    heart.setValue(0);
    Animated.sequence([
      Animated.spring(heart, { toValue: 1, useNativeDriver: true, friction: 5, tension: 140 }),
      Animated.delay(350),
      Animated.timing(heart, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }

  /**
   * A tap on a reel in the feed opens it full screen in the Reels viewer, like Instagram, handing over the row's own
   * counts (which may be ahead of the feed's after a tap here) so it shows at once; from there a swipe up moves on to
   * other reels. On the reel's own screen there is nothing to open.
   */
  function openViewer() {
    const asReel = reelFromFeedPost(post, { likes: like.likes, comments, likedByMe: like.liked }, save.saved);
    if (asReel) openReel(router, asReel);
  }

  /** A words-only post has no photo to double tap, so the text takes the gesture (its heart is the one in the row below). */
  function textTap() {
    const now = Date.now();
    if (now - lastTextTap.current < 260) {
      lastTextTap.current = 0;
      if (!like.liked) void like.toggle();
    } else lastTextTap.current = now;
  }

  /** The share sheet: send it to friends as a chat card, or "Share to…" the link with the system sheet. */
  const share = () => shareSheet.open(sharedPostFromFeedPost(post, media), { url: `${SITE_URL}${path}`, label: `${author.full_name} on Apartment Book` });

  async function message() {
    if (!user) return needLogin();
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
            .then(() => onDeleted?.())
            .catch((e) => Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again")),
      },
    ]);
  }

  /** Your own post or reel: pin it to the top of your profile, or unpin it. The profile grids hear about it straight away. */
  async function togglePin() {
    const next = !pinned;
    setPinned(next);
    try {
      await setPostPinned(supabase, post.id, next);
      hapticTap();
      emitPostPinned(post.id, next);
    } catch (e) {
      setPinned(!next);
      Alert.alert(next ? "Could not pin" : "Could not unpin", errorText(e));
    }
  }

  function menu() {
    show([
      { label: save.saved ? `Unsave ${noun}` : `Save ${noun}`, icon: save.saved ? "bookmark" : "bookmark-outline", onPress: () => void save.toggle() },
      { label: `Share ${noun}`, icon: "share-outline", onPress: share },
      ...(own
        ? [
            { label: pinned ? "Unpin from profile" : "Pin to profile", icon: pinned ? ("pin" as const) : ("pin-outline" as const), onPress: () => void togglePin() },
            { label: `Delete ${noun}`, icon: "trash-outline" as const, destructive: true, onPress: remove },
          ]
        : [
            { label: `Message ${author.full_name.split(" ")[0]}`, icon: "chatbubble-ellipses-outline" as const, onPress: () => void message() },
            { label: `Report ${noun}`, icon: "flag-outline" as const, destructive: true, onPress: report },
          ]),
    ]);
  }

  // "Liked by Maya and 11 others": somebody other than the viewer, newest first.
  const face = preview?.likers.find((l) => l.id !== user?.id);
  const faces = (preview?.likers ?? []).filter((l) => l.id !== user?.id).slice(0, 3);
  const others = like.likes - 1;

  const caption = captionParts(text).map((part, i) =>
    part.tag ? (
      <Text key={i} style={styles.tag}>
        {part.text}
      </Text>
    ) : (
      part.text
    ),
  );

  return (
    <View style={styles.post} accessibilityLabel={`Post: ${text.slice(0, 40) || `by ${author.full_name}`}`}>
      <PostHeader name={author.full_name} avatarUrl={author.avatar_url} userId={author.id} verified={isVerifiedPoster(author)} meta={meta} onOpen={() => openProfile(author.id)} onMenu={menu} />

      {text ? (
        // The words come before the picture, Facebook style. Words only: the text is the post, and takes the double tap.
        <Pressable onPress={media.length === 0 ? textTap : undefined} style={styles.body}>
          <ExpandableText style={styles.text} expanded={detail} collapsible={!detail} selectable={detail}>
            {caption}
          </ExpandableText>
        </Pressable>
      ) : null}

      {media.length > 0 ? (
        <PostFrame>
          <PhotoCarousel media={media} aspect={frameAspect(media, reel)} active={active} videoLabel={null} dots={false} onIndexChange={setSlide} onPress={reel && !detail ? openViewer : undefined} onDoubleTap={doubleTap} />
          <Animated.View pointerEvents="none" style={[styles.heart, { opacity: heart, transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>
            <Ionicons name="heart" size={96} color={colors.onMedia} />
          </Animated.View>
        </PostFrame>
      ) : null}

      {/* A carousel's slide dots on their own line under the photo, above the hearts. */}
      {media.length > 1 ? (
        <View style={styles.slideDots} accessibilityLabel={`${slide + 1} of ${media.length}`}>
          {media.map((_, i) => (
            <View key={i} style={[styles.slideDot, i === slide && styles.slideDotActive]} />
          ))}
        </View>
      ) : null}

      <PostActions liked={like.liked} likes={like.likes} comments={comments} saved={save.saved} onLike={() => void like.toggle()} onComment={onComments} onShare={share} onSave={() => void save.toggle()} tight={media.length > 1} />

      {(face && like.likes > 0) || (!detail && comments > 0) ? (
        <View style={styles.below}>
          {face && like.likes > 0 ? (
            <View style={styles.likedBy}>
              <View style={{ flexDirection: "row" }}>
                {faces.map((l, i) => (
                  <View key={l.id} style={[styles.face, i > 0 && { marginLeft: -7 }]}>
                    <Avatar name={l.name} url={l.avatarUrl} size="xs" online={false} />
                  </View>
                ))}
              </View>
              <Text style={styles.line} numberOfLines={1}>
                Liked by{" "}
                <Text style={styles.bold} onPress={() => openProfile(face.id)}>
                  {face.name}
                </Text>
                {others > 0 ? (
                  <>
                    {" "}
                    and <Text style={styles.bold}>{others === 1 ? "1 other" : `${compactCount(others)} others`}</Text>
                  </>
                ) : null}
              </Text>
            </View>
          ) : null}

          {!detail && comments > 1 ? (
            <Pressable onPress={onComments} accessibilityRole="button">
              <Text style={styles.viewAll}>View all {compactCount(comments)} comments</Text>
            </Pressable>
          ) : null}
          {!detail && comments > 0 && preview?.lastComment ? (
            <Pressable onPress={onComments}>
              <Text style={styles.line} numberOfLines={2}>
                <Text style={styles.bold}>{preview.lastComment.author.full_name}</Text> {preview.lastComment.body}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  post: { width: "100%", backgroundColor: colors.bg, paddingTop: 4, paddingBottom: 18 },
  body: { paddingHorizontal: POST_GUTTER, paddingTop: 2, paddingBottom: 12 },
  text: { ...POST_TEXT, color: colors.text },
  heart: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } },
  slideDots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 10 },
  slideDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.faint },
  slideDotActive: { backgroundColor: colors.accent },
  below: { paddingHorizontal: POST_GUTTER, paddingTop: 6, gap: 4 },
  likedBy: { flexDirection: "row", alignItems: "center", gap: 6 },
  face: { borderWidth: 1.5, borderColor: colors.bg, borderRadius: 12 },
  line: { fontSize: 14, lineHeight: 19, color: colors.text, flexShrink: 1 },
  bold: { fontWeight: "700" },
  // Hashtags in the brand blue: a dark navy would vanish on the dark theme.
  tag: { color: colors.hashtag },
  viewAll: { fontSize: 14, color: colors.muted },
}));
