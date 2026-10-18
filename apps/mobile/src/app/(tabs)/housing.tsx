import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView as ScrollViewType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_HOUSING_SECTION, HOUSING_SECTIONS, ITEM_CATEGORIES, type HousingSection, type ItemCategoryValue } from "@apartment-book/shared";
import { Fab } from "@/components/feed-header";
import { ApartmentsSection } from "@/components/housing/apartments-section";
import { activeFilterCount, DEFAULT_FILTERS, FilterSheet, type ExploreFilters } from "@/components/housing/filter-sheet";
import { MarketplaceSection } from "@/components/housing/marketplace-section";
import { RoommatesSection, type RoommateType } from "@/components/housing/roommates-section";
import { SlidingTabs } from "@/components/sliding-tabs";
import { useCollapsingHeader } from "@/lib/collapsing-header";
import { hapticSwipe } from "@/lib/haptics";
// Aliased: the screen keeps a `type` state (the roommate post kind) of its own.
import { radius, space, type as typeScale } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const ORDER = HOUSING_SECTIONS.map((s) => s.value);
const START = Math.max(0, ORDER.indexOf(DEFAULT_HOUSING_SECTION));
/** The page a link's `section` parameter names (/housing?section=marketplace, where the old Marketplace address lands), or -1. */
function pageOf(section: string | undefined): number {
  return section ? ORDER.indexOf(section as HousingSection) : -1;
}
/** The title row (or the search box in its place), fixed under the safe area. */
const TITLE_ROW = 52;
/**
 * The Room | Roommate | Marketplace row, the search box and the pills under it: they float over the pager and slide up
 * under the title as the page on screen scrolls. The search box is the inbox's: a 46pt pill with 12pt above and below.
 */
const TABS_ROW = 44;
const SEARCH_ROW = 46 + space.md * 2;
const PILLS_ROW = 42;
const FLOAT = TABS_ROW + SEARCH_ROW + PILLS_ROW;

/** Every page shows the person's own university (everyone's without a university of their own): there is no campus switch here. */
const CAMPUS = "mine" as const;
/** How much of the next pill stays in sight when the pills row scrolls to the chosen one, so it is clear there is more. */
const PEEK = 36;

type Pill = { key: string; label: string; icon?: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void };

/**
 * Explore, laid out like the Messages tab: the big "Find" title, then Room | Roommate | Marketplace above the pager with
 * Home's sliding violet underline (each label centred in an equal third of the row), the inbox's search box under them
 * (it searches the page on screen), and the pills that narrow that page: All on Room, All | Has a room | Looking for a
 * room on Roommate, All and the item categories on Marketplace. The three pages sit side by side in a pager (a swipe or
 * a tap on a label moves between them, with Home's clear haptic each time the page changes); the labels, the box and
 * the pills float over it and slide up under the title as the page on screen scrolls down, back as soon as it scrolls up
 * (useCollapsingHeader). The floating "+" follows the visible page. A link to the tab can name the page to open
 * (?section=marketplace).
 */
