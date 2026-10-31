"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** False during the server render and hydration, true after: for text that depends on the browser's clock or zone. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
