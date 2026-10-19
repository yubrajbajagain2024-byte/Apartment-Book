import { useSyncExternalStore } from "react";
import type { AudioMixingMode } from "expo-video";

/**
 * How every feed video meets other audio, the same on the feed's players and the viewer's (a handed-over player keeps
 * the session as it was): muted, it leaves the person's music playing; with sound on, it takes the audio over. (Native
 * expo-video defaults to "doNotMix", which stops the music for a muted video scrolling past.)
 */
export const VIDEO_AUDIO_MODE: AudioMixingMode = "auto";

/**
 * One sound switch for every feed video, Instagram style: the feeds' videos, the Reels tab and the full-screen viewer all
 * start muted, and sound turned on (or off) on one is on (or off) on all of them. So a video handed from the feed to the
 * viewer (see video-handoff.ts) keeps its sound exactly as it was, there and back, instead of cutting out or coming on.
 */
let muted = true;
const listeners = new Set<() => void>();

export function videosMuted(): boolean {
  return muted;
}

export function setVideosMuted(next: boolean) {
  if (next === muted) return;
  muted = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVideosMuted(): boolean {
  return useSyncExternalStore(subscribe, videosMuted, videosMuted);
}
