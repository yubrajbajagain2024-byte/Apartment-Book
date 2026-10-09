import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { DEFAULT_HOUSING_SECTION, HOUSING_SECTIONS, type HousingSection } from "@apartment-book/shared";
import { Fab } from "@/components/feed-header";
import { ApartmentsSection } from "@/components/housing/apartments-section";
import { RoommatesSection } from "@/components/housing/roommates-section";
import { SlidingTabs } from "@/components/sliding-tabs";
import { colors } from "@/lib/theme";

const ORDER = HOUSING_SECTIONS.map((s) => s.value);
const START = Math.max(0, ORDER.indexOf(DEFAULT_HOUSING_SECTION));
/** Height of the Apartments | Roommates row under the native header. */
const TABS_ROW = 44;

/** Housing: Apartments | Roommates side by side in a horizontal pager under a row of sliding tabs. Opens on Apartments. */
export default function HousingScreen() {
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
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

  const section: HousingSection = ORDER[index] ?? DEFAULT_HOUSING_SECTION;

  const show = useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
    setMounted((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
  }, []);

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

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <SlidingTabs sections={HOUSING_SECTIONS} section={section} onSelect={select} scrollX={scrollX} pageWidth={width} tint={colors.brand} labelColor={colors.text} dimColor={colors.muted} />
      </View>
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
        }}
        onScroll={onPagerScroll}
        onMomentumScrollEnd={onSettled}
        style={{ flex: 1 }}
      >
        {ORDER.map((s, i) => (
          <View key={s} style={{ width, flex: 1 }}>
            {!mounted.has(i) ? null : s === "roommates" ? <RoommatesSection /> : <ApartmentsSection />}
          </View>
        ))}
      </Animated.ScrollView>
      {/* One "+" for whichever half is showing; it is absolutely positioned, so it floats over both pages. */}
      <Fab href={section === "apartments" ? "/create/apartment" : "/create/roommate"} label={section === "apartments" ? "List an apartment" : "Create roommate post"} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { height: TABS_ROW, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignItems: "center", justifyContent: "center" },
});
