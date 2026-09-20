import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewToken } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BUZZ_PAGE_SIZE, BUZZ_SORTS, BUZZ_TOPICS, listBuzz, type BuzzPost, type BuzzSort, type BuzzTopic } from "@apartment-book/shared";
import { Fab, FeedHeader } from "@/components/feed-header";
import { Segmented } from "@/components/form";
import { Chip, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";
import { BuzzCard, onBuzzEvent } from "./buzz-card";

const SORT_OPTIONS = BUZZ_SORTS.map((s) => ({ value: s.value as BuzzSort, label: s.label }));

/** Home → Buzz: anonymous Reddit-style threads. `topInset` is the height of the floating Home bar above the list. */
export function BuzzSection({ active, topInset }: { active: boolean; topInset: number }) {
  const { user, profile } = useSession();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
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
  // Only a card that is really on screen plays its video.
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => setVisible(new Set(viewableItems.map((v) => String(v.key))))).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;
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
  // iOS: an inset keeps the pull-to-refresh spinner below the floating bar. Android: padding + spinner offset.
  const ios = Platform.OS === "ios";
  const inset = useMemo(() => ({ top: topInset }), [topInset]);
  const startOffset = useMemo(() => ({ x: 0, y: -topInset }), [topInset]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 96, paddingTop: ios ? 12 : topInset + 12 }}
        contentInset={ios ? inset : undefined}
        contentOffset={ios ? startOffset : undefined}
        scrollIndicatorInsets={ios ? inset : undefined}
        automaticallyAdjustContentInsets={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <FeedHeader placeholder="Search Buzz" value={search} onChange={setSearch} />
            <Segmented options={SORT_OPTIONS} value={sort} onChange={setSort} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }} keyboardShouldPersistTaps="handled">
              {profile?.university_id ? <Chip label={allCampuses ? "All universities" : "My campus"} icon="school-outline" active={!allCampuses} onPress={() => setAllCampuses((v) => !v)} /> : null}
              {BUZZ_TOPICS.map((t) => (
                <Chip key={t.value} label={t.label} active={topic === t.value} onPress={() => setTopic(topic === t.value ? undefined : t.value)} />
              ))}
            </ScrollView>
            <View style={styles.notice}>
              <Ionicons name="eye-off-outline" size={14} color={colors.muted} />
              <Text style={styles.noticeText}>Buzz is anonymous. Other people never see who wrote a post or a reply.</Text>
            </View>
            {error && items.length > 0 ? <ErrorBanner message={error} onRetry={refresh} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <BuzzCard
            post={item}
            active={active && visible.has(item.id)}
            onChange={(next) => setItems((prev) => prev.map((p) => (p.id === next.id ? next : p)))}
            onRemoved={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
            onMuted={refresh}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <Loading />
          ) : error ? (
            <ErrorBanner message={error} onRetry={refresh} />
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
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={ios ? undefined : topInset} tintColor={colors.brand} />}
      />
      <Fab href="/create/buzz" label="Post anonymously on Buzz" />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  noticeText: { flex: 1, fontSize: 12, color: colors.muted },
  retry: { textAlign: "center", color: colors.brand, fontSize: 13, fontWeight: "600" },
  end: { textAlign: "center", color: colors.faint, fontSize: 12, paddingVertical: 12 },
});
