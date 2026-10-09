import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BUZZ_PAGE_SIZE, BUZZ_SORTS, BUZZ_TOPICS, labelFor, listBuzz, type BuzzPost, type BuzzSort, type BuzzTopic } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";
import { BUZZ_GUTTER, BuzzCard, BuzzSearchRow, emitBuzzEvent, onBuzzEvent } from "./buzz-card";

const SORT_ICONS: Record<BuzzSort, keyof typeof Ionicons.glyphMap> = { hot: "flame-outline", new: "time-outline", top: "trending-up-outline" };

/** A small rounded filter pill, like the ones under Reddit's search bar. */
function FilterPill({ label, icon, active, caret, onPress, accessibilityLabel }: { label: string; icon?: keyof typeof Ionicons.glyphMap; active?: boolean; caret?: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const ink = active ? colors.brand : colors.text;
  return (
    <Pressable onPress={onPress} style={[styles.filter, active && { backgroundColor: colors.brandSoft }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: Boolean(active) }}>
      {icon ? <Ionicons name={icon} size={15} color={ink} /> : null}
      <Text style={[styles.filterText, { color: ink }]}>{label}</Text>
      {caret ? <Ionicons name="chevron-down" size={14} color={ink} /> : null}
    </Pressable>
  );
}

/** Home → Buzz: anonymous Reddit-style threads. `topInset` is the height of the floating Home bar above the list. */
export function BuzzSection({ topInset }: { active: boolean; topInset: number }) {
  const router = useRouter();
  const show = useActionSheet();
  const { user, profile } = useSession();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  /** The search the list on screen was loaded with. */
  const [shownQ, setShownQ] = useState("");
  const [sort, setSort] = useState<BuzzSort>("hot");
  const [topic, setTopic] = useState<BuzzTopic | undefined>();
  const [allCampuses, setAllCampuses] = useState(false);
  const universityId = allCampuses ? undefined : (profile?.university_id ?? undefined);

  const [items, setItems] = useState<BuzzPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState(false);
  const seq = useRef(0);
  const count = useRef(0);
  count.current = items.length;

  // Wait until typing stops before searching.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (mode: "replace" | "more") => {
      const id = ++seq.current;
      const offset = mode === "more" ? count.current : 0;
      try {
        const page = await listBuzz(supabase, { universityId, topic, sort, q: q || undefined, limit: BUZZ_PAGE_SIZE, offset });
        if (id !== seq.current) return;
        setItems((prev) => (mode === "replace" ? page : [...prev, ...page.filter((p) => !prev.some((x) => x.id === p.id))]));
        if (mode === "replace") setShownQ(q);
        setEnded(page.length < BUZZ_PAGE_SIZE);
        setError(null);
        setMoreError(false);
      } catch (e) {
        if (id !== seq.current) return;
        // A failed "load more" only shows a retry row at the bottom: the list above is still good.
        if (mode === "more") setMoreError(true);
        else setError(errorText(e, "Could not load Buzz. Please try again."));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    // The signed-in user is part of the key: "You" markers and votes differ per person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [universityId, topic, sort, q, user?.id],
  );

  useEffect(() => {
    setLoading(true);
    void load("replace");
  }, [load]);

  // Things that happened on the thread or create screens.
  useEffect(
    () =>
      onBuzzEvent((e) => {
        if (e.type === "patch") setItems((prev) => prev.map((p) => (p.id === e.post.id ? e.post : p)));
        else if (e.type === "vote") setItems((prev) => prev.map((p) => (p.id === e.id ? { ...p, score: e.vote.score, myVote: e.vote.myVote } : p)));
        else if (e.type === "remove") setItems((prev) => prev.filter((p) => p.id !== e.id));
        else void load("replace");
      }),
    [load],
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load("replace");
  }, [load]);

  const fetchMore = useCallback(() => {
    if (loading || refreshing || loadingMore || ended || count.current === 0) return;
    setMoreError(false);
    setLoadingMore(true);
    void load("more");
  }, [load, loading, refreshing, loadingMore, ended]);

  // Scrolling to the end loads the next page. After a failure the person retries with a tap, so a dead connection is not hammered.
  const loadMore = useCallback(() => {
    if (!moreError) fetchMore();
  }, [fetchMore, moreError]);

  const filtered = Boolean(q || topic);
  // Rows use Reddit's compact search style only while the list on screen really is a set of search results,
  // so they do not flip style (and remount) while the person is still typing or the full list is still loading.
  const searching = shownQ.length > 0;
  const create = () => router.push(user ? "/create/buzz" : "/(auth)/login");
  const pickSort = () =>
    show(
      BUZZ_SORTS.map((s) => ({ label: s.value === sort ? `${s.label} ✓` : s.label, icon: SORT_ICONS[s.value], onPress: () => setSort(s.value) })),
      "Sort threads by",
    );
  // iOS: an inset keeps the pull-to-refresh spinner below the floating bar. Android: padding + spinner offset.
  const ios = Platform.OS === "ios";
  const inset = useMemo(() => ({ top: topInset }), [topInset]);
  const startOffset = useMemo(() => ({ x: 0, y: -topInset }), [topInset]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.card }}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        // Flat Reddit rows: no cards, no side padding, a hairline between rows.
        contentContainerStyle={{ paddingBottom: 96, paddingTop: ios ? 0 : topInset }}
        ItemSeparatorComponent={Hairline}
        contentInset={ios ? inset : undefined}
        contentOffset={ios ? startOffset : undefined}
        scrollIndicatorInsets={ios ? inset : undefined}
        automaticallyAdjustContentInsets={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.searchRow}>
              <View style={styles.search}>
                <Ionicons name="search" size={18} color={colors.muted} />
                <TextInput value={search} onChangeText={setSearch} placeholder="Search Buzz" placeholderTextColor={colors.muted} returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} style={styles.searchInput} accessibilityLabel="Search Buzz" />
              </View>
              <Pressable onPress={create} style={styles.plus} accessibilityRole="button" accessibilityLabel="Post anonymously on Buzz">
                <Ionicons name="add" size={26} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -BUZZ_GUTTER }} contentContainerStyle={{ gap: 8, paddingHorizontal: BUZZ_GUTTER }} keyboardShouldPersistTaps="handled">
              <FilterPill label={labelFor(BUZZ_SORTS, sort)} icon={SORT_ICONS[sort]} caret onPress={pickSort} accessibilityLabel={`Sort: ${labelFor(BUZZ_SORTS, sort)}`} />
              {BUZZ_TOPICS.map((t) => (
                <FilterPill key={t.value} label={t.label} active={topic === t.value} onPress={() => setTopic(topic === t.value ? undefined : t.value)} />
              ))}
              {profile?.university_id ? <FilterPill label={allCampuses ? "All universities" : "My campus"} icon="school-outline" active={!allCampuses} onPress={() => setAllCampuses((v) => !v)} /> : null}
            </ScrollView>
            <View style={styles.notice}>
              <Ionicons name="eye-off-outline" size={12} color={colors.faint} />
              <Text style={styles.noticeText}>Buzz is anonymous. Nobody sees who wrote a post or a reply.</Text>
            </View>
            {error && items.length > 0 ? <ErrorBanner message={error} onRetry={refresh} /> : null}
          </View>
        }
        renderItem={({ item }) =>
          searching ? (
            <BuzzSearchRow post={item} />
          ) : (
            <BuzzCard
              post={item}
              // For you shows the same threads: every change goes through the event bus, which this list listens to as well.
              onVote={(v) => emitBuzzEvent({ type: "vote", id: item.id, vote: v })}
              onRemoved={(id) => emitBuzzEvent({ type: "remove", id })}
              onMuted={() => {
                setRefreshing(true);
                emitBuzzEvent({ type: "reload" });
              }}
            />
          )
        }
        ListEmptyComponent={
          loading ? (
            <Loading />
          ) : error ? (
            <View style={{ paddingHorizontal: BUZZ_GUTTER }}>
              <ErrorBanner message={error} onRetry={refresh} />
            </View>
          ) : filtered ? (
            <EmptyState icon="search-outline" title="Nothing matches" body="Try another word or clear the topic." />
          ) : (
            <EmptyState icon="chatbubbles-outline" title="No Buzz yet" body="Share a thought, a story or a question. Your name is never shown." />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.brand} style={{ paddingVertical: 12 }} />
          ) : moreError ? (
            <Pressable onPress={fetchMore} accessibilityRole="button" style={{ paddingVertical: 12 }}>
              <Text style={styles.retry}>Could not load more. Tap to try again.</Text>
            </Pressable>
          ) : ended && items.length >= BUZZ_PAGE_SIZE ? <Text style={styles.end}>You have reached the end.</Text> : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={ios ? undefined : topInset} tintColor={colors.brand} />}
      />
    </View>
  );
}

function Hairline() {
  return <View style={styles.hairline} />;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: BUZZ_GUTTER, paddingTop: 10, paddingBottom: 8, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  search: { flex: 1, height: 42, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: 21, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  plus: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  filter: { height: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.input },
  filterText: { fontSize: 13, fontWeight: "600" },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  notice: { flexDirection: "row", alignItems: "center", gap: 5 },
  noticeText: { flex: 1, fontSize: 11, color: colors.faint },
  retry: { textAlign: "center", color: colors.brand, fontSize: 13, fontWeight: "600" },
  end: { textAlign: "center", color: colors.faint, fontSize: 12, paddingVertical: 12 },
});
