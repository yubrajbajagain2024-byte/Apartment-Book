import type { HomeSection } from "@apartment-book/shared";

/**
 * Lets another screen ask Home to show one of its sections (Reels | Buzz | Posts) the next time it is on screen.
 * Example: after posting a reel, Home opens on Reels so the person sees what they just shared.
 */
let pending: HomeSection | null = null;
const listeners = new Set<() => void>();

export function openHomeSection(section: HomeSection) {
  pending = section;
  listeners.forEach((l) => l());
}

/** Returns the requested section once, then forgets it. */
export function takeHomeSection(): HomeSection | null {
  const s = pending;
  pending = null;
  return s;
}

export function onHomeSectionRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
