import type { MessageSnap } from "@apartment-book/shared";

/**
 * A Snap changed on this device: its viewer opened it, or found it expired or gone. An open chat patches that Snap's
 * bubble at once, before the database's own update arrives over realtime.
 */
export type SnapChange = { snapId: string; patch: Partial<Pick<MessageSnap, "opened_at" | "expires_at" | "gone">> };

const listeners = new Set<(change: SnapChange) => void>();

export function emitSnapChange(change: SnapChange): void {
  listeners.forEach((listener) => listener(change));
}

/** Returns the unsubscribe. */
export function onSnapChange(listener: (change: SnapChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
