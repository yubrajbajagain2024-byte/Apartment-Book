import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { File as DeviceFile } from "expo-file-system";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { hapticTap } from "@/lib/haptics";
import { formatDuration, type PendingAttachment } from "@/lib/message-attachments";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { VOICE_MAX_SECONDS, VOICE_MIN_SECONDS } from "@/lib/voice";

/** Mono AAC at 64 kbps: clear speech, about half a megabyte a minute. */
const VOICE_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true };
/** How many level bars the live meter keeps. */
const METER_BARS = 32;

/** -60 dB (silence) to 0 dB as 0.08 to 1, for the live meter. */
function level(db: number | undefined): number {
  if (typeof db !== "number" || !Number.isFinite(db)) return 0.08;
  return Math.max(0.08, Math.min(1, (db + 60) / 60));
}

/**
 * The message bar while a voice message is being recorded, in place of the field: discard on the left, the red dot and
 * the time, the voice's level moving as you speak, and the send button. It starts recording as it appears (asking for
 * the microphone the first time) and stops at five minutes, sending what it has.
 */
export function VoiceRecorder({ onCancel, onSend }: { onCancel: () => void; onSend: (item: PendingAttachment) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const recorder = useAudioRecorder(VOICE_OPTIONS);
  const state = useAudioRecorderState(recorder, 80);
  const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0.08));
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const finished = useRef(false);
  const pulse = useSharedValue(1);

  // Start at once: microphone permission, a session that records, then record.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (cancelled) return;
      if (!permission.granted) {
        finished.current = true;
        Alert.alert("Microphone access is off", "Allow microphone access in Settings to send voice messages.", [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ]);
        onCancel();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (cancelled) return;
      recorder.record();
      readyRef.current = true;
      setReady(true);
    })().catch(() => {
      if (cancelled) return;
      finished.current = true;
      Alert.alert("Couldn't record", "The microphone isn't available right now.");
      onCancel();
    });
    return () => {
      cancelled = true;
      // Left without sending (the chat closed): the recording is thrown away.
      if (!finished.current) void recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
    // Once, as the bar appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pulse.value = reduceMotion ? 1 : withRepeat(withSequence(withTiming(0.35, { duration: 600, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) })), -1);
  }, [pulse, reduceMotion]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));

  // The meter: each new level pushes the oldest out.
  useEffect(() => {
    if (!state.isRecording) return;
    setLevels((prev) => [...prev.slice(1), level(state.metering)]);
  }, [state.durationMillis, state.isRecording, state.metering]);

  const seconds = state.durationMillis / 1000;

  async function finish(send: boolean) {
    if (finished.current) return;
    // Not recording yet (the microphone question is still up): there is nothing to send, only something to leave.
    if (send && !readyRef.current) return;
    finished.current = true;
    const duration = recorder.getStatus().durationMillis / 1000;
    try {
      await recorder.stop();
    } catch {
      // Stopped already.
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    if (!send || !uri || duration < VOICE_MIN_SECONDS) {
      onCancel();
      return;
    }
    let size = 0;
    try {
      size = new DeviceFile(uri).size ?? 0;
    } catch {
      size = 0;
    }
    hapticTap();
    onSend({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      kind: "audio",
      uri,
      name: "Voice message.m4a",
      size,
      mime: "audio/mp4",
      width: null,
      height: null,
      duration: Math.round(duration * 10) / 10,
    });
  }

  // Five minutes is the most a voice message holds.
  useEffect(() => {
    if (seconds >= VOICE_MAX_SECONDS) void finish(true);
    // finish() reads only refs and the recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  return (
    <View style={styles.row} accessibilityLabel={`Recording a voice message, ${formatDuration(seconds) || "0:00"}`}>
      <Pressable onPress={() => void finish(false)} hitSlop={8} style={styles.side} accessibilityRole="button" accessibilityLabel="Discard voice message">
        <Icon name="trash-outline" size={22} color={colors.red} />
      </Pressable>
      <View style={styles.track}>
        <Animated.View style={[styles.dot, { backgroundColor: colors.red }, dot]} />
        <Text style={styles.time}>{formatDuration(seconds) || "0:00"}</Text>
        <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {levels.map((l, i) => (
            <View key={i} style={[styles.bar, { height: Math.max(3, Math.round(l * 24)), backgroundColor: ready ? colors.brand : colors.faint }]} />
          ))}
        </View>
      </View>
      <Pressable
        onPress={() => void finish(true)}
        disabled={!ready}
        hitSlop={6}
        style={({ pressed }) => [styles.send, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }, !ready && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.94 }] }]}
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
      >
        <Icon name="send" size={17} color={colors.onBrand} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingTop: 8 },
  side: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  track: { flex: 1, height: 40, borderRadius: 20, backgroundColor: colors.input, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 8, overflow: "hidden" },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  time: { fontSize: 15, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"], minWidth: 38 },
  meter: { flex: 1, height: 26, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 },
  bar: { width: 3, borderRadius: 1.5 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
}));
