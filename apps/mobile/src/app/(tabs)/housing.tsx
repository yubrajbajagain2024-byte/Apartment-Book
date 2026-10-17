import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView as ScrollViewType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_HOUSING_SECTION, HOUSING_SECTIONS, ITEM_CATEGORIES, type HousingSection, type ItemCategoryValue } from "@apartment-book/shared";
import { Fab } from "@/components/feed-header";
import { ApartmentsSection } from "@/components/housing/apartments-section";
import { MarketplaceSection } from "@/components/housing/marketplace-section";
import { RoommatesSection, type RoommateType } from "@/components/housing/roommates-section";
import { SlidingTabs } from "@/components/sliding-tabs";
import { useCollapsingHeader } from "@/lib/collapsing-header";
import { hapticSwipe } from "@/lib/haptics";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const ORDER = HOUSING_SECTIONS.map((s) => s.value);
const START = Math.max(0, ORDER.indexOf(DEFAULT_HOUSING_SECTION));
/** The page a link's `section` parameter names (/housing?section=marketplace, where the old Marketplace address lands), or -1. */
function pageOf(section: string | undefined): number {
  return section ? ORDER.indexOf(section as HousingSection) : -1;
}
/** The title row (or the search box in its place), fixed under the safe area. */
const TITLE_ROW = 52;
/** The Room | Roommate | Marketplace row and the pills under it: they float over the pager and slide up under the title as the page on screen scrolls. */
const TABS_ROW = 44;
const PILLS_ROW = 42;
const FLOAT = TABS_ROW + PILLS_ROW;

/** Every page shows the person's own university (everyone's without a university of their own): there is no campus switch here. */
const CAMPUS = "mine" as const;
/** How much of the next pill stays in sight when the pills row scrolls to the chosen one, so it is clear there is more. */
const PEEK = 36;

type Pill = { key: string; label: string; icon?: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void };

/**
 * Explore, laid out like the Messages tab: the big "Find" title with the magnifier at the right of the same row (a tap turns the row into a search box for
 * the page on screen, Cancel brings the title back), then Room | Roommate | Marketplace above the pager with
 * Home's sliding violet underline (no menu under the labels: every page shows the person's own university, or every
 * university without one), and the pills that narrow the page on screen: All on Apartments, All | Has a room | Looking for a room on Roommates, All and
 * the item categories on Marketplace. The three pages sit side by side in a pager (a swipe or a tap on a label moves
 * between them, with Home's clear haptic each time the page changes, by tap or swipe); the labels and the pills float
 * over it and slide up under the title as the page on screen scrolls down, back as soon as it scrolls up
 * (useCollapsingHeader). The floating "+" follows the visible page. A link to the
 * tab can name the page to open (?section=marketplace).
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [type, setType] = useState<RoommateType | undefined>();
  const [category, setCategory] = useState<ItemCategoryValue | null>(null);
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

  const closeSearch = useCallback(() => {
    setQ("");
    setSearchOpen(false);
    Keyboard.dismiss();
  }, []);
  // Android's back button leaves the search before it leaves the tab.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || !searchOpen) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        closeSearch();
        return true;
      });
      return () => sub.remove();
    }, [searchOpen, closeSearch]),
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: insets.top }]}>
        {searchOpen ? (
          <View style={styles.searchRow}>
            <View style={styles.search}>
              {/* The same slot for the magnifier and the Marketplace's spinner, so the words never shift. */}
              <View style={styles.searchMark}>{section === "marketplace" && busy ? <ActivityIndicator size="small" color={colors.muted} /> : <Ionicons name="search" size={18} color={colors.muted} />}</View>
              <TextInput value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} returnKeyType="search" autoCorrect={false} autoCapitalize="none" autoFocus accessibilityLabel={placeholder} style={styles.input} />
              {q ? (
                <Pressable onPress={() => setQ("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={18} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
            <Pressable onPress={closeSearch} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel search" style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              Find
            </Text>
            <Pressable onPress={() => setSearchOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={placeholder} style={({ pressed }) => [styles.magnifier, pressed && { opacity: 0.6 }]}>
              <Ionicons name="search-outline" size={26} color={colors.text} />
            </Pressable>
          </View>
        )}
      </View>
      {/* Clipped, so the labels and pills slid up out of the way never show over the title. */}
      <View style={styles.body}>
        <Animated.View style={[styles.float, { transform: [{ translateY: floatShift }] }]}>
          <View style={styles.tabs}>
            {/* Spread like Home's four labels: three labels do not fit a phone with the inbox's gap. */}
            <SlidingTabs sections={HOUSING_SECTIONS} section={section} onSelect={select} scrollX={scrollX} pageWidth={width} tint={colors.accent} labelColor={colors.text} dimColor={colors.muted} spread fontSize={16} />
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
                {p.icon ? <Ionicons name={p.icon} size={14} color={p.selected ? colors.brand : colors.muted} /> : null}
                <Text style={[styles.chipText, p.selected && styles.chipTextSelected]} numberOfLines={1}>
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
                <RoommatesSection topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} type={type} />
              ) : s === "marketplace" ? (
                <MarketplaceSection topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} category={category} onCategoryChange={pickCategory} onSearchBusy={setBusy} />
              ) : (
                <ApartmentsSection topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} />
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
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  chrome: { backgroundColor: colors.bar, zIndex: 3 },
  titleRow: { height: TITLE_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingLeft: 20, paddingRight: space.lg },
  title: { flexShrink: 1, fontSize: 30, fontWeight: "800", letterSpacing: -0.5, color: colors.text },
  magnifier: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  searchRow: { height: TITLE_ROW, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 20 },
  // The input fill, not the card colour: the screen behind it is white in light and black in dark.
  search: { flex: 1, height: 40, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 14 },
  searchMark: { width: 20, alignItems: "center" },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  cancel: { fontSize: 15, fontWeight: "600", color: colors.text },
  body: { flex: 1, overflow: "hidden" },
  float: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, backgroundColor: colors.bar },
  // The labels row, as tall as Home's, with the hairline the sliding underline sits on.
  tabs: { height: TABS_ROW, flexDirection: "row", marginHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pills: { height: PILLS_ROW, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 20 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.input },
  chipSelected: { backgroundColor: colors.brandSoft },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  chipTextSelected: { color: colors.brand },
}));
