import type { PostTargetType } from "@apartment-book/shared";

/**
 * Lets the create and detail screens tell Home → Posts and Home → For you (and the profile grids) what changed, so a feed
 * only reloads when there is something new (and keeps its scroll position the rest of the time).
 */
let stale = false;
let forYouStale = false;
const removeListeners = new Set<(id: string) => void>();

/** A new post was published: reload Posts the next time it is on screen. A post belongs in For you as well, so that reloads too. */
export function markPostsStale() {
  stale = true;
  forYouStale = true;
}

/** Reads the flag and clears it. */
export function takePostsStale(): boolean {
  const was = stale;
  stale = false;
  return was;
}

/** Something new belongs in For you (a reel, say, which Posts never shows): reload it the next time it is on screen. */
export function markForYouStale() {
  forYouStale = true;
}

/** Reads the For you flag and clears it. */
export function takeForYouStale(): boolean {
  const was = forYouStale;
  forYouStale = false;
  return was;
}

/** A post was deleted: drop it from the feeds without reloading. */
export function emitPostRemoved(id: string) {
  removeListeners.forEach((l) => l(id));
}

export function onPostRemoved(listener: (id: string) => void): () => void {
  removeListeners.add(listener);
  return () => {
    removeListeners.delete(listener);
  };
}

const slideListeners = new Set<(id: string, slide: number) => void>();

/**
 * The full-screen viewer moved to another photo or video of the post it was opened from: the post's rows in the feeds
 * show the same one, so the way back lands on the photo that was on screen.
 */
export function emitPostSlide(id: string, slide: number) {
  slideListeners.forEach((l) => l(id, slide));
}

export function onPostSlide(listener: (id: string, slide: number) => void): () => void {
  slideListeners.add(listener);
  return () => {
    slideListeners.delete(listener);
  };
}

const pinListeners = new Set<(id: string, pinned: boolean) => void>();

/** A post or reel was pinned to its author's profile, or unpinned: profile grids move the square without reloading. */
export function emitPostPinned(id: string, pinned: boolean) {
  pinListeners.forEach((l) => l(id, pinned));
}

export function onPostPinned(listener: (id: string, pinned: boolean) => void): () => void {
  pinListeners.add(listener);
  return () => {
    pinListeners.delete(listener);
  };
}

/** What changed on a post, reel or listing: its counts, and whether the person looking likes or has saved it. */
export type PostEngagementPatch = { likes?: number; comments?: number; likedByMe?: boolean; saved?: boolean };
const engagementListeners = new Set<(type: PostTargetType, id: string, patch: PostEngagementPatch) => void>();

/**
 * A post or reel was liked, saved or commented on away from its feed row (in the Reels viewer, say): the row and its
 * engagement state adopt the new numbers without reloading. Fields left undefined are not part of the change.
 */
export function emitPostEngagement(type: PostTargetType, id: string, patch: PostEngagementPatch) {
  const change = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as PostEngagementPatch;
  if (Object.keys(change).length === 0) return;
  engagementListeners.forEach((l) => l(type, id, change));
}

export function onPostEngagement(listener: (type: PostTargetType, id: string, patch: PostEngagementPatch) => void): () => void {
  engagementListeners.add(listener);
  return () => {
    engagementListeners.delete(listener);
  };
}
