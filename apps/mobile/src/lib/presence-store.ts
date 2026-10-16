import type { PresenceStore } from "@apartment-book/shared";

/**
 * The app's one presence store (lib/presence.tsx makes it), kept here so the session can stop it on sign-out without
 * importing the provider (which imports the session).
 */
let current: { userId: string; store: PresenceStore } | null = null;

export function currentPresence(): { userId: string; store: PresenceStore } | null {
  return current;
}

export function setCurrentPresence(next: { userId: string; store: PresenceStore } | null): void {
  current = next;
}

/** Leave the channel (others see it at once) and stop the heartbeat. */
export function endPresence(): void {
  const c = current;
  current = null;
  if (c) void c.store.stop();
}

/**
 * Signing out: stamp the time once more, then stop appearing online at once and stop the heartbeat. Call it while the
 * session is still there.
 */
export function stopPresence(): void {
  current?.store.pause();
  endPresence();
}
