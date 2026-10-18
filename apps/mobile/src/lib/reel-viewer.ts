import type { useRouter } from "expo-router";
import type { Reel } from "@apartment-book/shared";

/** expo-router does not export its router type: this is what useRouter() hands out. */
type Router = ReturnType<typeof useRouter>;

/**
 * Opens the full-screen Reels viewer (app/reels/[id].tsx) on a reel that is already on screen, the way Instagram opens a
 * reel tapped in the feed: the row hands its reel over here, so the viewer shows it at once, with the row's own counts
 * and no spinner, and loads the other reels behind it. A viewer opened some other way (a link) finds nothing here and
 * fetches the reel by its id instead.
 */
let handed: Reel | null = null;

export function openReel(router: Router, reel: Reel) {
  handed = reel;
  router.push({ pathname: "/reels/[id]", params: { id: reel.sourceId } });
}

/** The reel handed over for this id, if that is what was handed over last. Left in place until `dropHandedReel`, so a render that runs twice reads the same thing. */
export function peekHandedReel(id: string): Reel | null {
  return handed && handed.sourceId === id ? handed : null;
}

/** Forgets the reel handed over for this id (the viewer leaving). */
export function dropHandedReel(id: string) {
  if (handed && handed.sourceId === id) handed = null;
}
