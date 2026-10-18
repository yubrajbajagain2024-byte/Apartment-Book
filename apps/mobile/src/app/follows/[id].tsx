import { useLayoutEffect, useState, type ReactElement } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  compactCount,
  followListView,
  getFollowStats,
  listFollowers,
  listFollowing,
  listMutualFriends,
  MUTUAL_FRIENDS_LOGIN_PROMPT,
  MUTUAL_FRIENDS_TITLE,
  noMutualFriendsMessage,
  privateFollowListsNote,
  type FollowStats,
  type PosterSummary,
} from "@apartment-book/shared";
import { useFollowStatsMany } from "@/components/follow-button";
import { PersonRow } from "@/components/person-row";
import { Button, EmptyState, ErrorBanner, RowSkeleton } from "@/components/ui";
import { useFeed, useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space, type } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

type Kind = "followers" | "following";
/** Which people a list holds: one of the owner's own two lists, or the friends the viewer has in common with the owner. */
type List = Kind | "mutual";

const KINDS: { value: Kind; label: string }[] = [
  { value: "followers", label: "Followers" },
  { value: "following", label: "Following" },
];

/**
 * What the Followers and Following counts on a profile open. On your own profile: Followers | Following, newest first.
 * Anyone else's followers and following are private to them (the database sees to that), so either count opens the
 * friends you and they have in common, by name; signed out, a prompt to log in. Every row but your own has a Follow button.
 */
export default function FollowsScreen() {
  const { id, kind: initialKind, name } = useLocalSearchParams<{ id: string; kind?: string; name?: string | string[] }>();
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const { user, loading } = useSession();
  const [kind, setKind] = useState<Kind>(initialKind === "following" ? "following" : "followers");
  const viewerId = user?.id ?? null;
  // Nobody is signed in until the stored session has been read: wait for it rather than flash the log-in prompt.
  // Signing in or out while the screen is open switches the view.
  const view = loading ? null : followListView(viewerId, id);
  const title = view === "own" ? (kind === "followers" ? "Followers" : "Following") : view ? MUTUAL_FRIENDS_TITLE : "";
  // Set before the screen paints, so the header never shows the wrong title for a frame.
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [title, navigation]);
  // A link that repeats ?name= hands over an array: the first one is the name.
  const ownerName = typeof name === "string" ? name : Array.isArray(name) ? (name[0] ?? "") : "";
  const firstName = ownerName.trim().split(/\s+/)[0] ?? "";
  const note = privateFollowListsNote(firstName);

  return (
    <View style={styles.screen}>
      {ownerName ? <Text style={styles.name} numberOfLines={1}>{ownerName}</Text> : null}
      {view === "own" ? (
        <OwnLists userId={id} kind={kind} onKind={setKind} />
      ) : view === "mutual" ? (
        <>
          {/* In place of the tabs on your own lists: why theirs are not shown. */}
          <View style={styles.note} accessible accessibilityLabel={note}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.muted} />
            <Text style={styles.noteText}>{note}</Text>
          </View>
          {/* Keyed by the viewer: someone else signing in here starts on the spinner, never on the last person's rows. */}
          <PeopleList key={viewerId} userId={id} list="mutual" viewerId={viewerId} empty={<EmptyState icon="people-outline" title="No mutual friends" body={`${noMutualFriendsMessage(firstName)}.`} />} />
        </>
      ) : view === "signed-out" ? (
        <EmptyState icon="people-outline" title={MUTUAL_FRIENDS_LOGIN_PROMPT} body={`${note}.`} action={<Button title="Log in" onPress={() => router.push("/(auth)/login")} />} />
      ) : (
        <RowSkeleton />
      )}
    </View>
  );
}

/** Your own Followers | Following, each tab with its count. Only the owner gets here, so they are also the viewer. */
function OwnLists({ userId, kind, onKind }: { userId: string; kind: Kind; onKind: (kind: Kind) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const stats = useQuery(() => getFollowStats(supabase, userId), [userId]);
  // Following someone from your own lists moves your "Following · n" above.
  const refreshStats = () => void stats.refresh();
  return (
    <>
      <View style={styles.segments} accessibilityRole="tablist">
        {KINDS.map((k) => {
          const active = k.value === kind;
          const label = stats.data ? `${k.label} · ${compactCount(stats.data[k.value])}` : k.label;
          return (
            <Pressable key={k.value} onPress={() => onKind(k.value)} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} style={styles.segment}>
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
              <View style={[styles.underline, active && { backgroundColor: colors.brand }]} />
            </Pressable>
          );
        })}
      </View>
      {/* Keyed by kind: a switch mounts a fresh list that starts on its spinner, instead of the other list's rows (or its empty state) showing until the first page lands. */}
      <PeopleList key={kind} userId={userId} list={kind} viewerId={userId} empty={<EmptyState icon="people-outline" title={kind === "followers" ? "No followers yet" : "Not following anyone yet"} />} onRowChange={refreshStats} onRefresh={refreshStats} />
    </>
  );
}

/** One paged list of people with pull to refresh. Rows are keyed by the person, which is what useFeed needs to drop a row that two pages both return. */
function PeopleList({ userId, list, viewerId, empty, onRowChange, onRefresh }: { userId: string; list: List; viewerId: string | null; empty: ReactElement; onRowChange?: (stats: FollowStats) => void; onRefresh?: () => void }) {
  const styles = useStyles();
  const router = useRouter();
  const feed = useFeed<PosterSummary>(
    async (page) => {
      if (list === "mutual") return listMutualFriends(supabase, userId, { page });
      const result = await (list === "followers" ? listFollowers : listFollowing)(supabase, userId, { page });
      return { ...result, data: result.data.map((e) => e.profile) };
    },
    [userId, list, viewerId],
  );
  const rowStats = useFollowStatsMany(feed.items, viewerId);
  const needLogin = () => router.push("/(auth)/login");
  function refresh() {
    feed.refresh();
    onRefresh?.();
  }
  return (
    <FlatList
      data={feed.items}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ flexGrow: 1, paddingVertical: space.sm, paddingBottom: 40 }}
      renderItem={({ item }) => <PersonRow person={item} stats={rowStats[item.id]} userId={viewerId} onNeedLogin={needLogin} onChange={onRowChange} onPress={() => router.push({ pathname: "/profile/[id]", params: { id: item.id } })} />}
      ListEmptyComponent={
        feed.loading ? (
          <RowSkeleton />
        ) : feed.error ? (
          <View style={{ padding: space.lg }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View>
        ) : (
          empty
        )
      }
      ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={styles.more}>Loading more…</Text> : null}
      onEndReached={feed.loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refresh} />}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  // The screen colour (white in light, as before; black in dark like every other screen).
  screen: { flex: 1, backgroundColor: colors.bg },
  name: { ...type.caption, textAlign: "center", color: colors.muted, paddingTop: space.sm },
  segments: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  segment: { flex: 1, alignItems: "center", paddingTop: space.md, gap: space.sm },
  segmentText: { ...type.label, fontSize: 15, color: colors.muted },
  // The open tab in ink; the underline is ink too, on the row's hairline.
  segmentTextActive: { color: colors.text, fontWeight: "700" },
  underline: { height: 2, alignSelf: "stretch", backgroundColor: "transparent" },
  note: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  noteText: { ...type.caption, flexShrink: 1, color: colors.muted, textAlign: "center" },
  more: { ...type.footnote, textAlign: "center", color: colors.faint, padding: space.md },
}));
