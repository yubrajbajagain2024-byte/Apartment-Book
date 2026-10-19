import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import type { VideoPlayer } from "expo-video";

/**
 * A feed video tapped open in the full-screen viewer is played there by the feed's own player: the same stream, already
 * loaded and running, so the viewer opens on the very frame that was showing and goes on without a pause or a reload,
 * and the feed has it back, still playing, when the viewer closes. While the viewer holds it (lent), the feed leaves it
 * alone. iOS can show one player in two places at once; Android cannot, so there the viewer starts its own player at
 * the same moment instead (see `startAt`).
 */
export const CAN_SHARE_PLAYERS = Platform.OS === "ios";

const lent = new Set<VideoPlayer>();
const listeners = new Set<() => void>();
let version = 0;
function changed() {
  version += 1;
  listeners.forEach((l) => l());
}

export function lendPlayer(player: VideoPlayer) {
  lent.add(player);
  changed();
}

export function returnPlayer(player: VideoPlayer) {
  if (lent.delete(player)) changed();
}

export function isLent(player: VideoPlayer): boolean {
  return lent.has(player);
}

/** Re-renders when a player is lent or returned, so the owner takes charge of it again the moment it is back. */
export function useLendings(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => version,
    () => version,
  );
}
