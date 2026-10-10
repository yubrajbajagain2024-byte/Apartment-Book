import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getOrCreateDirectConversation, reportContent, sharedPostFromListing, timeAgo, type FeedMedia, type PostEngagement, type ReportReason, type PostTargetType, type SharedPost, REPORT_REASONS } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useActionSheet } from "./action-sheet";
import { Avatar } from "./avatar";
import { EngagementBar, EngagementSummary, useLike, useSave } from "./engagement";
import { PhotoCarousel } from "./photo-carousel";
import { firstImageOf, useShareSheet } from "./share-sheet";

export type PostCardProps = {
  targetType: PostTargetType;
  targetId: string;
  /** Web path, e.g. /roommates/abc, used for sharing and for opening the detail screen. */
  path: string;
  poster: { id: string; name: string; avatarUrl: string | null; verified: boolean };
  subtitle?: string;
  /** Listings have a title; Home-feed posts do not. */
  title?: string;
  lead?: string;
  description?: string | null;
  media: FeedMedia[];
  createdAt: string;
  saved: boolean;
  engagement?: PostEngagement;
  /** Extra chips under the text. */
  details?: React.ReactNode;
  active?: boolean;
};

const LIMIT = 140;
/** The band between two full-width cards in a feed (each card has a hairline top and bottom, so they stay apart on white). */
export const FEED_GAP = 8;
/** Side padding for a feed's header (search, chips, composer): the cards themselves have none. */
export const FEED_HEADER_PADDING = 12;

/**
 * Facebook-style post: header → title/description → media → counts → Like / Comment / Message.
 * The card has no side margins and no rounded corners: it spans the whole screen so photos and videos touch both edges.
 * Feeds separate cards with an 8px band (FEED_GAP) and must not add horizontal padding around them.
 */
export function PostCard(props: PostCardProps) {
  const { poster, title, lead, description, media, createdAt, path } = props;
  const colors = useColors();
  const styles = useStyles();
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const { user } = useSession();
  const [expanded, setExpanded] = useState(false);
  const needLogin = () => router.push("/(auth)/login");
  const like = useLike(props.targetType, props.targetId, props.engagement, user?.id ?? null, needLogin);
  const save = useSave(props.targetType, props.targetId, props.saved, user?.id ?? null, needLogin);
  const text = description?.trim() ?? "";
  const long = text.length > LIMIT;
  const own = user?.id === poster.id;

  const openDetail = (focusComments = false) => router.push({ pathname: path as never, params: focusComments ? { comment: "1" } : {} } as never);

  async function message() {
    if (!user) return needLogin();
    if (own) return router.push("/messages");
    try {
      const id = await getOrCreateDirectConversation(supabase, poster.id);
      router.push({ pathname: "/messages/[id]", params: { id, prefill: title ? `Hi ${poster.name.split(" ")[0]}! I saw your post "${title}" and I'd like to chat.` : `Hi ${poster.name.split(" ")[0]}! I saw your post and I'd like to chat.`, ...(props.targetType === "post" ? {} : { targetType: props.targetType, targetId: props.targetId }) } });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not open the chat");
    }
  }

  /** The friends sheet, with the card's title, price line (or description) and first picture; its "Share to…" row is the system share as before. */
  function share() {
    const author = { id: poster.id, name: poster.name, avatar_url: poster.avatarUrl };
    const imageUrl = firstImageOf(media);
    const caption = lead || text || null;
    const shared: SharedPost =
      props.targetType === "post"
        ? { target_type: "post", target_id: props.targetId, kind: "post", path, title: null, caption, image_url: imageUrl, author }
        : sharedPostFromListing({ targetType: props.targetType, targetId: props.targetId, title: title ?? poster.name, caption, imageUrl, author });
    shareSheet.open(shared, { url: `${SITE_URL}${path}`, label: title ?? "Apartment Book" });
  }

  function report() {
    if (!user) return needLogin();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: async () => {
          await reportContent(supabase, user.id, { targetType: props.targetType, targetId: props.targetId, reason: r.value as ReportReason }).catch(() => {});
          alert("Thanks. Our team will review this post.");
        },
      })),
      "Why are you reporting this post?",
    );
  }

  function menu() {
    show([
      { label: save.saved ? "Unsave post" : "Save post", icon: save.saved ? "bookmark" : "bookmark-outline", onPress: () => void save.toggle() },
      { label: "Share post", icon: "share-outline", onPress: share },
      ...(own ? [] : [{ label: "Report post", icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  return (
    <View style={styles.card} accessibilityLabel={`Post: ${title ?? description?.slice(0, 40) ?? "post"}`}>
      <View style={styles.header}>
        <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: poster.id } })}>
          <Avatar name={poster.name} url={poster.avatarUrl} size="md" userId={poster.id} ringColor={colors.card} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.name} numberOfLines={1}>
              {poster.name}
            </Text>
            {poster.verified ? <Ionicons name="checkmark-circle" size={15} color={colors.brand} accessibilityLabel="Verified student" /> : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {timeAgo(createdAt)}
            {props.subtitle ? ` · ${props.subtitle}` : ""}
          </Text>
        </View>
        <Pressable onPress={menu} hitSlop={8} accessibilityLabel="Post options" accessibilityRole="button" style={styles.dots}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <Pressable onPress={() => openDetail()} style={styles.body}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {lead ? <Text style={styles.lead}>{lead}</Text> : null}
        {text ? (
          <Text style={styles.description}>
            {expanded || !long ? text : `${text.slice(0, LIMIT).trimEnd()}… `}
            {long && !expanded ? (
              <Text style={{ color: colors.muted, fontWeight: "600" }} onPress={() => setExpanded(true)}>
                more
              </Text>
            ) : null}
          </Text>
        ) : null}
        {props.details ? <View style={styles.details}>{props.details}</View> : null}
      </Pressable>

      {media.length > 0 ? <PhotoCarousel media={media} onPress={() => openDetail()} active={props.active} videoLabel={props.targetType === "post" ? null : undefined} /> : null}
      <EngagementSummary likes={like.likes} comments={props.engagement?.comments ?? 0} onComments={() => openDetail(true)} />
      <EngagementBar liked={like.liked} likes={like.likes} onLike={() => void like.toggle()} onComment={() => openDetail(true)} onMessage={() => void message()} messageLabel={own ? "Inbox" : "Message"} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { width: "100%", backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingBottom: 6 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  meta: { fontSize: 12, color: colors.muted },
  dots: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  body: { paddingHorizontal: 12, paddingBottom: 12, gap: 3 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  lead: { fontSize: 14, fontWeight: "700", color: colors.brand },
  description: { fontSize: 15, color: colors.text, lineHeight: 21 },
  details: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6 },
}));
