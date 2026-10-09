import { useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { compactCount, getFollowStats, listFollowers, listFollowing, type FollowListEntry, type FollowStats } from "@apartment-book/shared";
import { useFollowStatsMany } from "@/components/follow-button";
import { PersonRow } from "@/components/person-row";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useFeed, useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, space } from "@/lib/theme";

type Kind = "followers" | "following";
/** A list entry keyed by the person, which is what useFeed needs to drop a row that two pages both return. */
type Row = FollowListEntry & { id: string };

const KINDS: { value: Kind; label: string }[] = [
  { value: "followers", label: "Followers" },
  { value: "following", label: "Following" },
];

/** Followers | Following of one person, newest first, with a Follow button on every row but your own. Opened from the counts on a profile. */
export default function FollowsScreen() {
  const { id, kind: initialKind, name } = useLocalSearchParams<{ id: string; kind?: string; name?: string }>();
  const { user } = useSession();
  const navigation = useNavigation();
  const [kind, setKind] = useState<Kind>(initialKind === "following" ? "following" : "followers");
  useEffect(() => {
    navigation.setOptions({ title: kind === "followers" ? "Followers" : "Following" });
  }, [kind, navigation]);
  const viewerId = user?.id ?? null;
  const stats = useQuery(() => getFollowStats(supabase, id), [id, viewerId]);
  // Following someone from your own lists moves your "Following · n" above; on anyone else's lists the numbers up there do not change.
  const onRowChange = viewerId === id ? () => void stats.refresh() : undefined;

  return (
    <View style={styles.screen}>
      {name ? <Text style={styles.name} numberOfLines={1}>{name}</Text> : null}
      <View style={styles.segments} accessibilityRole="tablist">
        {KINDS.map((k) => {
          const active = k.value === kind;
          const label = stats.data ? `${k.label} · ${compactCount(stats.data[k.value])}` : k.label;
          return (
            <Pressable key={k.value} onPress={() => setKind(k.value)} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} style={styles.segment}>
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
              <View style={[styles.underline, active && { backgroundColor: colors.brand }]} />
            </Pressable>
          );
        })}
      </View>
      {/* Keyed by kind: a switch mounts a fresh list that starts on its spinner, instead of the other list's rows (or its empty state) showing until the first page lands. */}
      <PeopleList key={kind} userId={id} kind={kind} viewerId={viewerId} onRowChange={onRowChange} onRefresh={() => void stats.refresh()} />
    </View>
  );
}

function PeopleList({ userId, kind, viewerId, onRowChange, onRefresh }: { userId: string; kind: Kind; viewerId: string | null; onRowChange?: (stats: FollowStats) => void; onRefresh: () => void }) {
  const router = useRouter();
  const feed = useFeed<Row>(
    async (page) => {
      const result = await (kind === "followers" ? listFollowers : listFollowing)(supabase, userId, { page });
      return { ...result, data: result.data.map((e) => ({ id: e.profile.id, ...e })) };
    },
    [userId, kind, viewerId],
  );
  const rowStats = useFollowStatsMany(feed.items, viewerId);
  const needLogin = () => router.push("/(auth)/login");
  function refresh() {
    feed.refresh();
    onRefresh();
  }
  return (
    <FlatList
      data={feed.items}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ flexGrow: 1, paddingVertical: space.sm, paddingBottom: 40 }}
      renderItem={({ item }) => <PersonRow person={item.profile} stats={rowStats[item.id]} userId={viewerId} onNeedLogin={needLogin} onChange={onRowChange} onPress={() => router.push({ pathname: "/profile/[id]", params: { id: item.id } })} />}
      ListEmptyComponent={
        feed.loading ? (
          <Loading />
        ) : feed.error ? (
          <View style={{ padding: space.lg }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View>
        ) : (
          <EmptyState icon="people-outline" title={kind === "followers" ? "No followers yet" : "Not following anyone yet"} />
        )
      }
      ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={styles.more}>Loading more…</Text> : null}
      onEndReached={feed.loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refresh} />}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  name: { textAlign: "center", color: colors.muted, fontSize: 13, paddingTop: space.sm },
  segments: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  segment: { flex: 1, alignItems: "center", paddingTop: space.md, gap: space.sm },
  segmentText: { fontSize: 15, fontWeight: "600", color: colors.muted },
  segmentTextActive: { color: colors.text, fontWeight: "800" },
  underline: { height: 2, alignSelf: "stretch", backgroundColor: "transparent" },
  more: { textAlign: "center", color: colors.faint, padding: 12 },
});
