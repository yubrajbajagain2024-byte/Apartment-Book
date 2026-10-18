import { Children, Fragment, isValidElement, type ReactNode, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getOrCreateDirectConversation, getPostEngagement, recordContact, recordView, reportContent, REPORT_REASONS, sharedPostFromListing, type FeedMedia, type PostEngagement, type ReportReason, type SavedTargetType } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { space, type } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useActionSheet } from "./action-sheet";
import { Avatar } from "./avatar";
import { Comments } from "./comments";
import { EngagementBar, EngagementSummary, useLike, useSave } from "./engagement";
import { PhotoCarousel } from "./photo-carousel";
import { firstImageOf, useShareSheet } from "./share-sheet";
import { useQuery } from "@/lib/hooks";
import { Button, Eyebrow, Skeleton } from "./ui";

/**
 * Shared detail layout, one continuous surface with hairlines between its parts: the photos, then the title and price in
 * the serif with the facts in a hairline grid under them and the screen's own words, the poster with a small Message
 * button, and the likes, the action row and the comment thread.
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
  const colors = useColors();
  const styles = useStyles();
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
  const scroll = useRef<ScrollView>(null);
  const engagementY = useRef(0);
  /** Bring the likes row, the comment thread and its composer to the top of the screen. */
  const showThread = () => scroll.current?.scrollTo({ y: engagementY.current, animated: true });
  const own = user?.id === poster.id;
  useQuery(() => recordView(supabase, targetType, targetId).catch(() => {}), [targetType, targetId]);

  async function message() {
    if (!user) return needLogin();
    if (own) return router.push("/messages");
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
      {
        label: "Share",
        icon: "share-outline",
        // The friends sheet; its "Share to…" row is the system share with the same link as before.
        onPress: () =>
          shareSheet.open(sharedPostFromListing({ targetType, targetId, title, caption: lead, imageUrl: firstImageOf(media), author: { id: poster.id, name: poster.name, avatar_url: poster.avatarUrl } }), { url: `${SITE_URL}${path}`, label: title }),
      },
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
    <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: space.xxl + space.sm }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {media.length > 0 ? <PhotoCarousel media={media} aspect={4 / 5} /> : null}
      <View style={styles.section}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={styles.title}>{title}</Text>
            {lead ? <Text style={styles.lead}>{lead}</Text> : null}
          </View>
          <Pressable onPress={menu} hitSlop={8} accessibilityRole="button" accessibilityLabel="Options" style={({ pressed }) => [styles.dots, pressed && { opacity: 0.7 }]}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.muted} />
          </Pressable>
        </View>
        {facts ? <FactGrid>{facts}</FactGrid> : null}
        {children}
      </View>

      <View style={styles.section}>
        <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: poster.id } })} style={({ pressed }) => [styles.poster, pressed && { opacity: 0.7 }]}>
          <Avatar name={poster.name} url={poster.avatarUrl} size="md" userId={poster.id} ringColor={colors.bg} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.posterName} numberOfLines={1}>
              {poster.name}
            </Text>
            <Text style={styles.posterMeta}>Posted {new Date(createdAt).toLocaleDateString()}</Text>
          </View>
          {!own ? <Button title="Message" icon="chatbubble-ellipses-outline" size="sm" onPress={() => void message()} /> : null}
        </Pressable>
        {/* Your own listing: its quiet actions (Mark as sold, Delete) side by side under your name. */}
        {own && ownerActions ? <View style={styles.ownerActions}>{ownerActions}</View> : null}
      </View>

      <View onLayout={(e) => (engagementY.current = e.nativeEvent.layout.y)}>
        <EngagementSummary likes={like.likes} comments={comments} />
        <EngagementBar liked={like.liked} likes={like.likes} onLike={() => void like.toggle()} onComment={showThread} onMessage={() => void message()} messageLabel={own ? "Inbox" : "Message"} />
        <View style={{ padding: space.lg }}>
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
    </ScrollView>
  );
}

