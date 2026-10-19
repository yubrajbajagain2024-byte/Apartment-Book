import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { reduceMotionEnabled } from "@/lib/accessibility";
import { auroraGradient, motion, radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { hapticSelect } from "@/lib/haptics";
import { Icon } from "@/components/icon";

const SEGMENT_PAD = 3;

/**
 * A segmented control, the brand-blue selection under the chosen option as before, now springing from option to option
 * as UIKit's thumb does (instantly under Reduce Motion), with a selection tick. Screen readers hear radio buttons.
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
      {segment > 0 && index >= 0 ? <Animated.View pointerEvents="none" style={[styles.segmentThumb, { width: segment }, thumb]} /> : null}
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => {
            if (value !== o.value) hapticSelect();
            onChange(o.value);
          }}
          // Before the track is measured the selection is drawn in place, as before.
          style={[styles.segmentItem, segment <= 0 && value === o.value && styles.segmentActive]}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === o.value }}
        >
          <Text style={[styles.segmentText, value === o.value && { color: colors.onBrand }]}>{o.label}</Text>
        </Pressable>
      ))}
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
  segment: { flexDirection: "row", backgroundColor: colors.input, borderRadius: radius.md, borderCurve: "continuous", padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: radius.sm, borderCurve: "continuous" },
  segmentActive: { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora) },
  // The selection that slides: the same brand-blue fill and corners as the active segment it replaces.
  // The selected segment wears the aurora, under white words.
  segmentThumb: { position: "absolute", top: SEGMENT_PAD, bottom: SEGMENT_PAD, left: SEGMENT_PAD, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora) },
  segmentText: { fontWeight: "700", color: colors.muted, fontSize: 13 },
  // Outlined like Card, so a section still stands apart from the screen in both themes.
  section: { backgroundColor: colors.card, borderRadius: radius.lg, borderCurve: "continuous", padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
}));
