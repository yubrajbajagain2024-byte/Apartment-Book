import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BUZZ_PAGE_SIZE, BUZZ_SORTS, BUZZ_TOPICS, labelFor, listBuzz, videosFor, type BuzzPost, type BuzzSort, type BuzzTopic } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { EmptyState, ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList } from "@/lib/collapsing-header";
import { useHomeScope } from "@/lib/home-scope";
import { buzzAfter, entryOf, openViewer, viewerItemFromBuzz, type ViewerEntry } from "@/lib/reel-viewer";
import { useTabBarInset } from "@/lib/tab-bar";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import { BUZZ_GUTTER, BuzzCard, BuzzSearchRow, emitBuzzEvent, onBuzzEvent, type BuzzCardProps, type BuzzMediaOpen } from "./buzz-card";
import { useTabReselect } from "@/lib/tab-reselect";
import { refreshWithHaptic } from "@/lib/haptics";
import { Icon } from "@/components/icon";

const SORT_ICONS: Record<BuzzSort, keyof typeof Ionicons.glyphMap> = { hot: "flame-outline", new: "time-outline", top: "trending-up-outline" };

/** A small rounded filter pill, like the ones under Reddit's search bar. */
function FilterPill({ label, icon, active, caret, onPress, accessibilityLabel }: { label: string; icon?: keyof typeof Ionicons.glyphMap; active?: boolean; caret?: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const colors = useColors();
  const styles = useStyles();
  const ink = active ? colors.brand : colors.text;
  return (
    <Pressable onPress={onPress} style={[styles.filter, active && { backgroundColor: colors.brandSoft }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: Boolean(active) }}>
      {icon ? <Icon name={icon} size={15} color={ink} /> : null}
      <Text style={[styles.filterText, { color: ink }]}>{label}</Text>
      {caret ? <Icon name="chevron-down" size={14} color={ink} /> : null}
    </Pressable>
  );
}

/** Home → Buzz: anonymous Reddit-style threads. `topInset` is the height of the floating Home bar above the list, which `onScroll` reports its scroll to (the bar slides away with it). */
type Vote = Parameters<NonNullable<BuzzCardProps["onVote"]>>[0];

/**
 * One thread, memoised: a vote, a new page or the bar sliding away redraws only the rows that changed. The handlers
 * are the list's own stable functions; the per-thread ones are made here, once per drawing of this row.
 */
const BuzzRow = memo(function BuzzRow({ post, active, onVoteFor, onMuted, onOpenMedia }: { post: BuzzCardProps["post"]; active: boolean; onVoteFor: (id: string, vote: Vote) => void; onMuted: () => void; onOpenMedia: NonNullable<BuzzCardProps["onOpenMedia"]> }) {
  return <BuzzCard post={post} active={active} onVote={(v) => onVoteFor(post.id, v)} onRemoved={removeThread} onMuted={onMuted} onOpenMedia={onOpenMedia} />;
});

// The thread and create screens report through the same event bus, so every change takes one path, which this list listens to.
const voteThread = (id: string, vote: Vote) => emitBuzzEvent({ type: "vote", id, vote });
const removeThread = (id: string) => emitBuzzEvent({ type: "remove", id });

export function BuzzSection({ active, topInset, onScroll }: { active: boolean; topInset: number; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
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
        else if (e.type === "reload") void load("replace");
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
  // Tapping Home again while Buzz is on screen: back to the top.
  const listRef = useRef<FlatList<BuzzPost>>(null);
  // Rows fade in once as they first arrive (not when scrolled back into view).
  const appearCells = useAppearingCells();
  // Muting a topic or a poster from a card reloads the feed without them.
  const reloadAfterMute = useCallback(() => {
    setRefreshing(true);
    emitBuzzEvent({ type: "reload" });
  }, []);
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: ios ? -topInset : 0, animated: true }), active);

  // One video plays at a time, the first row on screen (at least 60% of it) that has one, as in For you: sound is one
  // switch for every video, so two playing at once would both be heard.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && videosFor((v.item as BuzzPost).videos).length > 0);
    setPlayingId(first ? String(first.key) : null);
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;

  /** The list on screen and what it was loaded with, read when a picture is tapped. */
  const latest = useRef({ items, filters: { universityId, topic, sort, q: shownQ || undefined } });
  latest.current = { items, filters: { universityId, topic, sort, q: shownQ || undefined } };
  /**
   * A thread's photos or videos tapped: the viewer opens on them, zooming from the frame, with the list's other threads
   * that have media around it (a swipe up moves on, then on into the list's next pages); the tapped video plays on there
   * from where it was. Anonymous all the way: the pages carry the threads as the list has them, nobody's name.
   */
  const openInViewer = useCallback(
    (tapped: BuzzPost, live: BuzzMediaOpen) => {
      // A video opened full screen is the one that plays here when the viewer closes.
      if (live.time !== null) setPlayingId(tapped.id);
      const { items: list, filters } = latest.current;
      const entries: ViewerEntry[] = [];
      let index = -1;
      for (const p of list) {
        const isTapped = p.id === tapped.id;
        // The tapped thread with the vote its row shows now (one may still be on its way to the server).
        const item = viewerItemFromBuzz(isTapped ? { ...p, score: live.vote.score, myVote: live.vote.myVote } : p);
        if (!item) continue;
        if (isTapped) index = entries.length;
        entries.push(entryOf(item, isTapped ? live.slide : undefined, isTapped ? (live.time ?? undefined) : undefined, isTapped ? (live.player ?? undefined) : undefined));
      }
      if (index < 0) return;
      openViewer(router, { entries, index, origin: live.origin, then: { more: buzzAfter({ filters, offset: list.length, seen: new Set(list.map((p) => p.id)) }) } });
    },
    [router],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AnimatedFlatList
        ref={listRef}
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
                <Icon name="search" size={18} color={colors.muted} />
                <TextInput value={search} onChangeText={setSearch} placeholder="Search Buzz" placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} style={styles.searchInput} accessibilityLabel="Search Buzz" />
              </View>
              <Pressable onPress={create} style={styles.plus} accessibilityRole="button" accessibilityLabel="Post anonymously on Buzz">
                <Icon name="add" size={26} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -BUZZ_GUTTER }} contentContainerStyle={{ gap: 8, paddingHorizontal: BUZZ_GUTTER }} keyboardShouldPersistTaps="handled">
              <FilterPill label={labelFor(BUZZ_SORTS, sort)} icon={SORT_ICONS[sort]} caret onPress={pickSort} accessibilityLabel={`Sort: ${labelFor(BUZZ_SORTS, sort)}`} />
              {BUZZ_TOPICS.map((t) => (
                <FilterPill key={t.value} label={t.label} active={topic === t.value} onPress={() => setTopic(topic === t.value ? undefined : t.value)} />
              ))}
            </ScrollView>
            <View style={styles.notice}>
              <Icon name="eye-off-outline" size={13} color={colors.muted} />
              <Text style={styles.noticeText}>Buzz is anonymous. Nobody sees who wrote a post or a reply.</Text>
            </View>
            {error && items.length > 0 ? <ErrorBanner message={error} onRetry={refresh} /> : null}
          </View>
        }
        CellRendererComponent={appearCells}
        windowSize={11}
        maxToRenderPerBatch={8}
        renderItem={({ item }) =>
          searching ? (
            <BuzzSearchRow post={item} />
          ) : (
            <BuzzRow post={item} active={active && playingId === item.id} onVoteFor={voteThread} onMuted={reloadAfterMute} onOpenMedia={openInViewer} />
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
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(refresh)} progressViewOffset={ios ? undefined : topInset} tintColor={colors.brand} />}
      />
    </View>
  );
}

function Hairline() {
  const styles = useStyles();
  return <View style={styles.hairline} />;
}

const useStyles = makeStyles((colors) => ({
  header: { paddingHorizontal: BUZZ_GUTTER, paddingTop: 10, paddingBottom: 8, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  search: { flex: 1, height: 42, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: 21, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  plus: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  filter: { height: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.input },
  filterText: { fontSize: 13, fontWeight: "600" },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  notice: { flexDirection: "row", alignItems: "center", gap: 5 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 16, color: colors.muted },
  retry: { textAlign: "center", color: colors.brand, fontSize: 13, fontWeight: "600" },
  end: { textAlign: "center", color: colors.faint, fontSize: 12, paddingVertical: 12 },
}));
