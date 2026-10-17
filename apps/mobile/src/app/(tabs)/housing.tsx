import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView as ScrollViewType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_HOUSING_SECTION, HOUSING_SECTIONS, type HousingSection } from "@apartment-book/shared";
import { Fab } from "@/components/feed-header";
import { ApartmentsSection } from "@/components/housing/apartments-section";
import { RoommatesSection, type RoommateType } from "@/components/housing/roommates-section";
import { SlidingTabs } from "@/components/sliding-tabs";
import { useCollapsingHeader } from "@/lib/collapsing-header";
import { hapticSelect } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const ORDER = HOUSING_SECTIONS.map((s) => s.value);
const START = Math.max(0, ORDER.indexOf(DEFAULT_HOUSING_SECTION));
/** The title row (or the search box in its place), fixed under the safe area. */
const TITLE_ROW = 52;
/** The Apartments | Roommates row and the pills under it: they float over the pager and slide up under the title as the half on screen scrolls. */
const TABS_ROW = 44;
const PILLS_ROW = 42;
const FLOAT = TABS_ROW + PILLS_ROW;

/** Whose campus the listings come from: the person's own university, or every university. */
export type HousingCampus = "mine" | "all";

type Pill = { key: string; label: string; icon?: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void };

/**
 * Housing, laid out like the Messages tab: the big "Off Campus Housing" title with the magnifier at the right of the same
 * row (a tap turns the row into a search box for the half on screen, Cancel brings the title back), then Apartments |
 * Roommates above the pager with Home's sliding violet underline, and the pills that narrow the half on screen: All on
 * Apartments, All | Has a room | Looking for a room on Roommates, plus, for someone with a university, their campus or
 * every university. The two halves sit side by side in a pager (a swipe or a tap on a label moves
 * between them); the labels and the pills float over it and slide up under the title as the half on screen scrolls
 * down, back as soon as it scrolls up (useCollapsingHeader). The floating "+" follows the visible half.
 */
export default function HousingScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollViewType>(null);
  const [index, setIndex] = useState(START);
  const indexRef = useRef(START);
  /** Page a label tap is scrolling to; swipe tracking waits until we get there so the labels do not flicker. */
  const target = useRef<number | null>(null);
  /** False until the pager has been placed on the starting page, so the first layout cannot change the page by accident. */
  const ready = useRef(false);
  /** Same object on every render: a new one would send the pager back to the starting page. */
  const initialOffset = useRef({ x: START * width, y: 0 });
  /** The pager's offset, kept up to date on the native side so the underline slides with the finger. */
  const scrollX = useRef(new Animated.Value(START * width)).current;
  /** Pages are mounted the first time they come into view, so Roommates does not load until someone looks at it. */
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([START]));
  const { translateY: floatShift, select: followPage, reveal: revealFloat, onScroll: onPageScroll } = useCollapsingHeader(ORDER.length, FLOAT, START);

  // The search and the filters, shared by both halves (what does not apply to a half is simply not used there).
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [campus, setCampus] = useState<HousingCampus>("mine");
  const [type, setType] = useState<RoommateType | undefined>();

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

  function select(s: HousingSection) {
    const i = ORDER.indexOf(s);
    if (i < 0 || i === indexRef.current) return;
    target.current = i;
    revealFloat();
    show(i);
    pager.current?.scrollTo({ x: i * width, animated: true });
  }

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
      const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(pos)));
      if (i !== indexRef.current) show(i);
    },
    [show, width],
  );
  // One handler for both jobs: scrollX follows the finger on the UI thread, the page tracking above runs as its listener.
  const onPagerScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true, listener: onScroll }), [onScroll, scrollX]);

  function onSettled(e: NativeSyntheticEvent<NativeScrollEvent>) {
    target.current = null;
    if (width <= 0) return;
    const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i !== indexRef.current) show(i);
  }

  const pick = (apply: () => void) => {
    hapticSelect();
    apply();
  };
  const campusPill: Pill[] = profile?.university_id
    ? [{ key: "campus", label: campus === "mine" ? (profile.university?.name ?? "My campus") : "All universities", icon: campus === "mine" ? "school-outline" : "globe-outline", selected: campus === "mine", onPress: () => pick(() => setCampus(campus === "mine" ? "all" : "mine")) }]
    : [];
  const pills: Pill[] =
    section === "apartments"
      ? [{ key: "all", label: "All", selected: true, onPress: () => undefined }, ...campusPill]
      : [
          { key: "all", label: "All", selected: type === undefined, onPress: () => pick(() => setType(undefined)) },
          { key: "has_room", label: "Has a room", selected: type === "has_room", onPress: () => pick(() => setType("has_room")) },
          { key: "needs_room", label: "Looking for a room", selected: type === "needs_room", onPress: () => pick(() => setType("needs_room")) },
          ...campusPill,
        ];
  const placeholder = section === "apartments" ? "Search apartments" : "Search roommate posts";

  function closeSearch() {
    setQ("");
    setSearchOpen(false);
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: insets.top }]}>
        {searchOpen ? (
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <Ionicons name="search" size={18} color={colors.muted} />
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
              Off Campus Housing
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
            <SlidingTabs sections={HOUSING_SECTIONS} section={section} onSelect={select} scrollX={scrollX} pageWidth={width} tint={colors.accent} labelColor={colors.text} dimColor={colors.muted} gap={110} fontSize={16} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pills} accessibilityRole="tablist">
            {pills.map((p) => (
              <Pressable key={p.key} onPress={p.onPress} accessibilityRole="tab" accessibilityLabel={p.label} accessibilityState={{ selected: p.selected }} style={({ pressed }) => [styles.chip, p.selected && styles.chipSelected, pressed && !p.selected && { opacity: 0.7 }]}>
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
            // The labels come back for the swipe, wherever the half had scrolled them.
            revealFloat();
          }}
          onScroll={onPagerScroll}
          onMomentumScrollEnd={onSettled}
          style={{ flex: 1 }}
        >
          {ORDER.map((s, i) => (
            <View key={s} style={{ width, flex: 1 }}>
              {!mounted.has(i) ? null : s === "roommates" ? <RoommatesSection topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={campus} type={type} /> : <ApartmentsSection topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={campus} />}
            </View>
          ))}
        </Animated.ScrollView>
        {/* One "+" for whichever half is showing; it is absolutely positioned, so it floats over both pages. */}
        <Fab href={section === "apartments" ? "/create/apartment" : "/create/roommate"} label={section === "apartments" ? "List an apartment" : "Create roommate post"} />
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
