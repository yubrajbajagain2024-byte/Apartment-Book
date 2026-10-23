import { requireOptionalNativeModule } from "expo";

/**
 * Whether this build of the app can record and play voice messages: Expo Go can; an installed build made before voice
 * messages (without expo-audio inside) cannot, so it shows no microphone and plays voice messages as files instead.
 * The voice components load expo-audio only when this is true.
 */
export const VOICE_AVAILABLE = Boolean(requireOptionalNativeModule("ExpoAudio"));

/** The longest voice message: recording stops and sends at this many seconds. */
export const VOICE_MAX_SECONDS = 300;

/** Shorter than this, a recording is dropped rather than sent (a tap on the microphone by mistake). */
export const VOICE_MIN_SECONDS = 0.6;

/** 24 bar heights (0.15 to 1) for a voice message's waveform, the same for the same file every time. */
export function voiceBars(seed: string, count = 24): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ i;
    const v = ((h >>> 0) % 1000) / 1000;
    // Louder in the middle, as speech tends to be.
    const shape = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / count);
    bars.push(Math.max(0.15, Math.min(1, v * shape + 0.12)));
  }
  return bars;
}
