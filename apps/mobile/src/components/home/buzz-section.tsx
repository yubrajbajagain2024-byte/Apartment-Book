import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type FlatList, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useIsFocused, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  BUZZ_FEED_COPY,
  BUZZ_PAGE,
  BUZZ_PROMPT_COPY,
  BUZZ_SORT_OPTIONS,
  BUZZ_TOP_WINDOWS,
  getBuzzFeed,
  getBuzzMeta,
  type BuzzFeedSort,
  type BuzzScope,
  type BuzzTopWindow,
} from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { BuzzCardById, BuzzCardSkeleton, CARD_GAP, openThread } from "@/components/buzz/card";
import { BuzzComposer } from "@/components/buzz/composer";
import { BuzzFab } from "@/components/buzz/fab";
import { BuzzGatePanel, BuzzSignedOutPanel, useBuzzGate } from "@/components/buzz/gate";
import { BuzzActionsHost } from "@/components/buzz/item-menu";
import { BuzzToastHost } from "@/components/buzz/toast";
import { Chip, EmptyState, ErrorState, GUTTER, HERO_SOFT_GRADIENT, P, PButton, PIconButton, R, Segmented, T } from "@/components/buzz/ui";
import { useBuzzList, type BuzzListPage } from "@/components/buzz/use-buzz-list";
import { buzzState, feedKey, getBuzzState, onBuzzEvent, useBuzzState, type BuzzDraft, type BuzzUiState } from "@/lib/buzz-store";
import { AnimatedFlatList } from "@/lib/collapsing-header";
import { refreshWithHaptic } from "@/lib/haptics";
import { openHomeSection } from "@/lib/home-section";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useTabReselect } from "@/lib/tab-reselect";
import { BuzzViewerList } from "@/components/buzz/media";

/*
 * Home → Buzz (UniVerse's BuzzPane, design §7.2, SPEC §5.3), in Phosphor whatever the app's theme.
 *
 *  - Signed out: a sign-in prompt. Signed in without the current guidelines accepted: the inline gate panel (only while
 *    the page is the one on screen; otherwise an empty canvas, nothing loaded), "Not now" back to the section before.
 *  - Accepted: under Home's bar a filter bar (search pill, Hot | New | Top, Campus | Global) that slides up under the bar
 *    as the feed scrolls down and comes back as it scrolls up; Top adds Today | This week | All time; today's prompt (Hot
 *    only: "Answer anonymously" and, once anyone has, its thread with the answers, which Hot then leaves out of the
 *    list below); the small-campus note; the cold start (an empty campus Hot feed moves to Global with a banner); the cards;
 *    skeletons, empty states, the error state, more as you scroll ("That's everything for now"); the FAB (pen + mask)
 *    and the composer. Home's own bar stays put on this page, as on UniVerse: Buzz never feeds its collapse.
 *
 * Because posts publish after a random delay (jitter), there is no live push: the feed loads when it comes up, on pull to
 * refresh and after your own writes.
 */

const selectSort = (s: BuzzUiState) => s.sort;
const selectWindow = (s: BuzzUiState) => s.window;
const selectScope = (s: BuzzUiState) => s.scope;
const selectColdStart = (s: BuzzUiState) => s.coldStart;
const selectColdStartDismissed = (s: BuzzUiState) => s.coldStartDismissed;
const selectMeta = (s: BuzzUiState) => s.meta;
const selectCampus = (s: BuzzUiState) => s.campus;
const selectComposerRequest = (s: BuzzUiState) => s.composerRequest;

const SCOPES = [
  { value: "campus" as const, label: "Campus", icon: "school-outline" as const },
  { value: "global" as const, label: "Global", icon: "globe-outline" as const },
];
/** The filter bar's height before it has been measured. */
const FILTER_GUESS = 104;
/** How long a feed's meta (today's prompt, the small-campus note) is trusted. */
const META_FRESH_MS = 5 * 60_000;

type Row = { id: string };

