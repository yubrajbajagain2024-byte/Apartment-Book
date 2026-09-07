"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True once the component has hydrated in the browser. Use it to render
 * timezone/locale-dependent text (times, "x minutes ago") without hydration
 * mismatches between the server and the user's device.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
