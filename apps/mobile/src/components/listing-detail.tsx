import { type ReactNode, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getOrCreateDirectConversation, getPostEngagement, recordContact, recordView, reportContent, REPORT_REASONS, type FeedMedia, type PostEngagement, type ReportReason, type SavedTargetType } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { useActionSheet } from "./action-sheet";
import { Avatar } from "./avatar";
import { Comments } from "./comments";
import { EngagementBar, EngagementSummary, useLike, useSave } from "./engagement";
import { PhotoCarousel } from "./photo-carousel";
import { useQuery } from "@/lib/hooks";
import { Button } from "./ui";

/** Shared detail layout: media, title, facts, body, poster card, like/comment/message, comments. */
export function ListingDetail({
  targetType,
  targetId,
  title,
  lead,
  media,
  poster,
  createdAt,
  facts,
  children,
  focusComments,
  ownerActions,
}: {
  targetType: SavedTargetType;
  targetId: string;
  title: string;
  lead?: string;
  media: FeedMedia[];
  poster: { id: string; name: string; avatarUrl: string | null };
  createdAt: string;
  facts?: ReactNode;
  children?: ReactNode;
  focusComments?: boolean;
  ownerActions?: ReactNode;
}) {
  const { user } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const path = `/${targetType === "apartment" ? "apartments" : targetType === "item" ? "marketplace" : "roommates"}/${targetId}`;
  const needLogin = () => router.push("/(auth)/login");
  const { data: engagement, setData } = useQuery(() => getPostEngagement(supabase, targetType, targetId).catch((): PostEngagement => ({ likes: 0, comments: 0, likedByMe: false })), [targetType, targetId]);
  const { data: savedInitial } = useQuery(async () => (user ? (await import("@apartment-book/shared")).isSaved(supabase, user.id, targetType, targetId) : false), [user?.id, targetType, targetId]);
  const like = useLike(targetType, targetId, engagement ?? undefined, user?.id ?? null, needLogin);
  const save = useSave(targetType, targetId, savedInitial ?? false, user?.id ?? null, needLogin);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const own = user?.id === poster.id;
  useQuery(() => recordView(supabase, targetType, targetId).catch(() => {}), [targetType, targetId]);

  async function message() {
    if (!user) return needLogin();
    if (own) return router.push("/(tabs)/messages");
    try {
      const id = await getOrCreateDirectConversation(supabase, poster.id);
      recordContact(supabase, targetType, targetId).catch(() => {});
      router.push({ pathname: "/messages/[id]", params: { id, prefill: `Hi ${poster.name.split(" ")[0]}! I saw "${title}" and I'd like to chat.` } });
    } catch (e) {
      Alert.alert("Message", e instanceof Error ? e.message : "Could not open the chat");
    }
  }
  function menu() {
    show([
      { label: save.saved ? "Unsave" : "Save", icon: save.saved ? "bookmark" : "bookmark-outline", onPress: () => void save.toggle() },
      { label: "Share", icon: "share-outline", onPress: () => void Share.share({ message: `${title} · ${SITE_URL}${path}`, url: `${SITE_URL}${path}` }) },
      ...(own
        ? []
        : [
            {
              label: "Report",
              icon: "flag-outline" as const,
              destructive: true,
              onPress: () => {
                if (!user) return needLogin();
                show(
                  REPORT_REASONS.map((r) => ({
                    label: r.label,
                    onPress: () => {
                      reportContent(supabase, user.id, { targetType, targetId, reason: r.value as ReportReason }).catch(() => {});
                      Alert.alert("Thanks", "Our team will review this post.");
                    },
                  })),
                  "Why are you reporting this?",
                );
              },
            },
          ]),
    ]);
  }

  const comments = commentCount ?? engagement?.comments ?? 0;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {media.length > 0 ? <PhotoCarousel media={media} aspect={4 / 5} /> : null}
      <View style={styles.section}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {lead ? <Text style={styles.lead}>{lead}</Text> : null}
          </View>
          <Pressable onPress={menu} hitSlop={8} accessibilityRole="button" accessibilityLabel="Options" style={styles.dots}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.muted} />
          </Pressable>
        </View>
        {facts ? <View style={styles.facts}>{facts}</View> : null}
        {children}
      </View>

      <View style={[styles.section, { paddingVertical: 12 }]}>
        <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: poster.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Avatar name={poster.name} url={poster.avatarUrl} size="md" userId={poster.id} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: colors.text }}>{poster.name}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>Posted {new Date(createdAt).toLocaleDateString()}</Text>
          </View>
          {!own ? <Button title="Message" icon="chatbubble-ellipses-outline" onPress={() => void message()} style={{ minHeight: 38 }} /> : null}
        </Pressable>
        {own && ownerActions ? <View style={{ marginTop: 12 }}>{ownerActions}</View> : null}
      </View>

      <View style={[styles.section, { paddingHorizontal: 0, paddingVertical: 0 }]}>
        <EngagementSummary likes={like.likes} comments={comments} />
        <EngagementBar liked={like.liked} likes={like.likes} onLike={() => void like.toggle()} onComment={() => {}} onMessage={() => void message()} messageLabel={own ? "Inbox" : "Message"} />
        <View style={{ padding: 16 }}>
          <Comments
            targetType={targetType}
            targetId={targetId}
            ownerId={poster.id}
            autoFocus={focusComments}
            onCountChange={(d) => {
              setCommentCount((n) => Math.max(0, (n ?? engagement?.comments ?? 0) + d));
              setData((prev) => (prev ? { ...prev, comments: Math.max(0, prev.comments + d) } : prev));
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}

export function Fact({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Ionicons name={icon} size={16} color={colors.muted} />
      <Text style={{ color: colors.text, fontSize: 14 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.card, marginTop: 8, padding: 16, gap: 10 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  lead: { fontSize: 17, fontWeight: "700", color: colors.brand, marginTop: 2 },
  dots: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingVertical: 4 },
});
export const detailStyles = { body: { fontSize: 15, lineHeight: 22, color: colors.text }, h2: { fontSize: 16, fontWeight: "700" as const, color: colors.text, marginTop: 6 }, card: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 10 } };
