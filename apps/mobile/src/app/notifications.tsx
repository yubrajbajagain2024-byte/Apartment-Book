import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { MaterialCommunityIcons, type Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { listNotifications, markNotificationsRead, timeAgo, type NotificationWithActor } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { MaskGlyph } from "@/components/buzz/ui";
import { Button, EmptyState, ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { useSession } from "@/lib/session";
import { phosphor } from "@/lib/palette";
import { SITE_URL, supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { refreshWithHaptic } from "@/lib/haptics";
import { Icon } from "@/components/icon";

const PAGE = 30;
/** The small mark on each row saying what kind of notification it is (over the actor's photo, or alone without one). */
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = { message: "chatbubble", listing_saved: "bookmark", nearby_listing: "location", system: "notifications", like: "heart", comment: "chatbox", follow: "person-add", snap: "camera" };
const AVATAR = 44;
/** Buzz's own notifications: anonymous by design (no actor, nothing about anyone in them), always the mask, never a photo. */
const BUZZ_TYPES = new Set(["buzz_reply", "buzz_milestone", "buzz_poll_closed"]);
/** Links only the website has (the staff console, the Community Guidelines): opened there. */
const WEB_ONLY = /^\/(admin|guidelines)(\/|#|\?|$)/;
/** "5 minutes ago". A Buzz reply's notice carries the reply's own (delayed) publication time, never later than now on screen. */
function ago(iso: string): string {
  return timeAgo(Date.parse(iso) > Date.now() ? new Date().toISOString() : iso);
}

/**
 * Notifications, opened from the bell in Home's top-right corner: every notification the database keeps for you (new
 * messages, likes, comments and replies, follows, saves of your listings, new places near campus), newest first, each
 * unread one marked only by a small blue dot (the row itself looks like any other, in both themes). Tapping one marks it read and opens what it is about; "Mark all read" in the header
 * clears the rest; the list pulls to refresh and loads older rows as it scrolls. Signed out it asks to log in.
 */
export default function NotificationsScreen() {
  // Rows fade in once as they first arrive (not when scrolled back into view).
  const appearCells = useAppearingCells();
  const { user } = useSession();
  const router = useRouter();
  const styles = useStyles();
  const colors = useColors();
  const [items, setItems] = useState<NotificationWithActor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const rows = await listNotifications(supabase, { limit: PAGE });
      setItems(rows);
      setDone(rows.length < PAGE);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your notifications.");
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    const last = items?.[items.length - 1];
    if (!last || done || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await listNotifications(supabase, { limit: PAGE, before: last.created_at });
      setItems((cur) => [...(cur ?? []), ...older.filter((o) => !cur?.some((c) => c.id === o.id))]);
      setDone(older.length < PAGE);
    } catch {
      // The rows on screen stay; the next scroll tries again.
    } finally {
      setLoadingMore(false);
    }
  }, [items, done, loadingMore]);

  function open(n: NotificationWithActor) {
    if (n.read_at === null) {
      setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
      markNotificationsRead(supabase, [n.id]).catch(() => {});
    }
    // The link is the same address the website uses (/messages/<id>, /posts/<id>, /buzz/<id>, /settings/account-status...),
    // which the app's routes share; the staff console and the guidelines live on the website only.
    if (n.link && WEB_ONLY.test(n.link)) void WebBrowser.openBrowserAsync(`${SITE_URL}${n.link}`, { dismissButtonStyle: "close" }).catch(() => {});
    else if (n.link) router.push(n.link as never);
  }

  function markAll() {
    setItems((cur) => cur?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? null);
    markNotificationsRead(supabase).catch(() => {});
  }

  const unread = items?.filter((n) => n.read_at === null).length ?? 0;

  if (!user) {
    return (
      <View style={styles.screen}>
        <EmptyState icon="notifications-outline" title="Log in to see your notifications" action={<Button title="Log in" onPress={() => router.push("/(auth)/login")} />} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () =>
            unread > 0 ? (
              <Pressable onPress={markAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mark all as read" style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}>
                <Text style={styles.headerButtonText}>Mark all read</Text>
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        data={items ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={[styles.list, (items?.length ?? 0) === 0 && styles.listEmpty]}
        ListHeaderComponent={items && items.length > 0 ? <Text style={styles.summary}>{unread > 0 ? `${unread} unread` : "All caught up"}</Text> : null}
        CellRendererComponent={appearCells}
        renderItem={({ item: n }) => {
          const icon = ICONS[n.type] ?? "notifications";
          const isUnread = n.read_at === null;
          const buzz = BUZZ_TYPES.has(n.type);
          return (
            <Pressable
              onPress={() => open(n)}
              accessibilityRole="button"
              accessibilityLabel={`${n.title}${n.body ? `. ${n.body}` : ""}, ${ago(n.created_at)}${isUnread ? ", unread" : ""}`}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.mark}>
                {buzz ? (
                  <View style={styles.buzzMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <MaskGlyph size={22} color={phosphor.accent} />
                  </View>
                ) : n.type === "moderation" ? (
                  <View style={[styles.kindAlone, { backgroundColor: colors.warningSoft }]}>
                    <MaterialCommunityIcons name="shield-alert-outline" size={22} color={colors.warningText} />
                  </View>
                ) : n.type === "staff" ? (
                  <View style={styles.kindAlone}>
                    <Icon name="shield-checkmark-outline" size={21} color={colors.brand} />
                  </View>
                ) : n.actor ? (
                  <>
                    <Avatar name={n.actor.full_name} url={n.actor.avatar_url} size={AVATAR} online={false} transition={0} />
                    <View style={[styles.kind, { borderColor: colors.bg }]}>
                      <Icon name={icon} size={11} color={colors.onBrand} />
                    </View>
                  </>
                ) : (
                  <View style={styles.kindAlone}>
                    <Icon name={icon} size={20} color={colors.brand} />
                  </View>
                )}
              </View>
              <View style={styles.text}>
                <Text style={styles.title} numberOfLines={1}>
                  {n.title}
                </Text>
                {n.body ? (
                  <Text style={styles.body} numberOfLines={2}>
                    {n.body}
                  </Text>
                ) : null}
                <Text style={styles.time}>{ago(n.created_at)}</Text>
              </View>
              {isUnread ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          items === null && !error ? (
            <Loading />
          ) : error ? (
            <View style={styles.pad}>
              <ErrorBanner message={error} onRetry={() => void load()} />
            </View>
          ) : (
            <EmptyState icon="notifications-outline" title="Nothing yet" body="New messages, likes, comments, follows, saves of your listings and places near campus will show here." />
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={colors.muted} /> : null}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(() => void onRefresh())} />}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerButton: { paddingHorizontal: 4, paddingVertical: 6 },
  headerButtonText: { fontSize: 15, fontWeight: "600", color: colors.brand },
  list: { paddingVertical: space.sm, paddingBottom: 40 },
  // An empty list fills the screen, so its message sits in the middle.
  listEmpty: { flexGrow: 1 },
  summary: { fontSize: 13, color: colors.muted, paddingHorizontal: space.lg, paddingBottom: space.xs },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: space.lg, paddingVertical: 12 },
  mark: { width: AVATAR, height: AVATAR },
  // The kind of notification, on the photo's corner, ringed in the row's colour so it reads over the photo.
  kind: { position: "absolute", right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  kindAlone: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  // A Buzz notification's mark: the lime mask on a Phosphor disc, the same in both themes (Buzz is always that world).
  buzzMark: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: phosphor.surface2, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, color: colors.text },
  body: { fontSize: 14, color: colors.muted },
  time: { fontSize: 12, color: colors.faint, marginTop: 2 },
  // The one mark of an unread notification, level with its first line.
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.brand, marginTop: 5 },
  pad: { paddingHorizontal: space.lg, paddingTop: space.sm },
  footer: { paddingVertical: 16 },
}));
