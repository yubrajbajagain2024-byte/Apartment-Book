import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { searchPeople, type PosterSummary } from "@apartment-book/shared";
import { useFollowStatsMany } from "@/components/follow-button";
import { PersonRow } from "@/components/person-row";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius, space } from "@/lib/theme";

/** Same array on every render while nothing has loaded, so the stats hook does not refetch for a fresh empty list. */
const NOBODY: PosterSummary[] = [];

/**
 * Search: find accounts by name, like Instagram. With an empty box the screen lists people to follow (your university's
 * newest members, or the newest on the app) instead of being blank. Profiles are public, so signed-out people can
 * search too; their Follow taps go to login.
 */
export default function SearchScreen() {
  const { user, profile } = useSession();
  const router = useRouter();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  // Wait until typing stops before searching.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const me = user?.id;
  const universityId = profile?.university_id ?? undefined;
  const { data, error, loading, refresh } = useQuery(
    () => (q ? searchPeople(supabase, q, { limit: 30, excludeIds: me ? [me] : [] }) : searchPeople(supabase, "", { universityId, sort: "newest", limit: 20, excludeIds: me ? [me] : [] })),
    [q, me, universityId],
  );
  const people = data ?? NOBODY;
  const stats = useFollowStatsMany(people, me ?? null);
  const needLogin = () => router.push("/(auth)/login");
  const section = q ? "People" : profile?.university ? `People at ${profile.university.name}` : "New on Apartment Book";

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.muted} />
          {/* Opened from the magnifier in the top-right corner, so typing starts at once, like TikTok. */}
          <TextInput autoFocus value={text} onChangeText={setText} placeholder="Search people" placeholderTextColor={colors.faint} accessibilityLabel="Search people" returnKeyType="search" autoCorrect={false} autoCapitalize="words" clearButtonMode="while-editing" style={styles.input} />
        </View>
      </View>
      {error && !loading ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}><ErrorBanner message={error} onRetry={() => void refresh()} /></View>
      ) : null}
      {/* Rows from the last query stay up while the next one runs, so the list does not flash a spinner on every keystroke. */}
      <FlatList
        data={people}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
        ListHeaderComponent={people.length > 0 ? <Text style={styles.section}>{section}</Text> : null}
        renderItem={({ item }) => <PersonRow person={item} stats={stats[item.id]} userId={me ?? null} onNeedLogin={needLogin} onPress={() => router.push({ pathname: "/profile/[id]", params: { id: item.id } })} />}
        ListEmptyComponent={
          loading && !data ? (
            <Loading />
          ) : error ? null : q ? (
            <EmptyState icon="search-outline" title="No one found" body="Try a different spelling of their name." />
          ) : (
            <EmptyState icon="people-outline" title="Nobody to show yet" />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.lg, paddingTop: space.md },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: 14, height: 42 },
  input: { flex: 1, fontSize: 15, color: colors.text },
  section: { fontSize: 13, fontWeight: "600", color: colors.muted, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
});
