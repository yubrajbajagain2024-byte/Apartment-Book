/**
 * Lets the create and detail screens tell Home → Posts what changed, so the feed only reloads
 * when there is something new (and keeps its scroll position the rest of the time).
 */
let stale = false;
const removeListeners = new Set<(id: string) => void>();

/** A new post was published: reload the feed the next time it is on screen. */
export function markPostsStale() {
  stale = true;
}

/** Reads the flag and clears it. */
export function takePostsStale(): boolean {
  const was = stale;
  stale = false;
  return was;
}

/** A post was deleted: drop it from the feed without reloading. */
export function emitPostRemoved(id: string) {
  removeListeners.forEach((l) => l(id));
}

export function onPostRemoved(listener: (id: string) => void): () => void {
  removeListeners.add(listener);
  return () => {
    removeListeners.delete(listener);
  };
}
