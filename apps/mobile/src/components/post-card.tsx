import { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getOrCreateDirectConversation, reportContent, timeAgo, type FeedMedia, type PostEngagement, type ReportReason, type SavedTargetType, REPORT_REASONS } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { useActionSheet } from "./action-sheet";
import { Avatar } from "./avatar";
import { EngagementBar, EngagementSummary, useLike, useSave } from "./engagement";
import { PhotoCarousel } from "./photo-carousel";

export type PostCardProps = {
  targetType: SavedTargetType;
  targetId: string;
  /** Web path, e.g. /roommates/abc, used for sharing and for opening the detail screen. */
  path: string;
  poster: { id: string; name: string; avatarUrl: string | null; verified: boolean };
  subtitle?: string;
  title: string;
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

/** Facebook-style post: header → title/description → media → counts → Like / Comment / Message. */
export function PostCard(props: PostCardProps) {
  const { poster, title, lead, description, media, createdAt, path } = props;
  const router = useRouter();
  const show = useActionSheet();
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
    if (own) return router.push("/(tabs)/messages");
    try {
      const id = await getOrCreateDirectConversation(supabase, poster.id);
      router.push({ pathname: "/messages/[id]", params: { id, prefill: `Hi ${poster.name.split(" ")[0]}! I saw your post "${title}" and I'd like to chat.`, targetType: props.targetType, targetId: props.targetId } });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not open the chat");
    }
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
      { label: "Share post", icon: "share-outline", onPress: () => void Share.share({ message: `${title} · ${SITE_URL}${path}`, url: `${SITE_URL}${path}` }) },
      ...(own ? [] : [{ label: "Report post", icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  return (
    <View style={styles.card} accessibilityLabel={`Post: ${title}`}>
      <View style={styles.header}>
        <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: poster.id } })}>
          <Avatar name={poster.name} url={poster.avatarUrl} size="md" userId={poster.id} />
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
        <Text style={styles.title}>{title}</Text>
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

      {media.length > 0 ? <PhotoCarousel media={media} onPress={() => openDetail()} active={props.active} /> : null}
      <EngagementSummary likes={like.likes} comments={props.engagement?.comments ?? 0} onComments={() => openDetail(true)} />
      <EngagementBar liked={like.liked} likes={like.likes} onLike={() => void like.toggle()} onComment={() => openDetail(true)} onMessage={() => void message()} messageLabel={own ? "Inbox" : "Message"} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingBottom: 6 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  meta: { fontSize: 12, color: colors.muted },
  dots: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  body: { paddingHorizontal: 12, paddingBottom: 12, gap: 3 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  lead: { fontSize: 14, fontWeight: "700", color: colors.brand },
  description: { fontSize: 15, color: colors.text, lineHeight: 21 },
  details: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6 },
});
