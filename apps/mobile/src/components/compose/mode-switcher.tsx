import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useReduceMotion } from "@/lib/accessibility";
import { motion } from "@/lib/theme";

/**
 * A row of words under the camera, TikTok's CAMERA | CREATE | LIVE: the chosen one sits in the middle of the screen in
 * white, the others grey beside it, and choosing another glides the row across so it comes to the middle (no bounce,
 * no haptic: it is a switch of place, see no-navigation-haptics). Used for the capture lengths above the shutter
 * (`size="small"`). With `slide` false the row stays put in the middle and a dot glides under the choice instead: the
 * camera's POST | REEL | SNAP, which would otherwise run off the screen's edge beside the Upload and Drafts buttons.
 */
export function ModeSwitcher<T extends string>({ options, value, onChange, disabled, size = "large", pill = false, slide = true }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; disabled?: boolean; size?: "large" | "small"; pill?: boolean; slide?: boolean }) {
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const [spots, setSpots] = useState<Record<string, { x: number; w: number }>>({});
  const shift = useSharedValue(0);
  // The first placement is instant: the row appears with the choice already in the middle.
  const placed = useRef(false);
  const ready = width > 0 && options.every((o) => spots[o.value]);

  useEffect(() => {
    if (!ready) return;
    const spot = spots[value];
    // Sliding, the row moves so the choice is in the middle; still, the dot moves under the choice.
    const target = slide ? width / 2 - (spot.x + spot.w / 2) : spot.x + spot.w / 2 - DOT / 2;
    shift.value = reduce || !placed.current ? target : withSpring(target, motion.sheet);
    placed.current = true;
  }, [ready, spots, value, width, reduce, shift, slide]);

  const row = useAnimatedStyle(() => ({ transform: [{ translateX: slide ? shift.value : 0 }] }));
  const dot = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));
  const measure = (key: T) => (e: LayoutChangeEvent) => {
    const { x, width: w } = e.nativeEvent.layout;
    setSpots((s) => (s[key]?.x === x && s[key]?.w === w ? s : { ...s, [key]: { x, w } }));
  };

  return (
    <View style={styles.frame} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      <Animated.View style={[styles.row, size === "small" && styles.rowSmall, !slide && styles.rowStill, row, { opacity: ready ? (disabled ? 0.45 : 1) : 0 }]}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onLayout={measure(o.value)}
              onPress={() => onChange(o.value)}
              disabled={disabled}
              hitSlop={8}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, disabled }}
              accessibilityLabel={o.label}
              style={[size === "small" ? styles.itemSmall : styles.item, pill && on && styles.pillOn]}
            >
              <Text style={[size === "small" ? styles.labelSmall : styles.label, on ? (pill ? styles.labelPillOn : styles.labelOn) : null]}>{o.label}</Text>
            </Pressable>
          );
        })}
        {slide ? null : <Animated.View pointerEvents="none" style={[styles.dot, dot]} />}
      </Animated.View>
    </View>
  );
}

const DOT = 5;

const shadow = { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

const styles = StyleSheet.create({
  frame: { alignSelf: "stretch", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 26 },
  rowStill: { alignSelf: "center", gap: 22 },
  dot: { position: "absolute", left: 0, bottom: 1, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: "#ffffff" },
  rowSmall: { gap: 6 },
  item: { paddingVertical: 8 },
  itemSmall: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  pillOn: { backgroundColor: "rgba(255,255,255,0.95)" },
  label: { fontSize: 15, fontWeight: "700", letterSpacing: 0.6, color: "rgba(255,255,255,0.5)" },
  labelOn: { color: "#ffffff" },
  labelSmall: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.92)", ...shadow },
  labelPillOn: { color: "#000000", textShadowRadius: 0, textShadowColor: "transparent" },
});
