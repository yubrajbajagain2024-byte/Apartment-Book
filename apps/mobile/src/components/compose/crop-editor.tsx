import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image as NativeImage, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icon";
import { alertWithHaptic, hapticSelect } from "@/lib/haptics";
import type { ComposeMedia, CropSpec } from "@/lib/compose-store";

const ASPECTS: { label: string; value: number | null }[] = [
  { label: "Original", value: null },
  { label: "Square", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
];

/**
 * Crop and turn a photo, as in Photos: a fixed frame of the chosen shape, the photo moved and pinched under it (it
 * always fills the frame), turned a quarter at a time. Every crop starts from the photo as it came, so cropping again
 * never loses what an earlier crop cut away. Done hands back the new picture.
 */
export function CropEditor({ item, onCancel, onDone }: { item: ComposeMedia; onCancel: () => void; onDone: (next: { baseUri: string; width: number; height: number; crop: CropSpec | null }) => void }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  /** The room between the top bar and the controls, measured: the frame is as large as fits in it. */
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [rotation, setRotation] = useState<CropSpec["rotation"]>(item.crop?.rotation ?? 0);
  const [aspect, setAspect] = useState<number | null>(item.crop?.aspect ?? null);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);

  // The original's size: the item's own width and height are those of the cropped picture.
  useEffect(() => {
    NativeImage.getSize(
      item.originalUri,
      (w, h) => setSize({ w, h }),
      () => setSize({ w: item.width, h: item.height }),
    );
  }, [item.originalUri, item.width, item.height]);

  const turned = size ? (rotation % 180 === 0 ? size : { w: size.h, h: size.w }) : null;
  const area = { w: (room?.w ?? screenWidth) - 32, h: (room?.h ?? 0) - 32 };
  const frame = useMemo(() => {
    if (!turned || !room) return null;
    const shape = aspect ?? turned.w / turned.h;
    let w = area.w;
    let h = w / shape;
    if (h > area.h) {
      h = area.h;
      w = h * shape;
    }
    return { w, h };
  }, [turned, aspect, room, area.w, area.h]);
  const minScale = turned && frame ? Math.max(frame.w / turned.w, frame.h / turned.h) : 1;

  const scale = useSharedValue(1);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const start = useSharedValue({ s: 1, x: 0, y: 0 });

  // A new shape or a quarter turn starts the photo filling the frame again; the first time, it starts where the last crop left it.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!turned || !frame) return;
    const crop = item.crop;
    if (!restored && crop && crop.rotation === rotation && crop.aspect === aspect) {
      const s = frame.w / (crop.rect.width * turned.w);
      scale.value = Math.max(minScale, s);
      ox.value = (turned.w * scale.value) / 2 - frame.w / 2 - crop.rect.x * turned.w * scale.value;
      oy.value = (turned.h * scale.value) / 2 - frame.h / 2 - crop.rect.y * turned.h * scale.value;
    } else {
      scale.value = minScale;
      ox.value = 0;
      oy.value = 0;
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turned?.w, turned?.h, frame?.w, frame?.h, rotation]);

  const fw = frame?.w ?? 0;
  const fh = frame?.h ?? 0;
  const tw = turned?.w ?? 1;
  const th = turned?.h ?? 1;
  const clamp = (s: number, x: number, y: number) => {
    "worklet";
    const maxX = Math.max(0, (tw * s - fw) / 2);
    const maxY = Math.max(0, (th * s - fh) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  };
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      start.value = { s: scale.value, x: ox.value, y: oy.value };
      runOnJS(setMoving)(true);
    })
    .onUpdate((e) => {
      const c = clamp(scale.value, start.value.x + e.translationX, start.value.y + e.translationY);
      ox.value = c.x;
      oy.value = c.y;
    })
    .onFinalize(() => runOnJS(setMoving)(false));
  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.value = { s: scale.value, x: ox.value, y: oy.value };
    })
    .onUpdate((e) => {
      const s = Math.min(minScale * 6, Math.max(minScale, start.value.s * e.scale));
      const ratio = s / start.value.s;
      const c = clamp(s, start.value.x * ratio, start.value.y * ratio);
      scale.value = s;
      ox.value = c.x;
      oy.value = c.y;
    });

  const photo = useAnimatedStyle(() => ({
    transform: [{ translateX: ox.value }, { translateY: oy.value }, { rotate: `${rotation}deg` }, { scale: scale.value }],
  }));

  async function done() {
    if (!size || !turned || !frame || saving) return;
    const s = scale.value;
    const rect = {
      x: Math.max(0, ((turned.w * s) / 2 - ox.value - frame.w / 2) / s / turned.w),
      y: Math.max(0, ((turned.h * s) / 2 - oy.value - frame.h / 2) / s / turned.h),
      width: Math.min(1, frame.w / s / turned.w),
      height: Math.min(1, frame.h / s / turned.h),
    };
    const whole = rotation === 0 && rect.width > 0.995 && rect.height > 0.995;
    if (whole) {
      onDone({ baseUri: item.originalUri, width: size.w, height: size.h, crop: null });
      return;
    }
    setSaving(true);
    try {
      const context = ImageManipulator.manipulate(item.originalUri);
      if (rotation) context.rotate(rotation);
      context.crop({
        originX: Math.round(rect.x * turned.w),
        originY: Math.round(rect.y * turned.h),
        width: Math.max(1, Math.min(turned.w - Math.round(rect.x * turned.w), Math.round(rect.width * turned.w))),
        height: Math.max(1, Math.min(turned.h - Math.round(rect.y * turned.h), Math.round(rect.height * turned.h))),
      });
      const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
      onDone({ baseUri: saved.uri, width: saved.width, height: saved.height, crop: { rotation, aspect, rect } });
    } catch (e) {
      alertWithHaptic("error", "Couldn't crop the photo", e instanceof Error ? e.message : "Please try again.");
      setSaving(false);
    }
  }

  const grid = useSharedValue(0);
  useEffect(() => {
    grid.value = withTiming(moving ? 1 : 0, { duration: 160 });
  }, [moving, grid]);
  const gridStyle = useAnimatedStyle(() => ({ opacity: grid.value }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]}>
      <View style={[styles.top, { paddingTop: insets.top, height: 56 + insets.top }]}>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" style={styles.topButton}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Crop
        </Text>
        <Pressable onPress={() => void done()} hitSlop={10} accessibilityRole="button" style={[styles.topButton, { alignItems: "flex-end" }]} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.done}>Done</Text>}
        </Pressable>
      </View>

      <View style={styles.middle} onLayout={(e) => setRoom({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {size && frame ? (
          <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
            <View style={[StyleSheet.absoluteFill, styles.center]} collapsable={false}>
              <Animated.View style={[{ width: size.w, height: size.h }, photo]}>
                <Image source={{ uri: item.originalUri }} style={StyleSheet.absoluteFill} contentFit="fill" />
              </Animated.View>
              {/* The dimmed photo around the frame, the frame, and its thirds while the photo moves. */}
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
                <View style={[styles.frame, { width: frame.w, height: frame.h, boxShadow: "0 0 0 2000px rgba(0,0,0,0.62)" }]}>
                  <Animated.View style={[StyleSheet.absoluteFill, gridStyle]}>
                    <View style={[styles.lineV, { left: "33.33%" }]} />
                    <View style={[styles.lineV, { left: "66.66%" }]} />
                    <View style={[styles.lineH, { top: "33.33%" }]} />
                    <View style={[styles.lineH, { top: "66.66%" }]} />
                  </Animated.View>
                </View>
              </View>
            </View>
          </GestureDetector>
        ) : (
          <ActivityIndicator color="#fff" />
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.aspects}>
          {ASPECTS.map((a) => {
            const on = a.value === aspect;
            return (
              <Pressable
                key={a.label}
                onPress={() => {
                  hapticSelect();
                  setAspect(a.value);
                }}
                style={[styles.aspect, on && styles.aspectOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.aspectText, on && styles.aspectTextOn]}>{a.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => {
            hapticSelect();
            setRotation((r) => (((r + 270) % 360) as CropSpec["rotation"]));
          }}
          style={({ pressed }) => [styles.rotate, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Turn left"
          hitSlop={8}
        >
          <Icon name="refresh-outline" sf="rotate.left" size={22} color="#fff" />
          <Text style={styles.rotateText}>Turn</Text>
        </Pressable>
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
  middle: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  center: { alignItems: "center", justifyContent: "center" },
  frame: { borderWidth: 1.5, borderColor: "#fff" },
  lineV: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.7)" },
  lineH: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.7)" },
  bottom: { paddingTop: 14, paddingHorizontal: 16, gap: 16, alignItems: "center" },
  aspects: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  aspect: { paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  aspectOn: { backgroundColor: "#fff" },
  aspectText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  aspectTextOn: { color: "#000" },
  rotate: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 36 },
  rotateText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
