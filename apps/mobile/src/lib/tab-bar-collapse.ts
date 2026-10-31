import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { makeMutable, withSpring } from "react-native-reanimated";
import { reduceMotionEnabled } from "./accessibility";

/**
 * Reddit's collapsing bottom bar (iOS 26's tab bar minimising on scroll): while a feed scrolls on, the finger pushing the
 * page up, the floating bar shrinks into one round button holding the tab on screen (Home's icon on Home, Explore's on
 * Explore, Events' on Events); the moment the feed scrolls back, or reaches its top, the whole bar returns where it was.
 * Home's For you and Buzz, Explore's three pages and Events' two feed it (useCollapseOnScroll); Messages and Profile keep
 * the whole bar, and leaving a tab, or moving to another page of it, brings the whole bar back.
 *
 * `tabBarCollapse` is the state on the UI thread, 0 for the whole bar and 1 collapsed, springing in between: the bar
 * (components/floating-tab-bar.tsx) and the floating create buttons, which ride down beside the collapsed bar like X's,
 * read it in their animated styles. React reads `useTabBarCollapsed` (what a tap on the bar does, what screen readers get).
 */
export const tabBarCollapse = makeMutable(0);

/** A feed has to move on this far in one direction before the bar collapses; back this far and the whole bar returns. */
const COLLAPSE_AFTER = 28;
const EXPAND_AFTER = 14;
/** Within this distance of a feed's top the bar is always whole. */
const NEAR_TOP = 24;
/** Close to critically damped, as the bar's own capsule: the bar settles without a wobble. */
const SPRING = { damping: 30, stiffness: 320, mass: 0.9 };

let collapsed = false;
/** VoiceOver and TalkBack users always get the whole bar: a collapsed bar would hide four of its tabs from them. */
let screenReader = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const read = () => collapsed;

/** Collapses the bar, or brings the whole bar back; nothing when it already is so. */
export function setTabBarCollapsed(next: boolean): void {
  if (next && screenReader) return;
  if (next === collapsed) return;
  collapsed = next;
  const to = next ? 1 : 0;
  tabBarCollapse.value = reduceMotionEnabled() ? to : withSpring(to, SPRING);
  listeners.forEach((l) => l());
}

AccessibilityInfo.isScreenReaderEnabled().then(
  (on) => {
    screenReader = on;
    if (on) setTabBarCollapsed(false);
  },
  () => {},
);
AccessibilityInfo.addEventListener("screenReaderChanged", (on) => {
  screenReader = on;
  if (on) setTabBarCollapsed(false);
});

/** Whether the bar is collapsed (or on its way there), for React. */
export function useTabBarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The scroll side, for one feed: call the returned function from the feed's scroll listener with how far the feed is
 * from its top (iOS content insets already taken off). Only while `active` (the feed is the page on screen); when it
 * stops being active the whole bar comes back, so a feed left collapsed never leaves another page without its tabs.
 * `page`, for a screen whose pager hands one tracker several lists (Explore, Events): a new page starts over with the
 * whole bar, as moving between Home's pages does. Direction, not distance, decides: a short push on collapses, a short
 * pull back restores, wherever in the feed.
 */
export function useCollapseOnScroll(active: boolean, page: number = 0): (fromTop: number) => void {
  const last = useRef<number | null>(null);
  /** How far the feed has moved in its current direction: positive on, negative back. */
  const run = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    last.current = null;
    run.current = 0;
    setTabBarCollapsed(false);
  }, [active, page]);
  // Leaving the screen altogether (a pushed screen, sign-out) brings the bar back too.
  useEffect(() => () => setTabBarCollapsed(false), []);
  return useCallback((fromTop: number) => {
    if (!activeRef.current) return;
    const before = last.current;
    last.current = fromTop;
    if (fromTop <= NEAR_TOP) {
      run.current = 0;
      setTabBarCollapsed(false);
      return;
    }
    if (before === null) return;
    const delta = fromTop - before;
    if (delta === 0) return;
    run.current = Math.sign(delta) === Math.sign(run.current) ? run.current + delta : delta;
    if (run.current > COLLAPSE_AFTER) setTabBarCollapsed(true);
    else if (run.current < -EXPAND_AFTER) setTabBarCollapsed(false);
  }, []);
}
