import { useCallback, useMemo, useRef } from "react";
import { Animated, FlatList, Platform, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

/** How long the bar takes to come back when the pager moves, and to start following the list again afterwards. */
const REVEAL_MS = 160;
const FOLLOW_MS = 220;
/** A list has to move down this much, in one scroll event or a few, before a bar brought back by `reveal` follows it again. */
const NUDGE = 2;

export type CollapsingHeader = {
  /** For the bar's `transform`: 0 with the bar in place, down to minus its height once a list has scrolled it away. */
  translateY: Animated.AnimatedInterpolation<number>;
  /** The `onScroll` of list `page` (give it `scrollEventThrottle={16}` too). The same handler every time, so the list attaches it once. */
  onScroll: (page: number) => (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Which list the bar follows from now on; -1 for none (the bar then stays in place). */
  select: (page: number) => void;
  /** Bring the bar back wherever the lists are (the pager starts to move, say); it follows the chosen list again once that list scrolls down. */
  reveal: () => void;
  /**
   * How far the bar has slid away right now, read from JS (the bar itself moves on the native driver): a copy of the
   * same sums, kept from the lists' scroll events. Those come 16ms apart, so a flick that turns within one can leave it
   * a point or two off; during a reveal or a follow it reads where the bar is going.
   */
  hidden: () => number;
};

/**
 * Instagram's collapsing bar: a bar floating over a list slides up as the list scrolls down, by as much as the list
 * moved (up to `height`), and slides back down the moment the list scrolls up, however far down it is. Several lists
 * can sit side by side in a pager under one bar: each gets its own scroll value through `onScroll(i)`, and `select`
 * says which one the bar follows (`initial` to begin with). Everything that moves runs on the native driver, so the
 * bar keeps up with the finger whatever the JS thread is doing; only `select` and `reveal` touch it from JS.
 *
 * The lists start `height` points down, under the bar (see listInset): on iOS that is a content inset, so a list at
 * rest reports -height and the inset is added back before the clamp.
 */
export function useCollapsingHeader(pages: number, height: number, initial = 0): CollapsingHeader {
  const scrollYs = useRef<Animated.Value[]>([]);
  const selectors = useRef<Animated.Value[]>([]);
  if (scrollYs.current.length !== pages) {
    scrollYs.current = Array.from({ length: pages }, () => new Animated.Value(Platform.OS === "ios" ? -height : 0));
    selectors.current = Array.from({ length: pages }, (_, i) => new Animated.Value(i === initial ? 1 : 0));
  }
  const revealValue = useRef(new Animated.Value(0)).current;
  const revealing = useRef<Animated.CompositeAnimation | null>(null);
  const revealed = useRef(false);
  const selected = useRef(initial);
  const lastY = useRef<number[]>([]);
  /** How far the chosen list has moved down since the last reveal. */
  const down = useRef(0);
  /** Where a list sits at rest (see listInset): what a scroll is measured from before the list has reported anything. */
  const restY = useRef(0);
  restY.current = Platform.OS === "ios" ? -height : 0;
  const handlers = useRef(new Map<number, (e: NativeSyntheticEvent<NativeScrollEvent>) => void>());
  /** JS copies of each page's `fromTop` and of its diffClamp (see translateY), for `hidden`. */
  const fromTopJs = useRef<number[]>([]);
  const hiddenJs = useRef<number[]>([]);
  const heightRef = useRef(height);
  heightRef.current = height;

  const translateY = useMemo(() => {
    const max = Math.max(1, height);
    // Page i's share: how far it has scrolled the bar away, times 1 while it is the page on screen and 0 otherwise.
    const shares = scrollYs.current.map((y, i) => {
      // Either node interpolates the same way; typed as one so the call below has a single signature.
      const scrolled: Pick<Animated.AnimatedAddition, "interpolate"> = Platform.OS === "ios" ? Animated.add(y, new Animated.Value(height)) : y;
      // Never below the top: a bounce past it, or a pull to refresh, must not count as a scroll down on the way back,
      // which would leave the bar part way up with the list at rest. The clamp below then always reads 0 at the top.
      const fromTop = scrolled.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp", extrapolateRight: "extend" });
      return Animated.multiply(Animated.diffClamp(fromTop, 0, max), selectors.current[i]!);
    });
    const hidden = shares.reduce((sum, share) => Animated.add(sum, share));
    // -(hidden × (1 − reveal)): the bar's own distance, or none at all while it is brought back.
    return Animated.multiply(hidden, Animated.subtract(revealValue, 1));
  }, [height, revealValue]);

  const select = useCallback((page: number) => {
    selected.current = page;
    selectors.current.forEach((a, i) => a.setValue(i === page ? 1 : 0));
  }, []);

  const reveal = useCallback(() => {
    if (revealed.current) return;
    revealed.current = true;
    down.current = 0;
    revealing.current?.stop();
    revealing.current = Animated.timing(revealValue, { toValue: 1, duration: REVEAL_MS, useNativeDriver: true });
    revealing.current.start();
  }, [revealValue]);

  const follow = useCallback(() => {
    revealed.current = false;
    revealing.current?.stop();
    revealing.current = Animated.timing(revealValue, { toValue: 0, duration: FOLLOW_MS, useNativeDriver: true });
    revealing.current.start();
  }, [revealValue]);

  const onScroll = useCallback(
    (page: number) => {
      let handler = handlers.current.get(page);
      if (!handler) {
        handler = Animated.event([{ nativeEvent: { contentOffset: { y: scrollYs.current[page] } } }], {
          useNativeDriver: true,
          listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const y = e.nativeEvent.contentOffset.y;
            const before = lastY.current[page] ?? restY.current;
            lastY.current[page] = y;
            // The same sums the native driver does for this page's share of the bar's distance.
            const fromTop = Math.max(0, Platform.OS === "ios" ? y + heightRef.current : y);
            const was = fromTopJs.current[page] ?? 0;
            fromTopJs.current[page] = fromTop;
            hiddenJs.current[page] = Math.min(Math.max((hiddenJs.current[page] ?? 0) + fromTop - was, 0), Math.max(1, heightRef.current));
            if (!revealed.current || page !== selected.current) return;
            // The page on screen scrolls down after a reveal: the bar is handed back to it.
            const delta = y - before;
            down.current = delta > 0 ? down.current + delta : 0;
            if (down.current > NUDGE) follow();
          },
        });
        handlers.current.set(page, handler);
      }
      return handler;
    },
    [follow],
  );

  const hidden = useCallback(() => (revealed.current || selected.current < 0 ? 0 : (hiddenJs.current[selected.current] ?? 0)), []);

  return useMemo(() => ({ translateY, onScroll, select, reveal, hidden }), [translateY, onScroll, select, reveal, hidden]);
}

/** FlatList with native-driven scroll events (Animated.event with useNativeDriver), keeping its item type. */
export const AnimatedFlatList = Animated.FlatList as unknown as typeof FlatList;

/**
 * What starts a list `top` points down, under a floating bar, the Buzz way: a content inset on iOS (the pull-to-refresh
 * spinner then sits below the bar), padding on Android. Spread `list` on the list, put `paddingTop` in its content
 * style, give `progressViewOffset` to its RefreshControl and scroll to `topOffset` for the top.
 */
export function listInset(top: number) {
  const ios = Platform.OS === "ios";
  return {
    list: ios ? { contentInset: { top }, contentOffset: { x: 0, y: -top }, scrollIndicatorInsets: { top }, automaticallyAdjustContentInsets: false } : {},
    paddingTop: ios ? 0 : top,
    progressViewOffset: ios ? undefined : top,
    topOffset: ios ? -top : 0,
  };
}