export function BuzzSection({ active, topInset }: { active: boolean; topInset: number; onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
  const { user, loading } = useSession();
  const gate = useBuzzGate();
  const tabBar = useTabBarInset();

  let content = null;
  if (!loading && !user) content = active ? <Centered topInset={topInset} bottom={tabBar}><BuzzSignedOutPanel /></Centered> : null;
  else if (gate.status === "accepted") content = <Feed active={active} topInset={topInset} />;
  else if (!active) content = null;
  else if (gate.status === "required")
    content = (
      <Centered topInset={topInset} bottom={tabBar}>
        <BuzzGatePanel variant="pane" onDismiss={() => openHomeSection(getBuzzState().previousSection)} />
      </Centered>
    );
  else if (gate.status === "error")
    content = (
      <Centered topInset={topInset} bottom={tabBar}>
        <ErrorState title={BUZZ_FEED_COPY.loadError} message={gate.error} onRetry={gate.retry} />
      </Centered>
    );
  else
    content = (
      <View style={{ paddingTop: topInset + 16, paddingHorizontal: GUTTER, gap: CARD_GAP }} accessibilityLabel="Loading Buzz">
        <BuzzCardSkeleton />
        <BuzzCardSkeleton />
      </View>
    );

  return (
    <View style={styles.page}>
      {/* Home's own status bar follows the app's theme: on Buzz the clock is light over Phosphor. */}
      {active ? <StatusBar style="light" /> : null}
      {content}
    </View>
  );
}

/** The gate, the sign-in prompt and the error state: scrollable, under Home's bar, clear of the tab bar. */
function Centered({ topInset, bottom, children }: { topInset: number; bottom: number; children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={{ paddingTop: topInset + 16, paddingBottom: bottom + 24 }} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

const CardRow = memo(function CardRow({ id }: { id: string }) {
  return (
    <View style={styles.cardRow}>
      <BuzzCardById id={id} />
    </View>
  );
});

function Feed({ active, topInset }: { active: boolean; topInset: number }) {
  const router = useRouter();
  const focused = useIsFocused();
  const tabBar = useTabBarInset();
  const sort = useBuzzState(selectSort);
  const window = useBuzzState(selectWindow);
  const scope = useBuzzState(selectScope);
  const coldStart = useBuzzState(selectColdStart);
  const coldStartDismissed = useBuzzState(selectColdStartDismissed);
  const metaCache = useBuzzState(selectMeta);
  const campus = useBuzzState(selectCampus);
  const composerRequest = useBuzzState(selectComposerRequest);
  const [composerOpen, setComposerOpen] = useState(false);
  const [filterHeight, setFilterHeight] = useState(FILTER_GUESS);
  const listRef = useRef<FlatList<Row>>(null);
  const ios = Platform.OS === "ios";
  const insetTop = topInset + filterHeight;

  /* ---------- the feed ---------- */

  const key = feedKey(scope, sort, window);
  const load = useCallback(
    async (offset: number, rankAt: string | null): Promise<BuzzListPage<Row>> => {
      const page = await getBuzzFeed(supabase, { scope, sort, window, offset, rankAt, limit: BUZZ_PAGE.feed });
      return { rows: page.items.map((b) => ({ id: b.id })), items: page.items, nextOffset: page.nextOffset, rankAt: page.rankAt };
    },
    [scope, sort, window],
  );
  const restore = useCallback((k: string) => {
    const hit = getBuzzState().feeds[k];
    return hit ? { rows: hit.ids.map((id) => ({ id })), nextOffset: hit.nextOffset, rankAt: hit.rankAt, at: hit.at } : null;
  }, []);
  const onLoaded = useCallback((k: string, snap: { rows: Row[]; nextOffset: number | null; rankAt: string | null }) => {
    buzzState.setFeed(k, { ids: snap.rows.map((r) => r.id), nextOffset: snap.nextOffset, rankAt: snap.rankAt });
  }, []);
  const list = useBuzzList<Row>({ key, load, restore, onLoaded });
  const { remove, reloadQuietly } = list;

  // Hidden, reported or deleted anywhere: gone from here. Your own new buzz: load again.
  useEffect(
    () =>
      onBuzzEvent((e) => {
        if (e.type === "removed") remove(e.id);
        else if (e.type === "refresh" && (!e.scope || e.scope === getBuzzState().scope)) reloadQuietly();
      }),
    [remove, reloadQuietly],
  );

  /* ---------- meta: today's prompt, the small-campus note, the campus's name ---------- */

  const meta = metaCache[scope]?.value ?? null;
  const metaAt = metaCache[scope]?.at ?? 0;
  useEffect(() => {
    if (Date.now() - metaAt < META_FRESH_MS) return;
    let live = true;
    getBuzzMeta(supabase, scope).then(
      (m) => live && buzzState.setMeta(scope, m),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [scope, metaAt]);

  /* ---------- cold start: the campus Hot feed is empty on its first page → Global with a banner ---------- */

  useEffect(() => {
    if (scope === "campus" && sort === "hot" && list.key === key && list.status === "ready" && list.rows.length === 0 && !coldStartDismissed) buzzState.setScope("global", { coldStart: true });
  }, [scope, sort, key, list.key, list.status, list.rows.length, coldStartDismissed]);

  const chooseScope = useCallback((v: BuzzScope) => {
    buzzState.setScope(v);
    if (v === "campus") buzzState.dismissColdStart();
  }, []);

  /* ---------- the composer ---------- */

  const openComposer = useCallback((prefill?: Partial<BuzzDraft>) => {
    buzzState.prepareDraft(getBuzzState().scope, prefill);
    setComposerOpen(true);
  }, []);
  // Asked for from outside the page (the create menu, an old /create/buzz link): opens once the page is on screen.
  useEffect(() => {
    if (!active || !composerRequest) return;
    const r = buzzState.takeComposerRequest();
    if (r) openComposer(r.promptId ? { promptId: r.promptId } : undefined);
  }, [active, composerRequest, openComposer]);

  /* ---------- the filter bar and the FAB slide away as the feed scrolls down ---------- */

  const scrollY = useRef(new Animated.Value(ios ? -insetTop : 0)).current;
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }), [scrollY]);
  const hidden = useMemo(() => {
    const clampTop = { inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp" as const, extrapolateRight: "extend" as const };
    const fromTop = ios ? Animated.add(scrollY, insetTop).interpolate(clampTop) : scrollY.interpolate(clampTop);
    return Animated.diffClamp(fromTop, 0, Math.max(1, filterHeight));
  }, [scrollY, ios, insetTop, filterHeight]);
  const barY = useMemo(() => Animated.multiply(hidden, -1), [hidden]);
  // iOS: a list resting at the top stays there when the inset above it changes (the filter bar measured, a new text size).
  const restingY = useRef<number | null>(null);
  const placedInset = useRef(insetTop);
  useEffect(() => {
    if (!ios || placedInset.current === insetTop) return;
    const wasAtTop = restingY.current === null || Math.abs(restingY.current + placedInset.current) < 2;
    placedInset.current = insetTop;
    if (!wasAtTop) return;
    scrollY.setValue(-insetTop);
    listRef.current?.scrollToOffset({ offset: -insetTop, animated: false });
  }, [ios, insetTop, scrollY]);
  const noteRest = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    restingY.current = e.nativeEvent.contentOffset.y;
  }, []);
  const fabY = useMemo(() => hidden.interpolate({ inputRange: [0, Math.max(1, filterHeight)], outputRange: [0, tabBar + 96], extrapolate: "clamp" }), [hidden, filterHeight, tabBar]);
  const onFilterLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setFilterHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  // Tapping Home again while Buzz is on screen: back to the top.
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: ios ? -insetTop : 0, animated: true }), active);

  /* ---------- the list ---------- */

  const where = scope === "campus" ? (campus?.shortName ?? meta?.campus?.shortName ?? "campus") : "Global";
  // Today's prompt thread is the prompt card in Hot (with its answers): not a second time in the list below it.
  const promptThread = meta?.prompt?.threadId ?? null;
  const promptAnswers = meta?.prompt?.answers ?? 0;
  const rows = useMemo(() => (sort === "hot" && promptThread ? list.rows.filter((r) => r.id !== promptThread) : list.rows), [sort, promptThread, list.rows]);
  const university = campus?.name ?? meta?.campus?.name ?? "your campus";
  const header = (
    <View style={styles.header}>
      {sort === "top" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.windows} accessibilityLabel="Top window">
          {BUZZ_TOP_WINDOWS.map((w) => (
            <Chip key={w.value} label={w.label} selected={window === w.value} onPress={() => buzzState.setWindow(w.value as BuzzTopWindow)} />
          ))}
        </ScrollView>
      ) : null}
      {coldStart && !coldStartDismissed && scope === "global" ? (
        <View style={styles.coldStart} accessibilityRole="summary">
          <Text style={[T.footnote, styles.flex, { color: P.ink }]}>{BUZZ_FEED_COPY.coldStart(university)}</Text>
          <PButton title={BUZZ_FEED_COPY.coldStartAction} variant="secondary" size="sm" onPress={() => openComposer()} />
          <PIconButton icon="close" label="Dismiss" onPress={() => buzzState.dismissColdStart()} size={32} iconSize={16} />
        </View>
      ) : null}
      {meta?.smallCampusNote && scope === "campus" ? (
        <View style={styles.smallCampus}>
          <Text style={[T.footnote, { color: P.ink3 }]}>{BUZZ_FEED_COPY.smallCampus}</Text>
        </View>
      ) : null}
      {meta?.prompt && sort === "hot" ? (
        <View style={styles.prompt}>
          <View style={styles.promptHead}>
            <Icon name="sparkles" size={15} color={P.accentInk} />
            <Text style={[T.overline, { color: P.accentInk }]}>{BUZZ_FEED_COPY.promptOverline}</Text>
          </View>
          <Text style={[T.headline, { color: P.ink, fontSize: 17, lineHeight: 23 }]}>{meta.prompt.text}</Text>
          <View style={styles.promptActions}>
            <PButton title={BUZZ_FEED_COPY.promptAction} variant="secondary" size="sm" onPress={() => openComposer({ promptId: meta.prompt!.id, promptMode: "thread" })} />
            {promptThread && promptAnswers > 0 ? (
              <Pressable onPress={() => openThread(router, promptThread)} hitSlop={8} accessibilityRole="link" accessibilityHint="Opens the prompt's thread" style={({ pressed }) => [styles.promptLink, pressed && { opacity: 0.75 }]}>
                <Text style={[T.labelSm, { color: P.accentInk }]}>{BUZZ_PROMPT_COPY.seeAnswers(promptAnswers)}</Text>
                <Icon name="chevron-forward" size={14} color={P.accentInk} />
              </Pressable>
            ) : meta.prompt.threadId !== undefined ? (
              <Text style={[T.caption, styles.flex, { color: P.ink3 }]}>{BUZZ_PROMPT_COPY.first}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );

  const empty =
    list.status === "loading" || list.status === "idle" ? (
      <View style={styles.cards} accessibilityLabel="Loading Buzz">
        <BuzzCardSkeleton />
        <BuzzCardSkeleton />
        <BuzzCardSkeleton />
      </View>
    ) : list.status === "error" ? (
      <ErrorState title={BUZZ_FEED_COPY.loadError} message={list.error} onRetry={list.reloadQuietly} />
    ) : (
      <FeedEmpty sort={sort} window={window} scope={scope} university={university} onSeeGlobal={() => chooseScope("global")} onCheckNew={() => buzzState.setSort("new")} onPost={() => openComposer()} />
    );

  const footer = list.loadingMore ? (
    <View style={[styles.cards, { paddingTop: CARD_GAP }]}>
      <BuzzCardSkeleton />
    </View>
  ) : list.moreError ? (
    <Pressable onPress={() => void list.loadMore()} accessibilityRole="button" style={styles.end}>
      <Text style={[T.footnote, { color: P.accentInk }]}>Couldn't load more. Tap to try again.</Text>
    </Pressable>
  ) : list.ended && list.rows.length > 0 ? (
    <View style={styles.end}>
      <Text style={[T.caption, { color: P.ink4 }]}>{BUZZ_FEED_COPY.end}</Text>
    </View>
  ) : null;

  return (
    <BuzzViewerList.Provider value={list.viewerPages}>
      <BuzzActionsHost>
        <View style={styles.flex}>
          <AnimatedFlatList
            ref={listRef}
            data={list.status === "ready" ? rows : []}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => <CardRow id={item.id} />}
            ItemSeparatorComponent={Separator}
            ListHeaderComponent={header}
            ListEmptyComponent={empty}
            ListFooterComponent={footer ?? undefined}
            onEndReached={() => {
              if (!list.moreError) void list.loadMore();
            }}
            onEndReachedThreshold={0.8}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onScrollEndDrag={noteRest}
            onMomentumScrollEnd={noteRest}
            contentContainerStyle={{ paddingTop: ios ? 0 : insetTop, paddingBottom: tabBar + 96 }}
            contentInset={ios ? { top: insetTop } : undefined}
            contentOffset={ios ? { x: 0, y: -insetTop } : undefined}
            scrollIndicatorInsets={ios ? { top: insetTop } : undefined}
            automaticallyAdjustContentInsets={false}
            keyboardShouldPersistTaps="handled"
            indicatorStyle="white"
            windowSize={9}
            maxToRenderPerBatch={6}
            initialNumToRender={6}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={refreshWithHaptic(list.refresh)} tintColor={P.accent} colors={[P.accent]} progressBackgroundColor={P.surface2} progressViewOffset={ios ? undefined : insetTop} />}
          />
          {/* The filter bar, under Home's bar: it slides up beneath it as the feed scrolls down. */}
          <Animated.View onLayout={onFilterLayout} style={[styles.filterBar, { top: topInset, transform: [{ translateY: barY }] }]}>
            <Pressable
              onPress={() => {
                buzzState.setSearch({ scope });
                router.push("/buzz/search" as never);
              }}
              accessibilityRole="search"
              accessibilityLabel={BUZZ_FEED_COPY.searchPlaceholder(where)}
              style={({ pressed }) => [styles.searchPill, pressed && { opacity: 0.85 }]}
            >
              <Icon name="search" size={18} color={P.ink3} />
              <Text style={[T.body, styles.flex, { color: P.ink3 }]} numberOfLines={1}>
                {BUZZ_FEED_COPY.searchPlaceholder(where)}
              </Text>
            </Pressable>
            <View style={styles.filters}>
              <Segmented<BuzzFeedSort> label="Sort" value={sort} options={BUZZ_SORT_OPTIONS} onChange={(v) => buzzState.setSort(v)} />
              <Segmented<BuzzScope> label="Feed scope" value={scope} options={SCOPES} onChange={chooseScope} />
            </View>
          </Animated.View>
          <BuzzFab onPress={() => openComposer()} bottom={tabBar + 12} translateY={fabY} />
          <BuzzToastHost bottom={tabBar + 84} enabled={active && focused} />
        </View>
        <BuzzComposer visible={composerOpen} onClose={() => setComposerOpen(false)} onAnswered={(threadId, replyId) => openThread(router, threadId, replyId)} />
      </BuzzActionsHost>
    </BuzzViewerList.Provider>
  );
}