export default function HousingScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ section: string }>();
  /** The page to open on: the one the link asked for, else Apartments. Read once; a later link is handled below. */
  const start = useRef(pageOf(params.section) >= 0 ? pageOf(params.section) : START).current;
  const pager = useRef<ScrollViewType>(null);
  const [index, setIndex] = useState(start);
  const indexRef = useRef(start);
  /** Page a label tap is scrolling to; swipe tracking waits until we get there so the labels do not flicker. */
  const target = useRef<number | null>(null);
  /** False until the pager has been placed on the starting page, so the first layout cannot change the page by accident. */
  const ready = useRef(false);
  /** Same object on every render: a new one would send the pager back to the starting page. */
  const initialOffset = useRef({ x: start * width, y: 0 });
  /** The pager's offset, kept up to date on the native side so the underline slides with the finger. */
  const scrollX = useRef(new Animated.Value(start * width)).current;
  /** Pages are mounted the first time they come into view, so Roommates and the Marketplace do not load until someone looks at them. */
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([start]));
  const { translateY: floatShift, select: followPage, reveal: revealFloat, onScroll: onPageScroll } = useCollapsingHeader(ORDER.length, FLOAT, start);

  // The search and the filters, shared by the pages (what does not apply to a page is simply not used there).
  const [q, setQ] = useState("");
  const [type, setType] = useState<RoommateType | undefined>();
  const [category, setCategory] = useState<ItemCategoryValue | null>(null);
  /** The filter sheet's choices, one set per page; the button beside the search box opens the sheet for the page on screen. */
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** The Marketplace grid is still catching up with the words typed: the search box shows a spinner in place of its magnifier. */
  const [busy, setBusy] = useState(false);

  const section: HousingSection = ORDER[index] ?? DEFAULT_HOUSING_SECTION;

  const show = useCallback(
    (i: number) => {
      indexRef.current = i;
      setIndex(i);
      setMounted((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
      followPage(i);
    },
    [followPage],
  );

  // Keep the current page in place when the pager is first laid out and when the screen width changes.
  const place = useCallback(() => {
    if (width <= 0) return;
    pager.current?.scrollTo({ x: indexRef.current * width, animated: false });
    ready.current = true;
  }, [width]);
  useEffect(() => {
    ready.current = false;
  }, [width]);

  /** Moves the pager to page i: a label tap, or a link naming the page. */
  const goTo = useCallback(
    (i: number) => {
      target.current = i;
      revealFloat();
      show(i);
      pager.current?.scrollTo({ x: i * width, animated: true });
    },
    [revealFloat, show, width],
  );

  /** A label moves the pager to its page, with the same knock a swipe gives. */
  function select(s: HousingSection) {
    const i = ORDER.indexOf(s);
    if (i < 0 || i === indexRef.current) return;
    hapticSwipe();
    goTo(i);
  }

  // A later link to the tab naming a page (the old /marketplace address, say) moves the pager there: no haptic for a move nobody made.
  const linked = useRef(params.section);
  useEffect(() => {
    if (params.section === linked.current) return;
    linked.current = params.section;
    const i = pageOf(params.section);
    if (i >= 0 && i !== indexRef.current) goTo(i);
  }, [params.section, goTo]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0 || !ready.current) return;
      const pos = e.nativeEvent.contentOffset.x / width;
      if (target.current !== null) {
        if (Math.abs(pos - target.current) < 0.02) target.current = null;
        return;
      }
      // Mount the neighbour as soon as a swipe starts to reveal it.
      const lo = Math.max(0, Math.floor(pos + 0.02));
      const hi = Math.min(ORDER.length - 1, Math.ceil(pos - 0.02));
      setMounted((prev) => (prev.has(lo) && prev.has(hi) ? prev : new Set(prev).add(lo).add(hi)));
      // The page under the finger changes at the halfway point of a swipe: one clear knock each time, like Home.
      const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(pos)));
      if (i !== indexRef.current) {
        hapticSwipe();
        show(i);
      }
    },
    [show, width],
  );
  // One handler for both jobs: scrollX follows the finger on the UI thread, the page tracking above runs as its listener.
  const onPagerScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true, listener: onScroll }), [onScroll, scrollX]);

  function onSettled(e: NativeSyntheticEvent<NativeScrollEvent>) {
    target.current = null;
    if (width <= 0) return;
    const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
    // A flick the scroll events missed still lands on another page: the knock plays here instead.
    if (i !== indexRef.current) {
      hapticSwipe();
      show(i);
    }
  }

  /** A category pill (or the empty grid's "Search all categories"). The pills play no haptic: only a page change does. */
  function pickCategory(next: ItemCategoryValue | null) {
    if (next !== category) setCategory(next);
  }
  const pills: Pill[] =
    section === "apartments"
      ? [{ key: "all", label: "All", selected: true, onPress: () => undefined }]
      : section === "roommates"
        ? [
            { key: "all", label: "All", selected: type === undefined, onPress: () => setType(undefined) },
            { key: "has_room", label: "Has a room", selected: type === "has_room", onPress: () => setType("has_room") },
            { key: "needs_room", label: "Looking for a room", selected: type === "needs_room", onPress: () => setType("needs_room") },
          ]
        : [{ key: "all", label: "All", selected: category === null, onPress: () => pickCategory(null) }, ...ITEM_CATEGORIES.map((c) => ({ key: c.value, label: c.label, selected: category === c.value, onPress: () => pickCategory(c.value) }))];
  const placeholder = section === "apartments" ? "Search apartments" : section === "roommates" ? "Search roommate posts" : "Search marketplace";
  const activeFilters = activeFilterCount(section, filters);

  // The pills row scrolls just enough to keep the chosen pill in full view (the Marketplace has a dozen), the old category pills' way.
  const pillsRow = useRef<ScrollViewType>(null);
  const pillBoxes = useRef(new Map<string, { x: number; width: number }>());
  const pillsOffset = useRef(0);
  const pillsViewport = useRef(0);
  const pillsContent = useRef(0);
  const chosenPill = pills.find((p) => p.selected)?.key;
  useEffect(() => {
    const box = chosenPill ? pillBoxes.current.get(chosenPill) : undefined;
    if (!box || pillsViewport.current <= 0) return;
    let x = pillsOffset.current;
    if (box.x - PEEK < x) x = box.x - PEEK;
    else if (box.x + box.width + PEEK > x + pillsViewport.current) x = box.x + box.width + PEEK - pillsViewport.current;
    x = Math.max(0, Math.min(x, pillsContent.current - pillsViewport.current));
    if (Math.abs(x - pillsOffset.current) > 1) pillsRow.current?.scrollTo({ x, animated: true });
  }, [section, chosenPill]);
  const onPillsScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    pillsOffset.current = e.nativeEvent.contentOffset.x;
  }, []);

  return (
    <View style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: insets.top }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            Find
          </Text>
        </View>
      </View>
      {/* Clipped, so the labels and pills slid up out of the way never show over the title. */}
      <View style={styles.body}>
        <Animated.View style={[styles.float, { transform: [{ translateY: floatShift }] }]}>
          <View style={styles.tabs}>
            {/* Spread like Home's four labels: three labels do not fit a phone with the inbox's gap. */}
            <SlidingTabs sections={HOUSING_SECTIONS} section={section} onSelect={select} scrollX={scrollX} pageWidth={width} tint={colors.accent} labelColor={colors.text} dimColor={colors.muted} spread fontSize={16} />
          </View>
          {/* The inbox's search box, searching the page on screen; the Marketplace's spinner takes the magnifier's slot while its grid catches up. */}
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <View style={styles.searchMark}>{section === "marketplace" && busy ? <ActivityIndicator size="small" color={colors.muted} /> : <Ionicons name="search" size={18} color={colors.muted} />}</View>
              <TextInput value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel={placeholder} style={styles.input} />
              {q ? (
                <Pressable onPress={() => setQ("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={18} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
            {/* The round filter button beside the box: it opens the sheet for the page on screen and counts the choices in force. */}
            <Pressable onPress={() => setFiltersOpen(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={activeFilters > 0 ? `Filters, ${activeFilters} on` : "Filters"} accessibilityHint="Sort and narrow the page on screen" style={({ pressed }) => [styles.filterButton, activeFilters > 0 && styles.filterButtonOn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="options-outline" size={22} color={activeFilters > 0 ? colors.brand : colors.text} />
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
            // While the search keyboard is up, the first tap on a pill already picks it.
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
            {pills.map((p) => (
              <Pressable
                key={p.key}
                onLayout={(e) => {
                  pillBoxes.current.set(p.key, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width });
                }}
                onPress={p.onPress}
                accessibilityRole="tab"
                accessibilityLabel={p.label}
                accessibilityState={{ selected: p.selected }}
                style={({ pressed }) => [styles.chip, p.selected && styles.chipSelected, pressed && !p.selected && { opacity: 0.7 }]}
              >
                {p.icon ? <Ionicons name={p.icon} size={14} color={p.selected ? colors.text : colors.muted} /> : null}
                {/* The pills follow the text size as far as the labels above them do, so "All" never ends in an ellipsis. */}
                <Text style={[styles.chipText, p.selected && styles.chipTextSelected]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  {p.label}
                </Text>
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
            // The labels come back for the swipe, wherever the page had scrolled them.
            revealFloat();
          }}
          onScroll={onPagerScroll}
          onMomentumScrollEnd={onSettled}
          style={{ flex: 1 }}
        >
          {ORDER.map((s, i) => (
            <View key={s} style={{ width, flex: 1 }}>
              {!mounted.has(i) ? null : s === "roommates" ? (
                <RoommatesSection topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} type={type} filters={filters.roommates} filtered={activeFilterCount("roommates", filters) > 0} />
              ) : s === "marketplace" ? (
                <MarketplaceSection topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} category={category} onCategoryChange={pickCategory} onSearchBusy={setBusy} filters={filters.marketplace} filtered={activeFilterCount("marketplace", filters) > 0} />
              ) : (
                <ApartmentsSection topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} filters={filters.apartments} filtered={activeFilterCount("apartments", filters) > 0} />
              )}
            </View>
          ))}
        </Animated.ScrollView>
        {/* One "+" for whichever page is showing; it is absolutely positioned, so it floats over all the pages. Signed out it goes to log in. */}
        <Fab
          href={section === "apartments" ? "/create/apartment" : section === "roommates" ? "/create/roommate" : "/create/item"}
          label={section === "apartments" ? "List an apartment" : section === "roommates" ? "Create roommate post" : "Sell an item"}
        />
      </View>
      <FilterSheet
        section={section}
        open={filtersOpen}
        filters={filters}
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
  titleRow: { height: TITLE_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingLeft: 20, paddingRight: space.lg },
  // The serif of the app's own bars (see type.title), a step larger than the Home wordmark: this is a page's title.
  title: { ...typeScale.title, fontSize: 28, lineHeight: 34, flexShrink: 1, color: colors.text },
  searchRow: { height: SEARCH_ROW, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 20 },
  // As tall as the box, round, on the same fill; while a filter is in force it takes a chip's selected look (an ink ring
  // on the warm wash), with the count on its corner.
  filterButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.input, borderWidth: 1, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  filterButtonOn: { backgroundColor: colors.brandSoft, borderColor: colors.text },
  filterBadge: { position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  filterBadgeText: { fontSize: 10, lineHeight: 12, fontWeight: "700", color: colors.onBrand },
  // The input fill, not the card colour: the screen behind it is white in light and black in dark. The inbox's box exactly.
  search: { flex: 1, height: 46, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 16 },
  searchMark: { width: 20, alignItems: "center" },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  body: { flex: 1, overflow: "hidden" },
  float: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, backgroundColor: colors.bar },
  // The labels row, as tall as Home's, with the hairline the sliding underline sits on.
  tabs: { height: TABS_ROW, flexDirection: "row", marginHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pills: { height: PILLS_ROW, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 20 },
  // The design system's Chip: a hairline capsule at rest, an ink outline on the warm wash once chosen.
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: "transparent" },
  chipSelected: { backgroundColor: colors.brandSoft, borderColor: colors.text },
  chipText: { ...typeScale.label, fontSize: 13, color: colors.muted },
  chipTextSelected: { color: colors.text },
}));