/**
 * A listing's facts two to a row in a hairline grid: a rule above, one between the rows, a vertical hairline between the
 * columns. Children that render nothing are dropped before the rows are made, so a missing fact never leaves a hole.
 */
export function FactGrid({ children }: { children: ReactNode }) {
  const styles = useDetailStyles();
  const cells = flattenCells(children);
  const rows: ReactNode[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  if (rows.length === 0) return null;
  return (
    <View style={styles.grid}>
      {rows.map((row, i) => (
        <View key={i} style={styles.gridRow}>
          {row.map((cell, j) => (
            <View key={j} style={[styles.gridCell, j > 0 && styles.gridCellRight]}>
              {cell}
            </View>
          ))}
          {row.length === 1 ? <View style={[styles.gridCell, styles.gridCellRight]} /> : null}
        </View>
      ))}
    </View>
  );
}

/** The grid's cells: callers hand the facts over inside a fragment (`<>…</>`), so fragments are opened up and nulls dropped. */
function flattenCells(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) => (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? flattenCells(child.props.children) : [child]));
}

/** The shape of a listing while it loads: the photo's frame and the first lines of words as grey blocks, no spinner. */
export function DetailSkeleton() {
  const { width } = useWindowDimensions();
  return (
    <View accessibilityLabel="Loading" style={{ flex: 1 }}>
      <Skeleton height={Math.round((width * 5) / 4)} style={{ borderRadius: 0 }} />
      <View style={{ padding: space.lg, gap: space.md }}>
        <Skeleton width="72%" height={22} />
        <Skeleton width="38%" height={18} />
        <View style={{ flexDirection: "row", gap: space.lg, marginTop: space.sm }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="40%" height={10} />
            <Skeleton width="70%" height={14} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="40%" height={10} />
            <Skeleton width="60%" height={14} />
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * One cell of the facts grid. With an `eyebrow` ("Bedrooms", "Condition") the fact reads as a tracked label over its
 * value, the editorial way; without one the icon stands in for the label beside the value.
 */
export function Fact({ icon, label, eyebrow }: { icon: keyof typeof Ionicons.glyphMap; label: string; eyebrow?: string }) {
  const styles = useDetailStyles();
  const colors = useColors();
  return (
    <View style={{ gap: space.xxs }}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {eyebrow ? null : <Ionicons name={icon} size={16} color={colors.muted} />}
        <Text style={[styles.cellValue, { flexShrink: 1 }]} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Each part of the screen on the screen's own surface, a hairline under it; the words keep the posts' gutter.
  section: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  // The title and the price in the serif of titles and big numbers, the price a step smaller.
  title: { ...type.title, color: colors.text },
  lead: { ...type.headline, color: colors.text },
  dots: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginTop: -6, marginRight: -8 },
  poster: { flexDirection: "row", alignItems: "center", gap: space.md },
  posterName: { ...type.subheading, color: colors.text },
  posterMeta: { ...type.footnote, color: colors.muted, marginTop: 2 },
  ownerActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
}));

/**
 * Body text, the serif section headlines and the facts grid for a detail screen's own content: `const detailStyles =
 * useDetailStyles();` at the top of the screen. `cellLabel` is a sentence-case label over a `cellValue` where the words
 * already exist ("Roommate gender"); Fact's eyebrow is the tracked version for the grid's own labels.
 */
export const useDetailStyles = makeStyles((colors) => ({
  body: { ...type.bodySmall, lineHeight: 22, color: colors.text },
  h2: { ...type.headline, fontSize: 18, lineHeight: 24, color: colors.text, marginTop: space.sm },
  grid: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, marginTop: space.xs },
  gridRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  gridCell: { flex: 1, paddingVertical: space.md, paddingRight: space.md, justifyContent: "center" },
  gridCellRight: { paddingLeft: space.md, paddingRight: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cellLabel: { ...type.footnote, color: colors.muted },
  cellValue: { ...type.subheading, color: colors.text },
}));
