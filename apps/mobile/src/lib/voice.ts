import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

/** The playback speeds a voice message offers, in the order a tap on the speed pill cycles through them. */
export const VOICE_RATES = [1, 1.5, 2] as const;
export type VoiceRate = (typeof VOICE_RATES)[number];

/** "1×", "1.5×", "2×". */
export function voiceRateLabel(rate: VoiceRate): string {
  return `${rate}×`;
}

/**
 * The chosen speed, one for every voice message (as in WhatsApp): changing it on one bubble changes the next one too,
 * and it is remembered across launches. Read with useVoiceRate(); cycleVoiceRate() moves to the next speed.
 */
const RATE_KEY = "campconnect.voiceRate";
let rate: VoiceRate = 1;
const listeners = new Set<() => void>();
const isRate = (v: unknown): v is VoiceRate => (VOICE_RATES as readonly number[]).includes(v as number);

AsyncStorage.getItem(RATE_KEY).then(
  (stored) => {
    const parsed = stored ? Number(stored) : NaN;
    if (isRate(parsed) && parsed !== rate) {
      rate = parsed;
      listeners.forEach((l) => l());
    }
  },
  () => {},
);

export function getVoiceRate(): VoiceRate {
  return rate;
}

export function setVoiceRate(next: VoiceRate) {
  if (next === rate) return;
  rate = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(RATE_KEY, String(next)).catch(() => {});
}

/** The next speed after the current one: 1× → 1.5× → 2× → 1×. */
export function cycleVoiceRate(): VoiceRate {
  const next = VOICE_RATES[(VOICE_RATES.indexOf(rate) + 1) % VOICE_RATES.length];
  setVoiceRate(next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVoiceRate(): VoiceRate {
  return useSyncExternalStore(subscribe, getVoiceRate, getVoiceRate);
}

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
