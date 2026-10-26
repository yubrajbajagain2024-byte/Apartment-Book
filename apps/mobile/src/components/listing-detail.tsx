import { type ReactNode, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getOrCreateDirectConversation, inquiryPrefill, startListingConversation, getPostEngagement, hasPublicComments, listingChatPrefill, recordContact, recordView, reportContent, REPORT_REASONS, sharedPostFromListing, type FeedMedia, type PostEngagement, type ReportReason, type SavedTargetType } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { radius, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useActionSheet } from "./action-sheet";
import { Avatar } from "./avatar";
import { Comments } from "./comments";
import { EngagementBar, EngagementSummary, useLike, useSave } from "./engagement";
import { PhotoCarousel } from "./photo-carousel";
import { PostActions } from "./post-bits";
import { firstImageOf, useShareSheet } from "./share-sheet";
import { useQuery } from "@/lib/hooks";
import { Badge, Button } from "./ui";
import { Icon } from "@/components/icon";

/**
 * Shared detail layout: media, title, facts, body, poster card, then like / comment / message and the comment thread.
 * A roommate post has no public comments (see hasPublicComments): it carries the Posts action bar instead, Like with its
 * count, Share, the Inbox pill that opens a private chat with the poster, and Save at the far right, right under its
 * photos (under its words when it has none).
 */
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
  aurora = false,
}: {
  targetType: SavedTargetType;
  targetId: string;
  title: string;
  lead?: string;
  media: FeedMedia[];
  /** `badge` and `businessId`: a listing posted from the business portal. The business is the poster (no profile to open) and Message opens its inquiry chat. */
  poster: { id: string; name: string; avatarUrl: string | null; badge?: string | null; businessId?: string | null };
  createdAt: string;
  facts?: ReactNode;
  children?: ReactNode;
  focusComments?: boolean;
  ownerActions?: ReactNode;
  /**
   * The Aurora look (a roommate post): the sections sit on the page itself instead of grey cards, divided by hairlines,
   * so the screen's few Aurora accents (its preference panels, its status pill, its headings) carry the colour.
   */
  aurora?: boolean;
}) {
  const colors = useColors();
  const baseStyles = useStyles();
  const styles = aurora ? { ...baseStyles, section: [baseStyles.section, baseStyles.sectionOnPage] } : baseStyles;
  const { user } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const path = `/${targetType === "apartment" ? "apartments" : targetType === "item" ? "marketplace" : "roommates"}/${targetId}`;
  const needLogin = () => router.push("/(auth)/login");
  const { data: engagement, setData } = useQuery(() => getPostEngagement(supabase, targetType, targetId).catch((): PostEngagement => ({ likes: 0, comments: 0, likedByMe: false })), [targetType, targetId]);
  const { data: savedInitial } = useQuery(async () => (user ? (await import("@apartment-book/shared")).isSaved(supabase, user.id, targetType, targetId) : false), [user?.id, targetType, targetId]);
  const like = useLike(targetType, targetId, engagement ?? undefined, user?.id ?? null, needLogin);
  const save = useSave(targetType, targetId, savedInitial ?? false, user?.id ?? null, needLogin);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const engagementY = useRef(0);
  /** Bring the likes row, the comment thread and its composer to the top of the screen. */
  const showThread = () => scroll.current?.scrollTo({ y: engagementY.current, animated: true });
  const own = user?.id === poster.id;
  const publicComments = hasPublicComments(targetType);
  useQuery(() => recordView(supabase, targetType, targetId).catch(() => {}), [targetType, targetId]);

  async function message() {
    if (!user) return needLogin();
    if (own) return router.push("/messages");
    try {
      const business = poster.businessId && targetType === "apartment" ? poster.businessId : null;
      const id = business ? await startListingConversation(supabase, { targetType, targetId, posterId: poster.id, businessId: business }) : await getOrCreateDirectConversation(supabase, poster.id);
      recordContact(supabase, targetType, targetId).catch(() => {});
      const prefill = business ? inquiryPrefill(poster.name, title) : publicComments ? `Hi ${poster.name.split(" ")[0]}! I saw "${title}" and I'd like to chat.` : listingChatPrefill(poster.name, title);
      router.push({ pathname: "/messages/[id]", params: { id, prefill } });
    } catch (e) {
      Alert.alert("Message", e instanceof Error ? e.message : "Could not open the chat");
    }
  }
  /** The friends sheet; its "Share to…" row is the system share with the same link as before. */
  function share() {
    shareSheet.open(sharedPostFromListing({ targetType, targetId, title, caption: lead, imageUrl: firstImageOf(media), author: { id: poster.id, name: poster.name, avatar_url: poster.avatarUrl } }), { url: `${SITE_URL}${path}`, label: title });
  }
  function menu() {
    show([
      { label: save.saved ? "Unsave" : "Save", icon: save.saved ? "bookmark" : "bookmark-outline", onPress: () => void save.toggle() },
      { label: "Share", icon: "share-outline", onPress: share },
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
  // Without public comments: the Posts action bar, the Inbox pill right after Share (your own listing's opens your Inbox).
  const actionBar = publicComments ? null : (
    <View style={styles.actionBar}>
      <PostActions liked={like.liked} likes={like.likes} comments={0} saved={save.saved} onLike={() => void like.toggle()} onShare={share} onSave={() => void save.toggle()} message={{ label: "Inbox", onPress: () => void message() }} messageBeside />
    </View>
  );
  return (
    <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {/* The "Video tour" pill is for apartments, as in the feeds: a roommate post's or an item's video is just a video. */}
      {media.length > 0 ? <PhotoCarousel media={media} aspect={4 / 5} videoLabel={targetType === "apartment" ? undefined : null} /> : null}
      {media.length > 0 ? actionBar : null}
      <View style={styles.section}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {lead ? <Text style={styles.lead}>{lead}</Text> : null}
          </View>
          <Pressable onPress={menu} hitSlop={8} accessibilityRole="button" accessibilityLabel="Options" style={styles.dots}>
            <Icon name="ellipsis-horizontal" size={22} color={colors.muted} />
          </Pressable>
        </View>
        {facts ? <View style={styles.facts}>{facts}</View> : null}
        {children}
      </View>
      {media.length === 0 ? actionBar : null}

      <View style={[styles.section, { paddingVertical: 12 }]}>
        <Pressable disabled={Boolean(poster.badge)} onPress={() => router.push({ pathname: "/profile/[id]", params: { id: poster.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Avatar name={poster.name} url={poster.avatarUrl} size="md" userId={poster.badge ? undefined : poster.id} online={poster.badge ? false : undefined} ringColor={aurora ? colors.bg : colors.card} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: colors.text }}>{poster.name}</Text>
            {poster.badge ? <Badge label={poster.badge} tone={poster.badge === "Business" ? "gray" : poster.badge === "Verified Partner" ? "green" : "blue"} /> : null}
            <Text style={{ fontSize: 12, color: colors.muted }}>Posted {new Date(createdAt).toLocaleDateString()}</Text>
          </View>
          {!own ? <Button title="Message" size="compact" icon="chatbubble-ellipses-outline" onPress={() => void message()} /> : null}
        </Pressable>
        {own && ownerActions ? <View style={{ marginTop: 12 }}>{ownerActions}</View> : null}
      </View>

      {publicComments ? (
        <View style={[styles.section, { paddingHorizontal: 0, paddingVertical: 0 }]} onLayout={(e) => (engagementY.current = e.nativeEvent.layout.y)}>
          <EngagementSummary likes={like.likes} comments={comments} />
          <EngagementBar liked={like.liked} likes={like.likes} onLike={() => void like.toggle()} onComment={showThread} onMessage={() => void message()} messageLabel={own ? "Inbox" : "Message"} />
          <View style={{ padding: 16 }}>
            <Comments
              targetType={targetType}
              targetId={targetId}
              ownerId={poster.id}
              autoFocus={focusComments}
              revealComposer={showThread}
              onCountChange={(d) => {
                setCommentCount((n) => Math.max(0, (n ?? engagement?.comments ?? 0) + d));
                setData((prev) => (prev ? { ...prev, comments: Math.max(0, prev.comments + d) } : prev));
              }}
            />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

/** One line of facts under a listing's title; `accent` draws its icon in the Aurora's ink (a roommate post). */
export function Fact({ icon, label, accent = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; accent?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={icon} size={16} color={accent ? colors.auroraInk : colors.muted} />
      <Text style={{ color: colors.text, fontSize: 14 }}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Hairline top and bottom: on the white light background the 8px gap alone would not separate the sections.
  section: { backgroundColor: colors.card, marginTop: 8, padding: 16, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  // The Aurora look: on the page itself, one hairline between sections instead of a grey card with a gap.
  sectionOnPage: { backgroundColor: colors.bg, marginTop: 0, borderTopWidth: 0 },
  title: { ...textStyle.title2, color: colors.text },
  lead: { fontSize: 17, fontWeight: "700", color: colors.brand, marginTop: 2 },
  dots: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingVertical: 4 },
  // The Posts action bar on the screen itself, as under a post in a feed.
  actionBar: { paddingBottom: 6 },
}));
/**
 * Body text, headings and inset boxes for a detail screen's own content: `const detailStyles = useDetailStyles();` at the top of the screen.
 * The inset box is the grey fill (`input`): the screen background is white in the light theme, so `bg` would hide it on a white section.
 */
export const useDetailStyles = makeStyles((colors) => ({ body: { fontSize: 15, lineHeight: 22, color: colors.text }, h2: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 6 }, card: { backgroundColor: colors.input, borderRadius: radius.md, borderCurve: "continuous", padding: 10 } }));