function Separator() {
  return <View style={{ height: CARD_GAP }} />;
}

/** UniVerse's FeedEmpty: what an empty feed says, and what it offers. */
function FeedEmpty({ sort, window, scope, university, onSeeGlobal, onCheckNew, onPost }: { sort: BuzzFeedSort; window: BuzzTopWindow; scope: BuzzScope; university: string; onSeeGlobal: () => void; onCheckNew: () => void; onPost: () => void }) {
  if (sort === "top" && window === "day") return <EmptyState icon="compass-outline" title={BUZZ_FEED_COPY.topTodayEmpty} action={{ label: BUZZ_FEED_COPY.checkNew, onPress: onCheckNew }} />;
  if (scope === "campus") return <EmptyState title={BUZZ_FEED_COPY.campusEmpty(university)} action={{ label: BUZZ_FEED_COPY.startFirst, onPress: onPost }} secondary={{ label: BUZZ_FEED_COPY.seeGlobal, onPress: onSeeGlobal }} />;
  return <EmptyState title={BUZZ_FEED_COPY.globalEmptyTitle} body={BUZZ_FEED_COPY.globalEmptyBody} action={{ label: BUZZ_FEED_COPY.startFirst, onPress: onPost }} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: P.canvas },
  header: { gap: 12, paddingBottom: CARD_GAP },
  cards: { paddingHorizontal: GUTTER, gap: CARD_GAP },
  cardRow: { paddingHorizontal: GUTTER },
  windows: { gap: 8, paddingHorizontal: GUTTER },
  coldStart: { marginHorizontal: GUTTER, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 6, paddingVertical: 10, borderRadius: R.lg, borderCurve: "continuous", borderWidth: 1, borderColor: P.accentLine, backgroundColor: P.surface1, experimental_backgroundImage: HERO_SOFT_GRADIENT },
  smallCampus: { marginHorizontal: GUTTER, paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.md, borderCurve: "continuous", backgroundColor: P.surface2 },
  prompt: { marginHorizontal: GUTTER, gap: 12, padding: 16, borderRadius: R.lg, borderCurve: "continuous", borderWidth: 1, borderColor: P.accentLine, backgroundColor: P.surface1, experimental_backgroundImage: HERO_SOFT_GRADIENT },
  promptHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  promptActions: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  promptLink: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36 },
  end: { alignItems: "center", paddingVertical: 20 },
  filterBar: { position: "absolute", left: 0, right: 0, gap: 8, paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 10, backgroundColor: P.canvas },
  searchPill: { height: 42, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: P.surface2 },
  filters: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
});
