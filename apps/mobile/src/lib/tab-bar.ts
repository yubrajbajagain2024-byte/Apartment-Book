import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

/**
 * The floating bottom bar: a rounded glass pill `TAB_BAR_SIDE` in from the screen's sides and `tabBarBottom(insets)` up
 * from its bottom edge, drawn over the tabs' content (see app/(tabs)/_layout.tsx). Lists and floating buttons on the
 * five tabs keep `tabBarInset(insets)` clear under them, so nothing ends up hidden behind the bar.
 */
export const TAB_BAR_HEIGHT = 66;
export const TAB_BAR_SIDE = 14;

/** Up from the screen's bottom edge: on top of the home indicator where there is one, a little way otherwise. */
export function tabBarBottom(insets: EdgeInsets): number {
  return Math.max(insets.bottom, 12);
}

/** How much of the screen's bottom the floating bar covers. */
export function tabBarInset(insets: EdgeInsets): number {
  return tabBarBottom(insets) + TAB_BAR_HEIGHT;
}

/** `tabBarInset` for the screen this is rendered on. */
export function useTabBarInset(): number {
  return tabBarInset(useSafeAreaInsets());
}
