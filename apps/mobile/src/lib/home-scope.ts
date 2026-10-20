import { useSyncExternalStore } from "react";

/**
 * What Home shows, chosen on the Campus | Global toggle under the Home labels (and "Following" while Posts has a tab): `campus`
 * is the person's own university or every university, `following` keeps Posts to the people they follow. One store for
 * the whole app, so For you, Buzz, Posts and Reels follow the same choice and it survives leaving the Home tab. Someone without a university (signed out, or none on the profile) sees every campus whatever `campus` says:
 * the sections pass no university in that case.
 */
export type HomeScope = { campus: "mine" | "all"; following: boolean };

/**
 * Whether the Campus | Global toggle (and "Following" in it, while Posts has a tab) is shown: under Home's labels and in
 * the Reels viewer's top row. Temporarily off: every feed stays on its default (your own campus, everyone's without a
 * university), and the toggle, the scope and everything that follows it are all still here. Set it back to true to
 * bring the toggle back.
 */
export const SCOPE_TOGGLE_SHOWN = false;

let scope: HomeScope = { campus: "mine", following: false };
const listeners = new Set<() => void>();

export function getHomeScope(): HomeScope {
  return scope;
}

/** Changes part of the choice. Nothing re-renders when the result is the same choice. */
export function setHomeScope(patch: Partial<HomeScope>) {
  const next: HomeScope = { ...scope, ...patch };
  if (next.campus === scope.campus && next.following === scope.following) return;
  scope = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHomeScope(): [HomeScope, typeof setHomeScope] {
  return [useSyncExternalStore(subscribe, getHomeScope, getHomeScope), setHomeScope];
}
