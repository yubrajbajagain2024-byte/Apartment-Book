import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clock, videoStill } from "@/lib/compose-media";
import type { ComposeMedia } from "@/lib/compose-store";

const FRAMES = 8;
const STRIP_HEIGHT = 64;

/**
 * Choosing a video's cover, TikTok's "Select cover": the clip's frames in a strip, and a window to slide along it; the
 * frame under the window shows large above. That moment becomes the still the feed and the profile show before the
 * video plays (the video provider takes it from there once the upload is processed).
 */
export function CoverPicker({ item, onCancel, onDone }: { item: ComposeMedia; onCancel: () => void; onDone: (next: { coverTime: number; thumbUri: string | null }) => void }) {
  const insets = useSafeAreaInsets();
  const duration = Math.max(0.1, item.duration ?? 1);
  const [frames, setFrames] = useState<(string | null)[]>([]);
  const [strip, setStrip] = useState(0);
  const [time, setTime] = useState(Math.min(item.coverTime, duration));
  const [saving, setSaving] = useState(false);
  const player = useVideoPlayer({ uri: item.uri }, (p) => {
    p.muted = true;
    p.pause();
    p.currentTime = item.coverTime;
  });
  const last = useRef(0);

  // The strip: stills spread evenly over the clip, made one by one so the first ones show at once.
  useEffect(() => {
    let active = true;
    (async () => {
      const out: (string | null)[] = [];
      for (let i = 0; i < FRAMES; i++) {
        const still = await videoStill(item.uri, (duration * (i + 0.5)) / FRAMES);
        if (!active) return;
        out.push(still?.uri ?? null);
        setFrames([...out]);
      }
    })();
    return () => {
      active = false;
    };
  }, [item.uri, duration]);

  const windowWidth = strip > 0 ? strip / FRAMES + 8 : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    if (strip > 0) x.value = (Math.min(item.coverTime, duration) / duration) * (strip - windowWidth + 8);
    // Placed once the strip is measured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip]);

  const seek = (t: number) => {
    setTime(t);
    // Seeking on every frame of a drag swamps the decoder: about 15 times a second is smooth enough.
    const now = Date.now();
    if (now - last.current < 66) return;
    last.current = now;
    player.currentTime = t;
  };
  const settle = (t: number) => {
    setTime(t);
    player.currentTime = t;
  };

  const travel = Math.max(1, strip - windowWidth + 8);
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      x.value = Math.min(travel, Math.max(0, e.x - windowWidth / 2));
      runOnJS(seek)((x.value / travel) * duration);
    })
    .onUpdate((e) => {
      x.value = Math.min(travel, Math.max(0, e.x - windowWidth / 2));
      runOnJS(seek)((x.value / travel) * duration);
    })
    .onFinalize(() => {
      runOnJS(settle)((x.value / travel) * duration);
    });
  const windowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - 4 }] }));

  async function done() {
    if (saving) return;
    setSaving(true);
    const still = await videoStill(item.uri, time);
    onDone({ coverTime: time, thumbUri: still?.uri ?? item.thumbUri });
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]}>
      <View style={[styles.top, { paddingTop: insets.top, height: 56 + insets.top }]}>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" style={styles.topButton}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Cover
        </Text>
        <Pressable onPress={() => void done()} hitSlop={10} accessibilityRole="button" style={[styles.topButton, { alignItems: "flex-end" }]} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.done}>Done</Text>}
        </Pressable>
      </View>
      <View style={styles.preview}>
        <View style={[styles.previewFrame, { aspectRatio: item.width / Math.max(1, item.height) }]}>
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />
        </View>
      </View>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Text style={styles.time}>{clock(time)}</Text>
        <GestureDetector gesture={pan}>
          <View style={styles.strip} onLayout={(e) => setStrip(e.nativeEvent.layout.width)} accessibilityRole="adjustable" accessibilityLabel="Cover frame" accessibilityValue={{ text: clock(time) }}>
            {Array.from({ length: FRAMES }, (_, i) => (
              <View key={i} style={styles.cell}>
                {frames[i] ? <Image source={{ uri: frames[i] as string }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : null}
              </View>
            ))}
            <View style={styles.stripShade} pointerEvents="none" />
            {windowWidth > 0 ? (
              <Animated.View pointerEvents="none" style={[styles.window, { width: windowWidth }, windowStyle]}>
                {frames.length > 0 ? <Image source={{ uri: (frames[Math.min(FRAMES - 1, Math.floor((time / duration) * FRAMES))] ?? frames[0]) as string }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              </Animated.View>
            ) : null}
          </View>
        </GestureDetector>
        <Text style={styles.hint}>Slide to choose the frame people see before your video plays.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#000" },
  top: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  topButton: { minWidth: 64 },
  cancel: { color: "#fff", fontSize: 17 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700" },
  done: { color: "#ffd60a", fontSize: 17, fontWeight: "700" },
  preview: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 12 },
  previewFrame: { maxWidth: "100%", maxHeight: "100%", height: "100%", borderRadius: 16, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#111" },
  bottom: { paddingHorizontal: 20, paddingTop: 8, gap: 12, alignItems: "center" },
  time: { color: "#fff", fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  strip: { alignSelf: "stretch", height: STRIP_HEIGHT, flexDirection: "row", borderRadius: 10, borderCurve: "continuous", backgroundColor: "#1a1a1f" },
  cell: { flex: 1, height: STRIP_HEIGHT, overflow: "hidden" },
  stripShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 10 },
  window: { position: "absolute", top: -6, height: STRIP_HEIGHT + 12, borderRadius: 10, borderCurve: "continuous", borderWidth: 2.5, borderColor: "#fff", overflow: "hidden", backgroundColor: "#000" },
  hint: { color: "rgba(255,255,255,0.65)", fontSize: 13, textAlign: "center" },
});
