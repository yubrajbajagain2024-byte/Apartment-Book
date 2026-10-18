import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The two iOS settings that change how the app looks and moves, read once and kept current: Reduce Motion (springs,
 * fades and symbol effects become instant) and Reduce Transparency (Liquid Glass gives way to solid fills). One listener
 * each for the whole app, however many components ask.
 */
type Flag = { get: () => boolean; subscribe: (listener: () => void) => () => void };

function createFlag(read: () => Promise<boolean>, event: "reduceMotionChanged" | "reduceTransparencyChanged"): Flag {
  let value = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === value) return;
    value = next;
    listeners.forEach((l) => l());
  };
  read().then(set, () => {});
  AccessibilityInfo.addEventListener(event, set);
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const reduceMotion = createFlag(() => AccessibilityInfo.isReduceMotionEnabled(), "reduceMotionChanged");
const reduceTransparency = createFlag(() => AccessibilityInfo.isReduceTransparencyEnabled(), "reduceTransparencyChanged");

/** Settings → Accessibility → Motion → Reduce Motion. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(reduceMotion.subscribe, reduceMotion.get, reduceMotion.get);
}

/** Settings → Accessibility → Display & Text Size → Reduce Transparency. */
export function useReduceTransparency(): boolean {
  return useSyncExternalStore(reduceTransparency.subscribe, reduceTransparency.get, reduceTransparency.get);
}

/** For code outside React (a press handler deciding whether to animate). */
export function reduceMotionEnabled(): boolean {
  return reduceMotion.get();
}
