import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BUZZ_PAGE_SIZE, BUZZ_SORTS, BUZZ_TOPICS, labelFor, listBuzz, type BuzzPost, type BuzzSort, type BuzzTopic } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { AnimatedFlatList } from "@/lib/collapsing-header";
import { useHomeScope } from "@/lib/home-scope";
import { useTabBarInset } from "@/lib/tab-bar";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space, type } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import { BUZZ_GUTTER, BuzzCard, BuzzSearchRow, emitBuzzEvent, onBuzzEvent } from "./buzz-card";

const SORT_ICONS: Record<BuzzSort, keyof typeof Ionicons.glyphMap> = { hot: "flame-outline", new: "time-outline", top: "trending-up-outline" };

/** A filter capsule in the system's Chip look (a hairline at rest, ink outline and a warm wash when chosen), with room for a caret. */
function FilterPill({ label, icon, active, caret, onPress, accessibilityLabel }: { label: string; icon?: keyof typeof Ionicons.glyphMap; active?: boolean; caret?: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const colors = useColors();
  const styles = useStyles();
  const ink = active ? colors.text : colors.muted;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.filter, active && styles.filterActive, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: Boolean(active) }}>
      {icon ? <Ionicons name={icon} size={14} color={ink} /> : null}
      <Text style={[styles.filterText, { color: ink }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
      {caret ? <Ionicons name="chevron-down" size={13} color={ink} /> : null}
    </Pressable>
  );
}

/** The shape of the Buzz list while it loads: a few rows drawn as grey shapes (topic, title, the pills), a hairline between them. */
function BuzzSkeleton() {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View accessibilityLabel="Loading">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.skeletonRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Skeleton width={24} height={24} round />
            <Skeleton width={88} height={12} />
          </View>
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 7 }}>
              <Skeleton width="92%" height={14} />
              <Skeleton width={i % 2 ? "58%" : "76%"} height={14} />
              <Skeleton width="84%" height={10} style={{ marginTop: 2 }} />
            </View>
            {i % 2 ? <Skeleton width={96} height={72} style={{ borderRadius: radius.md }} /> : null}
          </View>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Skeleton width={104} height={32} round />
            <Skeleton width={64} height={32} round />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Home → Buzz: anonymous Reddit-style threads. `topInset` is the height of the floating Home bar above the list, which `onScroll` reports its scroll to (the bar slides away with it). */
export function BuzzSection({ topInset, onScroll }: { active: boolean; topInset: number; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
  const router = useRouter();
  const show = useActionSheet();
  const { user, profile } = useSession();
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  /** The search the list on screen was loaded with. */
  const [shownQ, setShownQ] = useState("");
  const [sort, setSort] = useState<BuzzSort>("hot");
  const [topic, setTopic] = useState<BuzzTopic | undefined>();
  const [scope] = useHomeScope();
  // The campus is chosen from the dropdown in the top bar; someone without a university sees every campus.
  const universityId = scope.campus === "all" || !profile?.university_id ? undefined : profile.university_id;

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
  const tabBar = useTabBarInset();
  const startOffset = useMemo(() => ({ x: 0, y: -topInset }), [topInset]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AnimatedFlatList
        data={items}
        keyExtractor={(p) => p.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Flat Reddit rows: no cards, no side padding, a hairline between rows.
        contentContainerStyle={{ paddingBottom: 96 + tabBar, paddingTop: ios ? 0 : topInset }}
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
                <TextInput value={search} onChangeText={setSearch} placeholder="Search Buzz" placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} style={styles.searchInput} accessibilityLabel="Search Buzz" />
              </View>
              <Pressable onPress={create} style={({ pressed }) => [styles.plus, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Post anonymously on Buzz">
                <Ionicons name="add" size={24} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -BUZZ_GUTTER }} contentContainerStyle={{ gap: space.sm, paddingHorizontal: BUZZ_GUTTER }} keyboardShouldPersistTaps="handled">
              <FilterPill label={labelFor(BUZZ_SORTS, sort)} icon={SORT_ICONS[sort]} caret onPress={pickSort} accessibilityLabel={`Sort: ${labelFor(BUZZ_SORTS, sort)}`} />
              {BUZZ_TOPICS.map((t) => (
                <FilterPill key={t.value} label={t.label} active={topic === t.value} onPress={() => setTopic(topic === t.value ? undefined : t.value)} />
              ))}
            </ScrollView>
            <View style={styles.notice}>
              <Ionicons name="eye-off-outline" size={13} color={colors.muted} style={styles.noticeIcon} />
              {/* The whole sentence, on two lines where a phone is narrow: cut short, it would hide what it promises. */}
              <Text style={styles.noticeText} numberOfLines={2}>Buzz is anonymous. Nobody sees who wrote a post or a reply.</Text>
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
              // The thread and create screens report through the same event bus, so every change takes one path, which this list listens to.
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
            <BuzzSkeleton />
          ) : error ? (
            <View style={{ paddingHorizontal: BUZZ_GUTTER, paddingTop: space.md }}>
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
            <ActivityIndicator color={colors.muted} style={{ paddingVertical: space.lg }} />
          ) : moreError ? (
            <Pressable onPress={fetchMore} accessibilityRole="button" style={({ pressed }) => [{ paddingVertical: space.md }, pressed && { opacity: 0.7 }]}>
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
  const styles = useStyles();
  return <View style={styles.hairline} />;
}

const useStyles = makeStyles((colors) => ({
  header: { paddingHorizontal: BUZZ_GUTTER, paddingTop: space.md, paddingBottom: space.md, gap: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  searchRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  // The search box and the "+" share one height on the soft input fill, as capsules.
  search: { flex: 1, height: 40, flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 14 },
  searchInput: { flex: 1, ...type.bodySmall, color: colors.text, paddingVertical: 0 },
  plus: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  filter: { height: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: "transparent" },
  filterActive: { backgroundColor: colors.brandSoft, borderColor: colors.text },
  filterText: { ...type.label, fontSize: 13 },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  skeletonRow: { paddingHorizontal: BUZZ_GUTTER, paddingVertical: space.md, gap: space.md },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  noticeIcon: { marginTop: 2 },
  noticeText: { flex: 1, ...type.footnote, color: colors.muted },
  retry: { ...type.label, fontSize: 13, textAlign: "center", color: colors.muted },
  // The end of the list is a quiet serif aside, like "You're all caught up." on For you.
  end: { ...type.aside, textAlign: "center", color: colors.muted, paddingTop: space.xl, paddingBottom: space.lg },
}));
