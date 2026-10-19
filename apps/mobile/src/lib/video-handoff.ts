import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { createVideoPlayer, type VideoPlayer } from "expo-video";

/**
 * A feed video tapped open in the full-screen viewer is played there by the feed's own player: the same stream, already
 * loaded and running, so the viewer opens on the very frame that was showing and goes on without a pause or a reload,
 * and the feed has it back, still playing, when the viewer closes. While the viewer holds it (lent), the feed leaves it
 * alone. iOS can show one player in two places at once; Android cannot, so there the viewer starts its own player at
 * the same moment instead (see `startAt`).
 *
 * Lending is counted: the viewer borrows the player as it opens (openViewer) and gives it back as it goes, and the page
 * showing it borrows it again for as long as it is mounted; the feed has it back once every borrower has given it back.
 */
export const CAN_SHARE_PLAYERS = Platform.OS === "ios";

const leases = new Map<VideoPlayer, number>();
/** Players whose feed row went while the viewer still held them: released once given back. */
const orphans = new Set<VideoPlayer>();
const listeners = new Set<() => void>();
let version = 0;
function changed() {
  version += 1;
  listeners.forEach((l) => l());
}

export function lendPlayer(player: VideoPlayer) {
  const held = leases.get(player) ?? 0;
  leases.set(player, held + 1);
  if (held === 0) changed();
}

export function returnPlayer(player: VideoPlayer) {
  const held = leases.get(player);
  if (!held) return;
  if (held > 1) {
    leases.set(player, held - 1);
    return;
  }
  leases.delete(player);
  if (orphans.delete(player)) player.release();
  changed();
}

export function isLent(player: VideoPlayer): boolean {
  return leases.has(player);
}

/**
 * Players that have drawn a frame in the feed. The viewer puts no poster over one of those: its picture is live (even
 * while it buffers, or between two laps of its loop), and the poster, a frame a second in, would be the wrong one.
 */
const drawn = new WeakSet<VideoPlayer>();
export function markDrawn(player: VideoPlayer) {
  drawn.add(player);
}
export function hasDrawn(player: VideoPlayer): boolean {
  return drawn.has(player);
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

/**
 * A feed video's own player, made and released with its component as `useVideoPlayer`'s is, except that a player the
 * viewer still holds is never released under it (a feed that reloads while the viewer is up): it goes once given back.
 * One player per mount: a row showing another video is another row.
 */
export function useLendablePlayer(uri: string, setup: (player: VideoPlayer) => void): VideoPlayer {
  const [player] = useState(() => {
    const made = createVideoPlayer({ uri });
    setup(made);
    return made;
  });
  // A fast refresh runs the effect's cleanup too: only a real unmount lets go (expo-modules-core's own trick).
  const refreshing = useRef(false);
  useMemo(() => {
    refreshing.current = true;
  }, []);
  useEffect(() => {
    refreshing.current = false;
    return () => {
      if (refreshing.current) return;
      if (leases.has(player)) orphans.add(player);
      else player.release();
    };
  }, [player]);
  return player;
}
