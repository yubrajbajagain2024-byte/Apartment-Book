import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_HOME_SECTION, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { BuzzSection } from "@/components/home/buzz-section";
import { ForYouSection } from "@/components/home/for-you-section";
import { createOverVideoStore, HOME_TOP_BAR_ROWS, HomeTopTabs, useOverVideo, type OverVideoStore } from "@/components/home/home-top-tabs";
import { PostsSection } from "@/components/home/posts-section";
import { ReelsSection } from "@/components/home/reels-section";
import { hapticSwipe } from "@/lib/haptics";
import { onHomeSectionRequest, takeHomeSection } from "@/lib/home-section";
import { useAppTheme } from "@/lib/theme-provider";

const ORDER = HOME_SECTIONS.map((s) => s.value);
const START = Math.max(0, ORDER.indexOf(DEFAULT_HOME_SECTION));
const LAST = ORDER.length - 1;
const REELS = ORDER.indexOf("reels");
const POSTS = ORDER.indexOf("posts");
/** Closer to a page than this share of a page, the pager counts as resting on it. */
const ON_PAGE = 0.01;
/** Changes of page wait until the pager is this share of a page past the halfway point, so a finger resting on the line cannot buzz back and forth. */
const MARGIN = 0.02;
/** No scroll event for this long, finger up and resting on a page: the pager has stopped, whether or not a momentum-end event comes (the web; Android after a label tap's scroll; a release without a fling). */
const SETTLE_MS = 150;
/** A label tap's scroll takes about a third of a second; one that has not reached its page after this long was lost (another tap, a layout change) and the pager settles where it is. */
const TAP_GIVE_UP_MS = 1000;

const toPage = (pos: number) => Math.min(LAST, Math.max(0, Math.round(pos)));

/**
 * Runs `task` once the JS thread is idle and returns a cancel function. requestIdleCallback where there is one (React
 * Native's new architecture, most browsers; InteractionManager is deprecated and no longer waits for anything), a short
 * timer elsewhere or if it is missing.
 */
function whenIdle(task: () => void): () => void {
  try {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => task());
      return () => cancelIdleCallback(id);
    }
  } catch {
    // Fall through to the timer.
  }
  const id = setTimeout(task, 50);
  return () => clearTimeout(id);
}

/** The clock and battery: light over the Reels video and in the dark theme. Its own component, so the flip halfway to Reels re-renders only this and the top bar. */
const HomeStatusBar = memo(function HomeStatusBar({ overVideo, isDark }: { overVideo: OverVideoStore; isDark: boolean }) {
  const over = useOverVideo(overVideo);
  return <StatusBar style={over || isDark ? "light" : "dark"} />;
});

/**
 * Home: For you | Buzz | Posts | Reels side by side in a horizontal pager under a floating top bar. Opens on For you.
 *
 * Swipes feel like X's: nothing in React changes while the finger drags or the page glides. The underline, the labels and
 * the bar's background follow the finger on the native driver (`scrollX`); the scroll listener only decides, without any
 * state, when the page under the finger changes (one clear haptic) and when the bar's text turns white for Reels (a tiny
 * store only the bar and the status bar read). The section itself (`index`: which page is active, which videos play) is
 * committed once the pager stops. The pages next to the one on screen are mounted ahead of time, once the pager is still
 * and the JS thread idle, so a swipe uncovers a page that has already rendered and loaded.
 */
