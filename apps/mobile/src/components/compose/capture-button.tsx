import { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useReduceMotion } from "@/lib/accessibility";
import { auroraGradient, motion } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";

const SIZE = 82;
const INNER = 66;
const STOP = 30;

/**
 * The camera's shutter, as on TikTok and the iPhone's camera: a white ring around a white disc for a photo, around the
 * Aurora (UniBuzz's signature where TikTok has its red) for a video; switching between them crossfades the two discs.
 * Recording, the disc shrinks into a rounded square (tap it to stop) and the ring opens up a little; it sinks under the
 * finger. `busy` shows a spinner while a shot is being prepared.
 */
export function CaptureButton({ kind, recording, busy, disabled, onPress, label }: { kind: "photo" | "video"; recording: boolean; busy?: boolean; disabled?: boolean; onPress: () => void; label: string }) {
  const { colors } = useAppTheme();
  const reduce = useReduceMotion();
  const pressed = useSharedValue(1);
  const rec = useSharedValue(recording ? 1 : 0);
  const video = useSharedValue(kind === "video" || recording ? 1 : 0);

  useEffect(() => {
    rec.value = reduce ? (recording ? 1 : 0) : withSpring(recording ? 1 : 0, motion.snappy);
  }, [recording, reduce, rec]);
  useEffect(() => {
    const to = kind === "video" || recording ? 1 : 0;
    video.value = reduce ? to : withTiming(to, { duration: 200, easing: Easing.out(Easing.quad) });
  }, [kind, recording, reduce, video]);

  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pressed.value * (1 + rec.value * 0.14) }] }));
  const disc = useAnimatedStyle(() => {
    const size = INNER - (INNER - STOP) * rec.value;
    return { width: size, height: size, borderRadius: size / 2 - (size / 2 - 8) * rec.value };
  });
  const auroraLayer = useAnimatedStyle(() => ({ opacity: video.value }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        if (!reduce) pressed.value = withTiming(0.92, { duration: 90 });
      }}
      onPressOut={() => {
        pressed.value = withSpring(1, motion.spring);
      }}
      disabled={disabled || busy}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={styles.hit}
    >
      <Animated.View style={[styles.ring, ring, { opacity: disabled ? 0.5 : 1 }]} />
      <Animated.View style={[styles.disc, styles.white, disc]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }, auroraLayer]} />
      </Animated.View>
      {busy ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.center}>
            <ActivityIndicator color={kind === "photo" ? "#000" : "#fff"} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: SIZE + 16, height: SIZE + 16, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 5, borderColor: "rgba(255,255,255,0.95)" },
  disc: { width: INNER, height: INNER, borderRadius: INNER / 2, borderCurve: "continuous", overflow: "hidden" },
  white: { backgroundColor: "#ffffff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
