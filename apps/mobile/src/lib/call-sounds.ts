import { Vibration } from "react-native";
import { VOICE_AVAILABLE } from "./voice";

/**
 * The sounds of a call: the ring of an incoming one (with the phone buzzing), the ringback the caller hears while the
 * other side rings, and the short tone when a call ends. Played through expo-audio where the build has it (every build
 * made since voice messages; Expo Go), silently otherwise. Each sound is one player, made when first needed.
 */
type Player = { play: () => void; pause: () => void; seekTo: (s: number) => Promise<void>; loop: boolean; volume: number; remove: () => void };
type Audio = { createAudioPlayer: (source: unknown) => Player; setAudioModeAsync: (mode: Record<string, unknown>) => Promise<void> };

const audio: Audio | null = VOICE_AVAILABLE ? (require("expo-audio") as Audio) : null;
const sources = {
  ring: () => require("../../assets/sounds/ring.wav") as number,
  ringback: () => require("../../assets/sounds/ringback.wav") as number,
  end: () => require("../../assets/sounds/end.wav") as number,
};
const players: Partial<Record<keyof typeof sources, Player>> = {};

function player(name: keyof typeof sources): Player | null {
  if (!audio) return null;
  if (!players[name]) {
    try {
      const p = audio.createAudioPlayer(sources[name]());
      p.loop = name !== "end";
      p.volume = name === "ringback" ? 0.6 : 1;
      players[name] = p;
    } catch {
      return null;
    }
  }
  return players[name] ?? null;
}

/** The incoming ring: looping, with the phone buzzing, until stopRinging(). It respects the silent switch (the buzz does not). */
export function startRinging() {
  void audio?.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "doNotMix" }).catch(() => {});
  const p = player("ring");
  if (p) {
    void p.seekTo(0);
    p.play();
  }
  Vibration.vibrate([0, 700, 500, 700, 1300], true);
}

export function stopRinging() {
  players.ring?.pause();
  Vibration.cancel();
}

/** What the caller hears while the other side rings: a soft tone every few seconds, until stopRingback(). */
export function startRingback() {
  void audio?.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "doNotMix" }).catch(() => {});
  const p = player("ringback");
  if (p) {
    void p.seekTo(0);
    p.play();
  }
}

export function stopRingback() {
  players.ringback?.pause();
}

/** The two short notes of a call ending. */
export function playCallEnded() {
  stopRinging();
  stopRingback();
  const p = player("end");
  if (p) {
    void p.seekTo(0);
    p.play();
  }
}