export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { colors, isDark } = useAppTheme();
  const pager = useRef<ScrollView>(null);
  /** The section on screen: committed once the pager stops (at once for `jump`), never in the middle of a move. */
  const [index, setIndex] = useState(START);
  const indexRef = useRef(START);
  /** Pages mounted so far (they stay mounted): the first one, then its neighbours ahead of time. */
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([START]));
  const mountedRef = useRef(mounted);
  /** Which way the last move went (+1 right, -1 left): the neighbour on that side is mounted first. */
  const heading = useRef(1);
  /** The page under the finger: it changes at the halfway point of a swipe, with one haptic each time. */
  const under = useRef(START);
  /** Page a label tap is scrolling to, and when it was tapped; until it gets there, the scroll is not a swipe (no haptics) and does not settle. */
  const target = useRef<number | null>(null);
  const tappedAt = useRef(0);
  /** The finger is on the pager. */
  const dragging = useRef(false);
  /** The finger is on the pager or the page is still gliding (a swipe's momentum, a label tap's scroll): nothing is mounted now. */
  const moving = useRef(false);
  /** The pager's offset in the last scroll event. */
  const lastX = useRef(START * width);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPrefetch = useRef<(() => void) | null>(null);
  /**
   * The width the pager was last placed at (0 = not yet). Scroll events and settles count only once the pager has been put
   * on its page at the current width, so the first layout or a rotation cannot change the page by accident. A width, not a
   * flag reset by an effect: an effect can run after the first layout and would leave the pager ignored for good.
   */
  const placedWidth = useRef(0);
  /** Same object on every render: a new one would send the pager back to the starting page. */
  const initialOffset = useRef({ x: START * width, y: 0 });
  /** The pager's offset, kept up to date on the native side so the underline, the labels and the bar's background follow the finger. */
  const scrollX = useRef(new Animated.Value(START * width)).current;
  /** The top bar's white look over Reels: flipped by the scroll listener halfway between Posts and Reels, read only by the bar and the status bar. */
  const [overVideo] = useState(() => createOverVideoStore(START === REELS));
  /** Whether the page under the finger is Posts, flipped halfway like overVideo: the bar's "Following" title reads it. */
  const [onPosts] = useState(() => createOverVideoStore(START === POSTS));
  const [barHeight, setBarHeight] = useState(insets.top + HOME_TOP_BAR_ROWS);
  const [pageHeight, setPageHeight] = useState(0);

  const section: HomeSection = ORDER[index] ?? DEFAULT_HOME_SECTION;

  /** Mounts the pages that are not mounted yet, in one commit; nothing at all when they already are. */
  const mount = useCallback((pages: number[]) => {
    const add = pages.filter((p) => p >= 0 && p <= LAST && !mountedRef.current.has(p));
    if (add.length === 0) return;
    const next = new Set(mountedRef.current);
    for (const p of add) next.add(p);
    mountedRef.current = next;
    setMounted(next);
  }, []);

  /** Once the pager is still and the JS thread idle, mounts one missing neighbour of the page on screen. Every commit asks again (the effect below), so they come one at a time. */
  const prefetch = useCallback(() => {
    cancelPrefetch.current?.();
    cancelPrefetch.current = whenIdle(() => {
      cancelPrefetch.current = null;
      // Never under a moving pager: the settle that ends the move asks again.
      if (moving.current || settleTimer.current) return;
      const i = indexRef.current;
      const next = [i + heading.current, i - heading.current].find((p) => p >= 0 && p <= LAST && !mountedRef.current.has(p));
      if (next !== undefined) mount([next]);
    });
  }, [mount]);
  const stopPrefetch = useCallback(() => {
    cancelPrefetch.current?.();
    cancelPrefetch.current = null;
  }, []);
  useEffect(() => {
    prefetch();
  }, [index, mounted, prefetch]);

  /** Page i becomes the section on screen: the one React commit of a move. No haptic here: the swipe or the tap already played it. */
  const commit = useCallback(
    (i: number) => {
      under.current = i;
      overVideo.set(i === REELS);
      onPosts.set(i === POSTS);
      // A page uncovered before it was mounted (a very fast double swipe) mounts now, in the same commit.
      mount([i]);
      if (i === indexRef.current) return;
      heading.current = i > indexRef.current ? 1 : -1;
      indexRef.current = i;
      setIndex(i);
    },
    [mount, overVideo, onPosts],
  );

  const stopSettleTimer = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);

  /** The pager stopped at offset x: commit the page there, then let the neighbours mount. Calling it twice for one stop is harmless. */
  const settle = useCallback(
    (x: number) => {
      stopSettleTimer();
      if (width <= 0 || placedWidth.current !== width) return;
      target.current = null;
      moving.current = false;
      commit(toPage(x / width));
      prefetch();
    },
    [commit, prefetch, stopSettleTimer, width],
  );

  /** A label tap's scroll is still on its way to its page: it passes other pages, and one replaced by a second tap can stop short. */
  const tapUnderway = useCallback((pos: number) => target.current !== null && Math.abs(pos - target.current) > ON_PAGE && Date.now() - tappedAt.current < TAP_GIVE_UP_MS, []);

  /** For a stop that sends no momentum-end event: armed again by every scroll event, it settles once the pager has rested on a page for a moment with the finger up. */
  const armSettleTimer: () => void = useCallback(() => {
    stopSettleTimer();
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      if (dragging.current || width <= 0) return;
      const pos = lastX.current / width;
      // Still between pages: the next scroll event arms the timer again.
      if (Math.abs(pos - Math.round(pos)) > ON_PAGE) return;
      if (tapUnderway(pos)) armSettleTimer();
      else settle(lastX.current);
    }, SETTLE_MS);
  }, [settle, stopSettleTimer, tapUnderway, width]);
  useEffect(
    () => () => {
      stopPrefetch();
      stopSettleTimer();
    },
    [stopPrefetch, stopSettleTimer],
  );

  // Keep the current page in place when the pager is first laid out and when the screen width changes.
  const place = useCallback(() => {
    if (width <= 0) return;
    lastX.current = indexRef.current * width;
    pager.current?.scrollTo({ x: indexRef.current * width, animated: false });
    placedWidth.current = width;
  }, [width]);

  // Another screen asked for a section (for example "Reels" right after posting a reel): jump there without animation or haptic.
  const jump = useCallback(() => {
    const wanted = takeHomeSection();
    const i = wanted ? ORDER.indexOf(wanted) : -1;
    if (i < 0) return;
    target.current = null;
    moving.current = false;
    stopSettleTimer();
    commit(i);
    lastX.current = i * width;
    pager.current?.scrollTo({ x: i * width, animated: false });
  }, [commit, stopSettleTimer, width]);
  useEffect(() => {
    if (!focused) return;
    jump();
    return onHomeSectionRequest(jump);
  }, [focused, jump]);

  /** A label tap (or the feed menu's Following, which goes to Posts): one clear haptic now; the section is committed when the scroll ends. */
  const select = useCallback(
    (s: HomeSection) => {
      const i = ORDER.indexOf(s);
      if (i < 0 || i === (target.current ?? under.current)) return;
      hapticSwipe();
      if (width <= 0) return commit(i);
      target.current = i;
      tappedAt.current = Date.now();
      moving.current = true;
      stopPrefetch();
      pager.current?.scrollTo({ x: i * width, animated: true });
      // iOS ends the scroll with onMomentumScrollEnd; elsewhere the timer settles it once the pager rests on the page.
      armSettleTimer();
    },
    [armSettleTimer, commit, stopPrefetch, width],
  );
  const onBarLayout = useCallback((e: LayoutChangeEvent) => setBarHeight(Math.round(e.nativeEvent.layout.height)), []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0 || placedWidth.current !== width) return;
      const x = e.nativeEvent.contentOffset.x;
      lastX.current = x;
      const pos = x / width;
      // The bar's text turns white for Reels at the halfway point, whoever moves the pager: a tiny store, only the bar re-renders.
      const fromReels = Math.abs(pos - REELS);
      if (fromReels < 0.5 - MARGIN) overVideo.set(true);
      else if (fromReels > 0.5 + MARGIN) overVideo.set(false);
      const fromPosts = Math.abs(pos - POSTS);
      if (fromPosts < 0.5 - MARGIN) onPosts.set(true);
      else if (fromPosts > 0.5 + MARGIN) onPosts.set(false);
      // A swipe (not a label tap's scroll): one clear haptic each time the page under the finger changes. No state.
      if (target.current === null && Math.abs(pos - under.current) > 0.5 + MARGIN) {
        const page = toPage(pos);
        if (page !== under.current) {
          under.current = page;
          hapticSwipe();
        }
      }
      armSettleTimer();
    },
    [armSettleTimer, overVideo, onPosts, width],
  );
  // One handler for both jobs: scrollX follows the finger on the UI thread, the tracking above runs as its listener.
  const onPagerScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true, listener: onScroll }), [onScroll, scrollX]);

  const onBeginDrag = useCallback(() => {
    dragging.current = true;
    moving.current = true;
    stopSettleTimer();
    stopPrefetch();
    if (target.current !== null && width > 0) {
      // The finger caught a label tap's scroll: from here on it is a swipe, counted from the page under the finger now.
      target.current = null;
      under.current = toPage(lastX.current / width);
    }
  }, [stopPrefetch, stopSettleTimer, width]);

  const onEndDrag = useCallback(() => {
    dragging.current = false;
    // A release without a fling sends no momentum events: the timer settles the pager then.
    armSettleTimer();
  }, [armSettleTimer]);

  // Ends a swipe's glide, a label tap's scroll (iOS) and a jump; never acted on while a finger holds the pager.
  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (dragging.current || width <= 0) return;
      const x = e.nativeEvent.contentOffset.x;
      // A tap's scroll cut short by a second tap: the timer waits for the one that reaches its page.
      if (tapUnderway(x / width)) armSettleTimer();
      else settle(x);
    },
    [armSettleTimer, settle, tapUnderway, width],
  );

  const page = pageHeight > 0 ? { width, height: pageHeight } : { width, flex: 1 };
  const forYouOn = focused && section === "foryou";
  const buzzOn = focused && section === "buzz";
  const postsOn = focused && section === "posts";
  const reelsOn = focused && section === "reels";
  // Next to the page on screen, Reels loads its first reels ahead of time (nothing plays until it is active).
  const reelsPreload = Math.abs(index - REELS) === 1;
  // Each page keeps its element while its own props stay the same, so a settle re-renders the section that was left and
  // the one that was reached, not all four lists.
  const forYou = useMemo(() => <ForYouSection active={forYouOn} topInset={barHeight} />, [forYouOn, barHeight]);
  const buzz = useMemo(() => <BuzzSection active={buzzOn} topInset={barHeight} />, [buzzOn, barHeight]);
  const posts = useMemo(() => <PostsSection active={postsOn} topInset={barHeight} />, [postsOn, barHeight]);
  const reels = useMemo(() => (pageHeight > 0 ? <ReelsSection active={reelsOn} preload={reelsPreload} topInset={barHeight} height={pageHeight} /> : null), [reelsOn, reelsPreload, barHeight, pageHeight]);
  const content: Record<HomeSection, ReactNode> = { foryou: forYou, buzz, posts, reels };

  return (
    <View style={{ flex: 1, backgroundColor: section === "reels" ? colors.mediaBg : colors.bg }}>
      {focused ? <HomeStatusBar overVideo={overVideo} isDark={isDark} /> : null}
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
          onScrollBeginDrag={onBeginDrag}
          onScrollEndDrag={onEndDrag}
          onScroll={onPagerScroll}
          onMomentumScrollEnd={onMomentumEnd}
          style={{ flex: 1 }}
        >
          {ORDER.map((s, i) => (
            // A page not mounted yet is just its background, so one uncovered early (a very fast double swipe) is never a hole.
            <View key={s} style={[page, { backgroundColor: s === "reels" ? colors.mediaBg : colors.bg }]}>
              {mounted.has(i) ? content[s] : null}
            </View>
          ))}
        </Animated.ScrollView>
      </View>
      <HomeTopTabs section={section} onSelect={select} overVideo={overVideo} onPosts={onPosts} scrollX={scrollX} pageWidth={width} onLayout={onBarLayout} />
    </View>
  );
}
