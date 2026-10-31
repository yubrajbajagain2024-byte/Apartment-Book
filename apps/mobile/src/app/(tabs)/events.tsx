import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import { useIsFocused, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EVENT_CATEGORIES, EVENT_DATE_FILTERS, EVENT_SECTIONS, type EventCategory, type EventDateFilter, type EventSection } from "@apartment-book/shared";
import { AllEventsSection } from "@/components/events/all-events-section";
import { DEFAULT_EVENT_FILTERS, EventFilterSheet, eventFilterCount, type EventFilterChoice } from "@/components/events/event-filter-sheet";
import { categoryIcon } from "@/components/events/event-glyphs";
import { ForYouEventsSection } from "@/components/events/for-you-events-section";
import { Fab } from "@/components/feed-header";
import { Icon, type IconName } from "@/components/icon";
import { SlidingTabs } from "@/components/sliding-tabs";
import { useCampusTimeZone } from "@/lib/campus-time-zone";
import { useCollapsingHeader } from "@/lib/collapsing-header";
import { useCollapseOnScroll } from "@/lib/tab-bar-collapse";
import { useSession } from "@/lib/session";
import { auroraGradient, radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const ORDER = EVENT_SECTIONS.map((s) => s.value);
/** The title row, fixed under the safe area; the labels, the search box and the pills float and slide away like Explore's. */
const TITLE_ROW = 52;
const TABS_ROW = 44;
const SEARCH_ROW = 46 + space.md * 2;
const PILLS_ROW = 42;
const FLOAT = TABS_ROW + SEARCH_ROW + PILLS_ROW;
/** How much of the next pill stays in sight when the pills row scrolls to the chosen one. */
const PEEK = 36;
/** Each event type's name, for its chip in the pills row. */
const CATEGORY_LABELS = Object.fromEntries(EVENT_CATEGORIES.map((c) => [c.value, c.label])) as Record<EventCategory, string>;
/** A glyph for each date pill; Upcoming has none. */
const DATE_ICONS: Partial<Record<EventDateFilter, IconName>> = { today: "today-outline", week: "calendar-number-outline", weekend: "sunny-outline" };

/**
 * Events, the fourth tab, laid out like Explore: the big "Events" title with Saved at its right, then For you | All
 * events above a pager with Home's sliding underline, the inbox's search box (it searches events' titles, words and
 * places) with the Marketplace's round filter button beside it, and one row of pills that narrow both pages: when
 * (Upcoming, Today, This week, Weekend), then, after a hairline, the event types picked in the filter sheet, each with
 * an "×" to drop it. The button opens EventFilterSheet (When, and any number of event types: Academic, Career, Sports,
 * Social, Arts and the rest) and counts the choices in force. Everything comes from the campus's own calendars and its verified clubs, departments and
 * organizations (migration 61); For you ranks it for the person, All events is time order under day headings. The
 * floating "+" publishes an event for an organization the person belongs to. Everyone's events for someone without a
 * campus; the campus's clock for the times (lib/campus-time-zone).
 */
export default function EventsScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, profile } = useSession();
  const universityId = profile?.university_id ?? null;
  const timeZone = useCampusTimeZone(universityId);

  const pager = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  /** Page a label tap is scrolling to; swipe tracking waits until we get there so the labels do not flicker. */
  const target = useRef<number | null>(null);
  const ready = useRef(false);
  const initialOffset = useRef({ x: 0, y: 0 });
  const scrollX = useRef(new Animated.Value(0)).current;
  /** All events is mounted the first time it comes into view, so it does not load until someone looks at it. */
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([0]));
  // The bottom bar collapses to Events' button as the page on screen scrolls on and comes back as it scrolls back, as
  // on Home (lib/tab-bar-collapse.ts); the other page starts with the whole bar.
  const focused = useIsFocused();
  const trackTabBar = useCollapseOnScroll(focused, index);
  const { translateY: floatShift, select: followPage, reveal: revealFloat, onScroll: onPageScroll } = useCollapsingHeader(ORDER.length, FLOAT, 0, trackTabBar);

  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  // Wait until typing stops before searching.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  /** When and which event types: the pills set When, the filter sheet both. */
  const [filters, setFilters] = useState<EventFilterChoice>(DEFAULT_EVENT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { dateFilter, categories } = filters;
  const setDateFilter = (next: EventDateFilter) => setFilters((f) => (f.dateFilter === next ? f : { ...f, dateFilter: next }));
  const dropCategory = (drop: EventCategory) => setFilters((f) => ({ ...f, categories: f.categories.filter((c) => c !== drop) }));
  const activeFilters = eventFilterCount(filters);
  const section: EventSection = ORDER[index] ?? "foryou";

  const show = useCallback(
    (i: number) => {
      indexRef.current = i;
      setIndex(i);
      setMounted((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
      followPage(i);
    },
    [followPage],
  );
  const place = useCallback(() => {
    if (width <= 0) return;
    pager.current?.scrollTo({ x: indexRef.current * width, animated: false });
    ready.current = true;
  }, [width]);
  useEffect(() => {
    ready.current = false;
  }, [width]);
  const goTo = useCallback(
    (i: number) => {
      target.current = i;
      revealFloat();
      show(i);
      pager.current?.scrollTo({ x: i * width, animated: true });
    },
    [revealFloat, show, width],
  );
  function select(s: EventSection) {
    const i = ORDER.indexOf(s);
    if (i < 0 || i === indexRef.current) return;
    goTo(i);
  }
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0 || !ready.current) return;
      const pos = e.nativeEvent.contentOffset.x / width;
      if (target.current !== null) {
        if (Math.abs(pos - target.current) < 0.02) target.current = null;
        return;
      }
      const lo = Math.max(0, Math.floor(pos + 0.02));
      const hi = Math.min(ORDER.length - 1, Math.ceil(pos - 0.02));
      setMounted((prev) => (prev.has(lo) && prev.has(hi) ? prev : new Set(prev).add(lo).add(hi)));
      const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(pos)));
      if (i !== indexRef.current) show(i);
    },
    [show, width],
  );
  const onPagerScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true, listener: onScroll }), [onScroll, scrollX]);
  function onSettled(e: NativeSyntheticEvent<NativeScrollEvent>) {
    target.current = null;
    if (width <= 0) return;
    const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i !== indexRef.current) show(i);
  }

  // The pills row scrolls just enough to keep the chosen date pill in full view, Explore's way.
  const pillsRow = useRef<ScrollViewInstance>(null);
  const pillBoxes = useRef(new Map<string, { x: number; width: number }>());
  const pillsOffset = useRef(0);
  const pillsViewport = useRef(0);
  const pillsContent = useRef(0);
  const chosenPill = `d:${dateFilter}`;
  useEffect(() => {
    const box = pillBoxes.current.get(chosenPill);
    if (!box || pillsViewport.current <= 0) return;
    let x = pillsOffset.current;
    if (box.x - PEEK < x) x = box.x - PEEK;
    else if (box.x + box.width + PEEK > x + pillsViewport.current) x = box.x + box.width + PEEK - pillsViewport.current;
    x = Math.max(0, Math.min(x, pillsContent.current - pillsViewport.current));
    if (Math.abs(x - pillsOffset.current) > 1) pillsRow.current?.scrollTo({ x, animated: true });
  }, [chosenPill]);
  const onPillsScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    pillsOffset.current = e.nativeEvent.contentOffset.x;
  }, []);
  const pill = (key: string, label: string, selected: boolean, onPress: () => void, icon?: IconName) => (
    <Pressable
      key={key}
      onLayout={(e) => {
        pillBoxes.current.set(key, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width });
      }}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && { opacity: 0.7 }]}
    >
      {icon ? <Icon name={icon} size={14} color={selected ? colors.brand : colors.muted} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </Pressable>
  );
  const pageProps = { topInset: FLOAT, universityId, timeZone, q, dateFilter, categories };

  return (
    <View style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: insets.top }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            Events
          </Text>
          <Pressable onPress={() => router.push((user ? "/events/saved" : "/(auth)/login") as never)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Saved events" style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.6 }]}>
            <Icon name="bookmark-outline" size={24} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <View style={styles.body}>
        <Animated.View style={[styles.float, { transform: [{ translateY: floatShift }] }]}>
          <View style={styles.tabs}>
            <SlidingTabs sections={EVENT_SECTIONS} section={section} onSelect={select} scrollX={scrollX} pageWidth={width} tint={colors.accent} tintGradient={auroraGradient(colors.auroraGlow, 90)} labelColor={colors.text} dimColor={colors.muted} spread fontSize={16} />
          </View>
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <View style={styles.searchMark}>{text.trim() !== q ? <ActivityIndicator size="small" color={colors.muted} /> : <Icon name="search" size={18} color={colors.muted} />}</View>
              <TextInput value={text} onChangeText={setText} placeholder="Search events" placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel="Search events" style={styles.input} />
              {text ? (
                <Pressable onPress={() => setText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Icon name="close-circle" size={18} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
            {/* The Marketplace's round filter button beside the box: it opens the sheet and counts the choices in force. */}
            <Pressable onPress={() => setFiltersOpen(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={activeFilters > 0 ? `Filters, ${activeFilters} on` : "Filters"} accessibilityHint="Pick when, and which types of event" style={({ pressed }) => [styles.filterButton, activeFilters > 0 && styles.filterButtonOn, pressed && { opacity: 0.7 }]}>
              <Icon name="options-outline" size={22} color={activeFilters > 0 ? colors.brand : colors.text} />
              {activeFilters > 0 ? (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilters}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
          <ScrollView
            ref={pillsRow}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={onPillsScroll}
            scrollEventThrottle={32}
            onLayout={(e) => {
              pillsViewport.current = e.nativeEvent.layout.width;
            }}
            onContentSizeChange={(w) => {
              pillsContent.current = w;
            }}
            contentContainerStyle={styles.pills}
            accessibilityRole="tablist"
          >
            {EVENT_DATE_FILTERS.map((f) => pill(`d:${f.value}`, f.label, dateFilter === f.value, () => setDateFilter(f.value), DATE_ICONS[f.value]))}
            {categories.length > 0 ? <View style={styles.pillDivider} /> : null}
            {/* The event types in force, picked in the sheet: a tap drops one. */}
            {categories.map((c) => (
              <Pressable key={`c:${c}`} onPress={() => dropCategory(c)} accessibilityRole="button" accessibilityLabel={`${CATEGORY_LABELS[c]}, remove filter`} style={({ pressed }) => [styles.chip, styles.chipSelected, pressed && { opacity: 0.7 }]}>
                <Icon name={categoryIcon(c).name} size={14} color={colors.brand} />
                <Text style={[styles.chipText, styles.chipTextSelected]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  {CATEGORY_LABELS[c]}
                </Text>
                <Icon name="close" size={14} color={colors.brand} />
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
        <Animated.ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentOffset={initialOffset.current}
          scrollEventThrottle={16}
          onContentSizeChange={place}
          onScrollBeginDrag={() => {
            target.current = null;
            revealFloat();
          }}
          onScroll={onPagerScroll}
          onMomentumScrollEnd={onSettled}
          style={{ flex: 1 }}
        >
          {ORDER.map((s, i) => (
            <View key={s} style={{ width, flex: 1 }}>
              {!mounted.has(i) ? null : s === "all" ? <AllEventsSection active={section === "all"} onScroll={onPageScroll(i)} {...pageProps} /> : <ForYouEventsSection active={section === "foryou"} onScroll={onPageScroll(i)} {...pageProps} />}
            </View>
          ))}
        </Animated.ScrollView>
        <Fab href="/events/new" label="Create event" hint="Publish an event for a club, organization or department you belong to" />
      </View>
      <EventFilterSheet
        open={filtersOpen}
        value={filters}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  chrome: { backgroundColor: colors.bar, zIndex: 3 },
  titleRow: { height: TITLE_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingLeft: 20, paddingRight: space.md },
  title: { flexShrink: 1, ...textStyle.largeTitle, color: colors.text },
  titleButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  searchRow: { height: SEARCH_ROW, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 20 },
  search: { flex: 1, height: 46, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 16 },
  searchMark: { width: 20, alignItems: "center" },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  body: { flex: 1, overflow: "hidden" },
  float: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, backgroundColor: colors.bar },
  tabs: { height: TABS_ROW, flexDirection: "row", marginHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pills: { height: PILLS_ROW, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 20 },
  // The Marketplace's filter button exactly (app/(tabs)/housing.tsx).
  filterButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  filterButtonOn: { backgroundColor: colors.brandSoft },
  filterBadge: { position: "absolute", top: 3, right: 3, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  filterBadgeText: { fontSize: 10, fontWeight: "700", color: colors.onBrand },
  // The hairline between the date pills and the event types picked in the sheet.
  pillDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: colors.border, marginHorizontal: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.input },
  chipSelected: { backgroundColor: colors.brandSoft },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  chipTextSelected: { color: colors.brand },
}));
