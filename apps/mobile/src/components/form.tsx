import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { reduceMotionEnabled } from "@/lib/accessibility";
import { hapticSelect } from "@/lib/haptics";
import { motion, radius, type } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

const SEGMENT_PAD = 3;

/**
 * iOS's segmented control: a raised card thumb that springs under the chosen option on a soft track, the chosen label
 * in ink, the rest in grey, a selection tick as it moves. No option chosen yet: no thumb. Screen readers hear radio
 * buttons, as before.
 */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | undefined; onChange: (v: T) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const index = options.findIndex((o) => o.value === value);
  const segment = width > 0 ? (width - 2 * SEGMENT_PAD) / options.length : 0;
  const x = useSharedValue(Math.max(0, index) * segment);
  useEffect(() => {
    if (segment <= 0 || index < 0) return;
    x.value = reduceMotionEnabled() ? index * segment : withSpring(index * segment, motion.snappy);
  }, [index, segment, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={styles.segment} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {segment > 0 && index >= 0 ? <Animated.View pointerEvents="none" style={[styles.thumb, { width: segment }, thumb]} /> : null}
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (!on) hapticSelect();
              onChange(o.value);
            }}
            style={styles.segmentItem}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
          >
            <Text style={[styles.segmentText, on && { color: colors.text, fontWeight: "600" }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
      <Icon name={value ? "checkbox" : "square-outline"} size={22} color={value ? colors.brand : colors.muted} />
      <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  segment: { flexDirection: "row", backgroundColor: colors.input, borderRadius: radius.md, borderCurve: "continuous", padding: SEGMENT_PAD, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  // The thumb: a card raised a hair off the track, as UIKit's segmented control draws it (a hairline instead of a shadow in dark).
  thumb: { position: "absolute", top: SEGMENT_PAD, bottom: SEGMENT_PAD, left: SEGMENT_PAD, borderRadius: radius.md - SEGMENT_PAD, borderCurve: "continuous", backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, shadowColor: colors.shadow, shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  segmentItem: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, alignItems: "center" },
  segmentText: { ...type.label, fontSize: 13, fontWeight: "500", color: colors.muted },
  // Outlined like Card, so a section still stands apart from the screen in both themes.
  section: { backgroundColor: colors.card, borderRadius: radius.lg, borderCurve: "continuous", padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  sectionTitle: { ...type.heading, fontSize: 16, color: colors.text },
}));
