import { AudioQuality, RecordingPresets, setAudioModeAsync, type RecordingOptions } from "expo-audio";

// The audio session for voice messages. Loaded only by the voice components, which load only where the build has
// expo-audio (see VOICE_AVAILABLE in ./voice).

/**
 * Playing a voice message: the "playback" session, which iOS drives through the loudspeaker at full level (the
 * "play and record" session a recording leaves behind plays through the earpiece path, quiet and thin, so it is
 * always switched back before a play), out loud even with the ringer on silent, as the Messages app does, and alone:
 * music from another app pauses while it plays and resumes after.
 */
export function playbackSession(): Promise<void> {
  return setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: "doNotMix", shouldRouteThroughEarpiece: false, shouldPlayInBackground: false }).catch(() => {});
}

/** Recording one: the microphone on, other audio paused, the speaker (not the earpiece) for anything played meanwhile. */
export function recordingSession(): Promise<void> {
  return setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true, interruptionMode: "doNotMix", shouldRouteThroughEarpiece: false, shouldPlayInBackground: false }).catch(() => {});
}

/**
 * How a voice message is recorded: mono AAC at 44.1 kHz and 96 kbps at the encoder's highest quality setting, with
 * the level metered for the live meter. Speech recorded this way is clean and full (the old 64 kbps setting could
 * smear sibilants), about 0.7 MB a minute, 3.6 MB for the longest message.
 */
export const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: ".m4a",
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 96000,
  isMeteringEnabled: true,
  ios: { ...RecordingPresets.HIGH_QUALITY.ios, audioQuality: AudioQuality.MAX },
};
