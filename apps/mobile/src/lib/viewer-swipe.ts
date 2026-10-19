import { createContext, useCallback, useContext, useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import { cancelAnimation, runOnJS, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";

/**
 * The full-screen viewer's swipe back. `drag` is how far the page on screen has been pulled sideways, in points (either
 * way); `close` finishes the way back once a pull is let go past the point of no return, given the finger's speed: a
 * worklet, called on the UI thread as the finger lets go, so the page goes on without waiting for JS. Only the viewer
 * provides it: on the Reels tab a sideways swipe belongs to Home's own pages, and a page leaves it alone.
 */
export type ViewerSwipe = { drag: SharedValue<number>; close: (velocityX: number) => void };
export const ViewerSwipeContext = createContext<ViewerSwipe | null>(null);

/** How far a finger moves before a page decides what the swipe is for: sideways, or up and down (the next post). */
const DECIDE = 10;
/** A swipe that starts this close to the left edge always goes back, as the system's back swipe does, even mid-carousel. */
const EDGE = 24;
/** Let go past this share of the page's width, or flicked that way faster than this, a pull goes on back; otherwise the page springs home. */
const BACK_SHARE = 0.3;
const BACK_VELOCITY = 650;
/** A flick this fast moves a carousel on by one, however little it moved. */
const FLICK = 300;
/** The share of a pull past a carousel's first or last slide that shows, where there is nothing further (on the Reels tab). */
const RUBBER = 0.3;
/**
 * How long after a swipe lets go a tap on the page still counts as part of it. The viewer is a modal screen, outside the
 * view the gesture library cancels React Native's touches in, so the tap handlers under a swipe have to tell for themselves.
 */
const TAP_AFTER_SWIPE_MS = 300;
/** A carousel settling on its slide: quick, no bounce past it. The page springing home after a pull it did not go through with. */
const SLIDE_SPRING = { damping: 34, stiffness: 300, mass: 1, overshootClamping: true };
const HOME_SPRING = { damping: 26, stiffness: 320, mass: 1 };

/**
 * What a sideways swipe on a page does: move its carousel to the next or previous slide ("slide"), pull the page back
 * towards where the viewer was opened from ("back"), or nothing (left to what is around the page). A carousel keeps every
 * swipe it can follow; one that has no slide left that way, a page without a carousel, and any swipe in from the left
 * edge go back. `dx` is the finger's sideways travel so far (positive: to the right), `startX` where it touched down,
 * `at` the carousel's position in slides (0 at the first), `count` its slides.
 */
export function swipeChoice(dx: number, startX: number, at: number, count: number, canGoBack: boolean): "slide" | "back" | "none" {
  "worklet";
  if (dx > 0 && startX < EDGE && canGoBack) return "back";
  if (count > 1 && (dx < 0 ? at < count - 1.01 : at > 0.01)) return "slide";
  if (canGoBack) return "back";
  return count > 1 ? "slide" : "none";
}

/** A carousel's slides: how far along its strip is (points, 0 at the first slide, negative after) and what to do once it lands on one. */
export type PageSlides = { count: number; pos: SharedValue<number>; onLand: (index: number) => void };

/**
 * The sideways swipe on one of the viewer's pages, TikTok and iOS style. On a post with several photos or videos it moves
 * between them, following the finger; past the last one either way (or in from the left edge) it pulls the whole page
 * back towards the post it was opened from, following the finger too, and let go far enough or with a flick, it goes
 * back (see ViewerSwipe), otherwise the page springs home. Up and down is left to the pager between posts, and a tap or a
 * double tap still reaches the page. Off the viewer (no ViewerSwipe) it only moves a carousel. `swipedJustNow` tells a tap
 * handler on the page that the touch it is about to act on was a swipe (or the tail of one): it should do nothing.
 */
export function usePageSwipe(width: number, slides: PageSlides | null) {
  const swipe = useContext(ViewerSwipeContext);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  /** 0 until the swipe is decided, then 1 moving the carousel, 2 pulling the page back. */
  const mode = useSharedValue(0);
  /** Where the strip (or the pull) was when the swipe was decided, less the finger's travel so far: nothing jumps. */
  const grab = useSharedValue(0);
  /** 1 while a swipe moves the carousel or pulls the page; when the last one let go (ms). Read synchronously by the page's taps. */
  const busy = useSharedValue(0);
  const endedAt = useSharedValue(0);
  const none = useSharedValue(0);
  const strip = slides?.pos ?? none;
  const count = slides?.count ?? 1;
  const onLand = slides?.onLand;
  const drag = swipe?.drag ?? null;
  const close = swipe?.close ?? null;

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(count > 1 || drag !== null)
        .manualActivation(true)
        .onTouchesDown((e) => {
          const t = e.changedTouches[0];
          if (!t) return;
          touchX.value = t.absoluteX;
          touchY.value = t.absoluteY;
          mode.value = 0;
        })
        .onTouchesMove((e, manager) => {
          if (mode.value !== 0) return;
          const t = e.allTouches[0];
          if (!t) return;
          const dx = t.absoluteX - touchX.value;
          const dy = t.absoluteY - touchY.value;
          if (Math.abs(dy) > DECIDE && Math.abs(dy) >= Math.abs(dx)) {
            manager.fail();
            return;
          }
          if (Math.abs(dx) <= DECIDE) return;
          const choice = swipeChoice(dx, touchX.value, -strip.value / width, count, drag !== null);
          if (choice === "none") {
            manager.fail();
            return;
          }
          if (choice === "slide") {
            // A strip still settling stops under the finger.
            cancelAnimation(strip);
            grab.value = strip.value - dx;
            mode.value = 1;
          } else {
            grab.value = dx;
            mode.value = 2;
          }
          busy.value = 1;
          manager.activate();
        })
        .onUpdate((e) => {
          if (mode.value === 1) {
            const x = grab.value + e.translationX;
            const last = -(count - 1) * width;
            strip.value = x > 0 ? x * RUBBER : x < last ? last + (x - last) * RUBBER : x;
          } else if (mode.value === 2 && drag) {
            drag.value = e.translationX - grab.value;
          }
        })
        .onEnd((e) => {
          if (mode.value === 1) {
            const at = -strip.value / width;
            let target = Math.round(at);
            if (e.velocityX < -FLICK) target = Math.floor(at) + 1;
            else if (e.velocityX > FLICK) target = Math.ceil(at) - 1;
            target = Math.max(0, Math.min(count - 1, target));
            strip.value = withSpring(-target * width, { ...SLIDE_SPRING, velocity: e.velocityX }, (finished) => {
              if (finished && onLand) runOnJS(onLand)(target);
            });
          } else if (mode.value === 2 && drag && close) {
            const pulled = drag.value;
            const far = Math.abs(pulled) > width * BACK_SHARE || (Math.abs(e.velocityX) > BACK_VELOCITY && Math.sign(e.velocityX) === Math.sign(pulled));
            if (far) close(e.velocityX);
            else drag.value = withSpring(0, { ...HOME_SPRING, velocity: e.velocityX });
          }
        })
        .onFinalize(() => {
          if (mode.value !== 0) {
            busy.value = 0;
            endedAt.value = Date.now();
          }
          mode.value = 0;
        }),
    [count, width, strip, onLand, drag, close, touchX, touchY, mode, grab, busy, endedAt],
  );
  const swipedJustNow = useCallback(() => busy.value === 1 || Date.now() - endedAt.value < TAP_AFTER_SWIPE_MS, [busy, endedAt]);
  return { gesture, swipedJustNow };
}
