import { useEffect, useRef } from "react";
import { useNavigation } from "expo-router";

/**
 * iOS's convention: tapping the tab you are already on scrolls its list back to the top. `onReselect` runs when this
 * screen's tab is pressed while it is the tab on screen (the floating bar sends the press first, then does nothing else
 * for the focused tab). Call it from anything rendered inside a tab screen; a component that is not on screen (a Home
 * page next to the one shown) passes `enabled: false`.
 */
export function useTabReselect(onReselect: () => void, enabled = true) {
  const navigation = useNavigation();
  const latest = useRef(onReselect);
  latest.current = onReselect;
  useEffect(() => {
    if (!enabled) return;
    const target = navigation as unknown as { addListener: (e: "tabPress", cb: () => void) => () => void; isFocused: () => boolean };
    return target.addListener("tabPress", () => {
      if (target.isFocused()) requestAnimationFrame(() => latest.current());
    });
  }, [navigation, enabled]);
}
