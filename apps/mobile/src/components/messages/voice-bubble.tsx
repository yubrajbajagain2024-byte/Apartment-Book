import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { hapticSelect } from "@/lib/haptics";
import { formatDuration } from "@/lib/message-attachments";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { cycleVoiceRate, useVoiceRate, voiceBars, voiceRateLabel } from "@/lib/voice";
import { playbackSession } from "@/lib/voice-audio";

/**
 * A voice message in the chat: the play button, its waveform filling in as it plays, the time (its length, then what
 * is left) and, once it has started, a speed pill (1×, 1.5×, 2×, one tap each; the speed is kept for every voice
 * message, pitch corrected so a voice stays a voice). It plays out loud through the loudspeaker even with the ringer
 * switch on silent, as the Messages app does, pausing music from other apps while it plays; one tap pauses. `uri` is
 * null while its link is being signed.
 */
export function VoiceBubble({
  uri,
  cacheKey,
  duration,
  mine,
  dimmed,
  corners,
  onLongPress,
}: {
  uri: string | null;
  cacheKey: string;
  duration: number | null | undefined;
  mine: boolean;
  dimmed?: boolean;
  corners?: ViewStyle;
  onLongPress?: () => void;
}) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const player = useAudioPlayer(uri ? { uri } : null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const bars = useMemo(() => voiceBars(cacheKey), [cacheKey]);
  const rate = useVoiceRate();
  const starting = useRef(false);

  // Back to the start once it has played through, ready for the next tap.
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  // The chosen speed, applied the moment it changes (on this bubble or any other), pitch kept.
  useEffect(() => {
    if (!status.isLoaded) return;
    try {
      player.setPlaybackRate(rate, "high");
    } catch {
      // Not every build can; it then plays at its usual speed.
    }
  }, [rate, status.isLoaded, player]);

  const total = status.duration > 0 ? status.duration : (duration ?? 0);
  const progress = total > 0 ? Math.min(1, status.currentTime / total) : 0;
  const playing = status.playing;
  const loading = Boolean(uri) && !status.isLoaded;
  const started = playing || status.currentTime > 0.05;
  const ink = mine ? colors.onBrand : colors.text;
  const faint = mine ? "rgba(255,255,255,0.45)" : colors.faint;
  const shown = started ? Math.max(0, total - status.currentTime) : total;

  async function toggle() {
    if (!uri || starting.current) return;
    if (playing) {
      player.pause();
      return;
    }
    starting.current = true;
    try {
      // The playback session first, awaited: the loud, clean speaker path, never the earpiece path a recording leaves.
      await playbackSession();
      player.volume = 1;
      try {
        player.setPlaybackRate(rate, "high");
      } catch {
        // See above.
      }
      if (total > 0 && status.currentTime >= total - 0.05) await player.seekTo(0);
      player.play();
    } finally {
      starting.current = false;
    }
  }

  function changeSpeed() {
    hapticSelect();
    cycleVoiceRate();
  }

  return (
    <Pressable
      onPress={() => void toggle()}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Voice message, ${formatDuration(total) || "unknown length"}`}
      accessibilityHint={playing ? "Pauses it" : "Plays it"}
      style={[styles.bubble, mine ? { backgroundColor: colors.brand } : { backgroundColor: colors.input }, corners, dimmed && { opacity: 0.6 }]}
    >
      <View style={[styles.play, { backgroundColor: mine ? "rgba(255,255,255,0.22)" : colors.bg }]}>
        {loading || !uri ? <ActivityIndicator size="small" color={ink} /> : <Icon name={playing ? "pause" : "play"} size={17} color={ink} />}
      </View>
      <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {bars.map((h, i) => (
          <View key={i} style={[styles.bar, { height: Math.round(4 + h * 20), backgroundColor: (i + 0.5) / bars.length <= progress ? ink : faint }]} />
        ))}
      </View>
      <Text style={[styles.time, { color: ink }]}>{formatDuration(shown) || "0:00"}</Text>
      {started ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(160)} exiting={reduceMotion ? undefined : FadeOut.duration(120)}>
          <Pressable
            onPress={changeSpeed}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Playback speed, ${voiceRateLabel(rate)}`}
            accessibilityHint="Changes the speed"
            style={({ pressed }) => [styles.speed, { backgroundColor: mine ? "rgba(255,255,255,0.22)" : colors.bg }, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.speedText, { color: ink }]}>{voiceRateLabel(rate)}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  bubble: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 18, borderCurve: "continuous", paddingLeft: 6, paddingRight: 10, paddingVertical: 6, width: 248 },
  play: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  wave: { flex: 1, height: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bar: { width: 3, borderRadius: 1.5 },
  time: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 32, textAlign: "right" },
  speed: { height: 24, minWidth: 34, paddingHorizontal: 7, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  speedText: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
}));
