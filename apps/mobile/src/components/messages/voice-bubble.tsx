import { useEffect, useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Icon } from "@/components/icon";
import { formatDuration } from "@/lib/message-attachments";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { voiceBars } from "@/lib/voice";

/**
 * A voice message in the chat: the play button, its waveform filling in as it plays, and the time (its length, then
 * what is left). It plays out loud even with the ringer switch on silent, as the Messages app does; one tap pauses.
 * `uri` is null while its link is being signed.
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
  const player = useAudioPlayer(uri ? { uri } : null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const bars = useMemo(() => voiceBars(cacheKey), [cacheKey]);

  // Back to the start once it has played through, ready for the next tap.
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  const total = status.duration > 0 ? status.duration : (duration ?? 0);
  const progress = total > 0 ? Math.min(1, status.currentTime / total) : 0;
  const playing = status.playing;
  const loading = Boolean(uri) && !status.isLoaded;
  const ink = mine ? colors.onBrand : colors.text;
  const faint = mine ? "rgba(255,255,255,0.45)" : colors.faint;
  const shown = playing || status.currentTime > 0 ? Math.max(0, total - status.currentTime) : total;

  function toggle() {
    if (!uri) return;
    if (playing) {
      player.pause();
      return;
    }
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    if (total > 0 && status.currentTime >= total - 0.05) void player.seekTo(0);
    player.play();
  }

  return (
    <Pressable
      onPress={toggle}
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
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  bubble: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 18, borderCurve: "continuous", paddingLeft: 6, paddingRight: 14, paddingVertical: 6, width: 236 },
  play: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  wave: { flex: 1, height: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bar: { width: 3, borderRadius: 1.5 },
  time: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 32, textAlign: "right" },
}));
