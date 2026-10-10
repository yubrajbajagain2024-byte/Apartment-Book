import { useEffect, useRef, useState } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { captionParts, compactCount, deleteFeedPost, getOrCreateDirectConversation, isVerifiedPoster, listingMedia, reportContent, REPORT_REASONS, setPostPinned, sharedPostFromFeedPost, timeAgo, type FeedMedia, type FeedPostWithAuthor, type PostEngagement, type PostPreview, type ReportReason } from "@apartment-book/shared";
import { hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { emitPostPinned, onPostPinned } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";
import { useActionSheet } from "../action-sheet";
import { Avatar } from "../avatar";
import { useLike, useSave } from "../engagement";
import { PhotoCarousel } from "../photo-carousel";
import { useShareSheet } from "../share-sheet";

export type InstaPostProps = {
  post: FeedPostWithAuthor;
  saved: boolean;
  engagement?: PostEngagement;
  /** Faces for "Liked by …" and the newest comment. */
  preview?: PostPreview;
  /** Live comment count; falls back to the engagement numbers. */
  comments?: number;
  /** Small grey line under the name, e.g. the university. */
  subtitle?: string;
  /** Videos only play while this is true. */
  active?: boolean;
  /** The post's own screen: whole caption, no comment preview (the thread is right below). */
  detail?: boolean;
  onComments: () => void;
  onDeleted?: () => void;
};

const CAPTION_LIMIT = 110;
const LIKE_RED = "#ed4956";
const TAG_BLUE = "#00376b";
const TALLEST = 4 / 5;
const WIDEST = 1.91;

/** Instagram shows a photo in its own shape, but never taller than 4:5 or wider than 1.91:1. */
function frameAspect(media: FeedMedia[], reel: boolean): number {
  if (reel) return 9 / 16;
  const first = media[0];
  if (!first?.width || !first.height) return TALLEST;
  return Math.min(WIDEST, Math.max(TALLEST, first.width / first.height));
}

/**
 * Instagram-style post: avatar and name → photo or video from edge to edge → slide dots → heart, comment, share and bookmark →
 * "Liked by …" → caption → comments → age. No card box and no grey band: posts simply follow each other.
 */
export function InstaPost({ post, saved, engagement, preview, subtitle, active, detail, onComments, onDeleted, ...props }: InstaPostProps) {
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const { user } = useSession();
  const needLogin = () => router.push("/(auth)/login");
  const like = useLike("post", post.id, engagement, user?.id ?? null, needLogin);
  const save = useSave("post", post.id, saved, user?.id ?? null, needLogin);
  const [expanded, setExpanded] = useState(Boolean(detail));
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

  function doubleTap() {
    if (!like.liked) void like.toggle();
    heart.setValue(0);
    Animated.sequence([
      Animated.spring(heart, { toValue: 1, useNativeDriver: true, friction: 5, tension: 140 }),
      Animated.delay(350),
      Animated.timing(heart, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }

  /** A words-only post has no photo to double tap, so the text takes the gesture (its heart is the one in the row below). */
  function textTap() {
    const now = Date.now();
    if (now - lastTextTap.current < 260) {
      lastTextTap.current = 0;
      if (!like.liked) void like.toggle();
    } else lastTextTap.current = now;
  }

  /** Instagram's share sheet: send it to friends as a chat card, or "Share to…" the link with the system sheet. */
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
      { label: `Share ${noun}`, icon: "paper-plane-outline", onPress: share },
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

  const long = text.length > CAPTION_LIMIT || text.split("\n").length > 3;
  const shownText = expanded || !long ? text : `${text.slice(0, CAPTION_LIMIT).split("\n").slice(0, 3).join("\n").trimEnd()}… `;
  const caption = captionParts(shownText).map((part, i) =>
    part.tag ? (
      <Text key={i} style={styles.tag}>
        {part.text}
      </Text>
    ) : (
      part.text
    ),
  );
  const more =
    long && !expanded ? (
      <Text style={styles.more} onPress={() => setExpanded(true)} accessibilityRole="button">
        more
      </Text>
    ) : null;

  return (
    <View style={styles.post} accessibilityLabel={`Post: ${text.slice(0, 40) || `by ${author.full_name}`}`}>
      <View style={styles.header}>
        <Pressable onPress={() => openProfile(author.id)} accessibilityLabel={`${author.full_name}'s profile`}>
          <Avatar name={author.full_name} url={author.avatar_url} size="sm" userId={author.id} />
        </Pressable>
        {/* Labelled with the name alone: the verified icon would otherwise join the label and hide the name from assistive tech (and Maestro). */}
        <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => openProfile(author.id)} accessibilityRole="button" accessibilityLabel={author.full_name}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.name} numberOfLines={1}>
              {author.full_name}
            </Text>
            {isVerifiedPoster(author) ? <Ionicons name="checkmark-circle" size={14} color={colors.brand} accessibilityLabel="Verified student" /> : null}
          </View>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </Pressable>
        <Pressable onPress={menu} hitSlop={10} accessibilityLabel="Post options" accessibilityRole="button" style={styles.dots}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
        </Pressable>
      </View>

      {media.length > 0 ? (
        <View>
          <PhotoCarousel media={media} aspect={frameAspect(media, reel)} active={active} videoLabel={null} dots={false} onIndexChange={setSlide} onDoubleTap={doubleTap} />
          <Animated.View pointerEvents="none" style={[styles.heart, { opacity: heart, transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>
            <Ionicons name="heart" size={96} color="#fff" />
          </Animated.View>
        </View>
      ) : text ? (
        // Words only: the text is the post.
        <Pressable onPress={textTap} style={styles.textOnly}>
          <Text style={styles.textOnlyBody} selectable={detail}>
            {caption}
            {more}
          </Text>
        </Pressable>
      ) : null}

      {/* Instagram puts the slide dots on their own line under the photo, above the hearts. */}
      {media.length > 1 ? (
        <View style={styles.slideDots} accessibilityLabel={`${slide + 1} of ${media.length}`}>
          {media.map((_, i) => (
            <View key={i} style={[styles.slideDot, i === slide && styles.slideDotActive]} />
          ))}
        </View>
      ) : null}

      <View style={[styles.actions, media.length > 1 && { paddingTop: 6 }]}>
        <Pressable onPress={() => void like.toggle()} hitSlop={6} style={styles.action} accessibilityRole="button" accessibilityLabel={like.liked ? "Unlike" : "Like"} accessibilityState={{ selected: like.liked }}>
          <Ionicons name={like.liked ? "heart" : "heart-outline"} size={28} color={like.liked ? LIKE_RED : colors.text} />
          {like.likes > 0 ? <Text style={styles.count}>{compactCount(like.likes)}</Text> : null}
        </Pressable>
        <Pressable onPress={onComments} hitSlop={6} style={styles.action} accessibilityRole="button" accessibilityLabel="Comment">
          <Ionicons name="chatbubble-outline" size={26} color={colors.text} style={styles.flip} />
          {comments > 0 ? <Text style={styles.count}>{compactCount(comments)}</Text> : null}
        </Pressable>
        <Pressable onPress={share} hitSlop={6} style={styles.action} accessibilityRole="button" accessibilityLabel="Share">
          <Ionicons name="paper-plane-outline" size={26} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => void save.toggle()} hitSlop={6} accessibilityRole="button" accessibilityLabel={save.saved ? "Unsave" : "Save"} accessibilityState={{ selected: save.saved }}>
          <Ionicons name={save.saved ? "bookmark" : "bookmark-outline"} size={26} color={colors.text} />
        </Pressable>
      </View>

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

        {media.length > 0 && text ? (
          <Text style={styles.line} selectable={detail}>
            <Text style={styles.bold} onPress={() => openProfile(author.id)}>
              {author.full_name}
            </Text>{" "}
            {caption}
            {more}
          </Text>
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

        <Text style={styles.age}>{timeAgo(post.created_at)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  post: { width: "100%", backgroundColor: colors.card, paddingBottom: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  name: { fontSize: 14, fontWeight: "700", color: colors.text, flexShrink: 1 },
  subtitle: { fontSize: 12, color: colors.text, marginTop: 1 },
  dots: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  heart: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } },
  textOnly: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4 },
  textOnlyBody: { fontSize: 16, lineHeight: 22, color: colors.text },
  slideDots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 10 },
  slideDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#c7c7cc" },
  slideDotActive: { backgroundColor: colors.brand },
  actions: { flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  flip: { transform: [{ scaleX: -1 }] },
  count: { fontSize: 14, fontWeight: "600", color: colors.text },
  below: { paddingHorizontal: 12, gap: 4 },
  likedBy: { flexDirection: "row", alignItems: "center", gap: 6 },
  face: { borderWidth: 1.5, borderColor: colors.card, borderRadius: 12 },
  line: { fontSize: 14, lineHeight: 19, color: colors.text, flexShrink: 1 },
  bold: { fontWeight: "700" },
  tag: { color: TAG_BLUE },
  more: { color: colors.muted },
  viewAll: { fontSize: 14, color: colors.muted },
  age: { fontSize: 12, color: colors.muted, marginTop: 1 },
});
