import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

/**
 * The floating bottom bar: a rounded glass pill `TAB_BAR_SIDE` in from the screen's sides and `tabBarBottom(insets)` up
 * from its bottom edge, drawn over the tabs' content (see app/(tabs)/_layout.tsx). Lists and floating buttons on the
 * tabs keep `tabBarInset(insets)` clear under them, so nothing ends up hidden behind the bar.
 */
export const TAB_BAR_HEIGHT = 66;
export const TAB_BAR_SIDE = 14;

/**
 * How far into the home-indicator area the bar sits, as Instagram's does: low, just above the indicator itself rather
 * than on top of the whole safe area. 12pt of a 34pt inset leaves 22pt, clear of the indicator and its swipe.
 */
const INTO_SAFE_AREA = 12;

/** Up from the screen's bottom edge: just above the home indicator where there is one, a little way otherwise. */
export function tabBarBottom(insets: EdgeInsets): number {
  return Math.max(insets.bottom - INTO_SAFE_AREA, 10);
}

/** How much of the screen's bottom the floating bar covers. */
export function tabBarInset(insets: EdgeInsets): number {
  return tabBarBottom(insets) + TAB_BAR_HEIGHT;
}

/** `tabBarInset` for the screen this is rendered on. */
export function useTabBarInset(): number {
  return tabBarInset(useSafeAreaInsets());
}

/**
 * The collapsed bar (lib/tab-bar-collapse.ts): a circle as tall as the bar, holding the tab on screen, drawn at this scale
 * from its bottom left corner, so it keeps the bar's bottom edge and its left inset and every radius stays in proportion.
 */
export const TAB_BAR_COLLAPSED_SCALE = 0.82;
/** The collapsed bar's size on screen. */
export const TAB_BAR_COLLAPSED = TAB_BAR_HEIGHT * TAB_BAR_COLLAPSED_SCALE;

/**
 * Where a floating button (`size` across, `right` in from the screen's right edge and `bottom` up from its bottom edge
 * while the whole bar shows) goes as the bar collapses: it becomes the collapsed bar's twin, the same circle at the same
 * height, as far in from the right edge as the collapsed bar is from the left (TAB_BAR_SIDE), as X's compose button sits
 * opposite its bar. `x` and `y` move its centre there (right and down, in points); `scale` makes it TAB_BAR_COLLAPSED
 * across. Apply them as translateX, translateY, then scale (scaled about the button's centre).
 */
export function collapsedRide(insets: EdgeInsets, bottom: number, size: number, right: number): { x: number; y: number; scale: number } {
  const radius = TAB_BAR_COLLAPSED / 2;
  return {
    x: right + size / 2 - (TAB_BAR_SIDE + radius),
    y: bottom + size / 2 - (tabBarBottom(insets) + radius),
    scale: TAB_BAR_COLLAPSED / size,
  };
}
