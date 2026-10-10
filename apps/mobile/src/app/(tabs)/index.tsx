import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_HOME_SECTION, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { BuzzSection } from "@/components/home/buzz-section";
import { ForYouSection } from "@/components/home/for-you-section";
import { HOME_TOP_BAR_ROWS, HomeTopTabs } from "@/components/home/home-top-tabs";
import { PostsSection } from "@/components/home/posts-section";
import { ReelsSection } from "@/components/home/reels-section";
import { hapticSelect } from "@/lib/haptics";
import { onHomeSectionRequest, takeHomeSection } from "@/lib/home-section";
import { colors } from "@/lib/theme";

const ORDER = HOME_SECTIONS.map((s) => s.value);
const START = Math.max(0, ORDER.indexOf(DEFAULT_HOME_SECTION));

/** Home: For you | Buzz | Posts | Reels side by side in a horizontal pager under a floating top bar. Opens on For you. */
export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const pager = useRef<ScrollView>(null);
  const [index, setIndex] = useState(START);
  const indexRef = useRef(START);
  /** Page a label tap is scrolling to; swipe tracking waits until we get there so the labels do not flicker. */
  const target = useRef<number | null>(null);
  /** False until the pager has been placed on the starting page, so the first layout cannot change the page by accident. */
  const ready = useRef(false);
  /** Same object on every render: a new one would send the pager back to the starting page. */
  const initialOffset = useRef({ x: START * width, y: 0 });
  /** The pager's offset, kept up to date on the native side so the underline in the top bar slides with the finger. */
  const scrollX = useRef(new Animated.Value(START * width)).current;
  /** Pages are mounted the first time they come into view, so Reels does not load videos nobody watches. */
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([START]));
  const [barHeight, setBarHeight] = useState(insets.top + HOME_TOP_BAR_ROWS);
  const [pageHeight, setPageHeight] = useState(0);

  const section: HomeSection = ORDER[index] ?? DEFAULT_HOME_SECTION;
  const overVideo = section === "reels";

  const show = useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
    setMounted((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
  }, []);

  /** The person moved to another section, by a label tap or a swipe: a soft tick, then the usual bookkeeping. Not for `jump`, which is nobody's gesture. */
  const change = useCallback(
    (i: number) => {
      hapticSelect();
      show(i);
    },
    [show],
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

  // Another screen asked for a section (for example "Reels" right after posting a reel): jump there without animation.
  const jump = useCallback(() => {
    const wanted = takeHomeSection();
    const i = wanted ? ORDER.indexOf(wanted) : -1;
    if (i < 0) return;
    target.current = null;
    show(i);
    pager.current?.scrollTo({ x: i * width, animated: false });
  }, [show, width]);
  useEffect(() => {
    if (!focused) return;
    jump();
    return onHomeSectionRequest(jump);
  }, [focused, jump]);

  function select(s: HomeSection) {
    const i = ORDER.indexOf(s);
    if (i < 0 || i === indexRef.current) return;
    target.current = i;
    change(i);
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
      if (i !== indexRef.current) change(i);
    },
    [change, width],
  );
  // One handler for both jobs: scrollX follows the finger on the UI thread, the page tracking above runs as its listener.
  const onPagerScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true, listener: onScroll }), [onScroll, scrollX]);

  function onSettled(e: NativeSyntheticEvent<NativeScrollEvent>) {
    target.current = null;
    if (width <= 0) return;
    const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i !== indexRef.current) change(i);
  }

  const page = pageHeight > 0 ? { width, height: pageHeight } : { width, flex: 1 };
  const isActive = (s: HomeSection) => focused && section === s;
  return (
    <View style={{ flex: 1, backgroundColor: overVideo ? "#000" : colors.bg }}>
      {focused ? <StatusBar style={overVideo ? "light" : "dark"} /> : null}
      <View style={{ flex: 1 }} onLayout={(e) => setPageHeight(Math.round(e.nativeEvent.layout.height))}>
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
            <View key={s} style={[page, s === "reels" && { backgroundColor: "#000" }]}>
              {!mounted.has(i) ? null : s === "reels" ? (
                pageHeight > 0 ? <ReelsSection active={isActive("reels")} topInset={barHeight} height={pageHeight} /> : null
              ) : s === "buzz" ? (
                <BuzzSection active={isActive("buzz")} topInset={barHeight} />
              ) : s === "foryou" ? (
                <ForYouSection active={isActive("foryou")} topInset={barHeight} />
              ) : (
                <PostsSection active={isActive("posts")} topInset={barHeight} />
              )}
            </View>
          ))}
        </Animated.ScrollView>
      </View>
      <HomeTopTabs section={section} onSelect={select} overVideo={overVideo} scrollX={scrollX} pageWidth={width} onLayout={(e) => setBarHeight(Math.round(e.nativeEvent.layout.height))} />
    </View>
  );
}
