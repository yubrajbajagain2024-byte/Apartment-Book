import { useSyncExternalStore } from "react";

/**
 * What Home shows, chosen from the dropdown next to the wordmark in the top bar (Instagram's "Following / Favorites"
 * menu): `campus` is the person's own university or every university, `following` keeps Posts to the people they
 * follow. One store for the whole app, so For you, Buzz and Posts follow the same choice and it survives leaving the
 * Home tab. Someone without a university (signed out, or none on the profile) sees every campus whatever `campus` says:
 * the sections pass no university in that case.
 */
export type HomeScope = { campus: "mine" | "all"; following: boolean };

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
