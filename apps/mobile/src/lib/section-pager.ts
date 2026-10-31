import { createContext, useContext } from "react";

/**
 * A tab's pager of sections as one of its pages sees it: Home's For you | Buzz | Reels and Explore's Housing | Roommate |
 * Marketplace. A photo carousel on the page hands a swipe past its last photo to the next section, and one past its first
 * photo to the section before, TikTok's way, instead of keeping the finger (components/photo-carousel.tsx). Reels' page
 * has none to hand over: every reel there is one video, so a sideways swipe on it is the pager's own. Only those two
 * pagers provide it, one value per page: a
 * carousel anywhere else (a listing's own screen, the full-screen viewer) keeps its swipes, and nothing ever moves to
 * another tab of the bottom bar.
 *
 * iOS gives such a swipe to nobody (the carousel's own scroll gesture takes it and cannot move, and the pager around it
 * never gets it), so it would end as a tap on the photo and open the post. The carousel reads the finger itself and the
 * pager follows it (`follow`) until it is let go (`release`), then glides on to the section or back.
 */
export type SectionPager = {
  /** The finger has moved `dx` points sideways since it touched down (positive: to the right); the pager follows it. */
  follow: (dx: number) => void;
  /** Let go with the finger moving `vx` points a second: on to the section beside, or back to this one. */
  release: (dx: number, vx: number) => void;
};

export const SectionPagerContext = createContext<SectionPager | null>(null);

/** The pager of sections this page is on, or null off Home's and Explore's pagers. */
export function useSectionPager(): SectionPager | null {
  return useContext(SectionPagerContext);
}

/** Let go past this share of a page, or flicked that way faster than this (points a second), a swipe goes on to the section. */
const ON_SHARE = 0.25;
const ON_VELOCITY = 500;

/**
 * Where a swipe taken over from a carousel on page `from` ends: the page beside it if the finger went far or fast
 * enough that way (and did not flick back), `from` otherwise; never outside 0…`last`.
 */
export function handOverTarget(from: number, dx: number, vx: number, width: number, last: number): number {
  const direction = dx < 0 ? 1 : -1;
  const flickedOn = Math.abs(vx) > ON_VELOCITY && Math.sign(vx) === Math.sign(dx);
  const flickedBack = Math.abs(vx) > ON_VELOCITY && Math.sign(vx) !== Math.sign(dx);
  const far = Math.abs(dx) > width * ON_SHARE || flickedOn;
  const to = far && !flickedBack ? from + direction : from;
  return Math.max(0, Math.min(last, to));
}

/** Where a page of `width` points sits while a swipe taken over from page `from` has moved `dx`: never past a neighbour. */
export function followOffset(from: number, dx: number, width: number, last: number): number {
  const lo = Math.max(0, from - 1) * width;
  const hi = Math.min(last, from + 1) * width;
  return Math.max(lo, Math.min(hi, from * width - dx));
}
