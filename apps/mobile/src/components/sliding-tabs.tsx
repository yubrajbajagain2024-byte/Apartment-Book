import { useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type LayoutRectangle, type StyleProp, type TextStyle } from "react-native";

const UNDERLINE_WIDTH = 24;

/** Where one label sits in the labels row: enough to put the underline under its middle. */
type LabelBox = Pick<LayoutRectangle, "x" | "width">;

/**
 * A row of section labels with one underline that slides between them as a horizontal pager scrolls (Home's top bar,
 * the Housing tab). `scrollX` is the pager's offset in points and `pageWidth` the width of one page: page i puts the
 * underline under the middle of label i, so it follows the finger instead of jumping once a swipe settles. The label
 * colours still snap with `section`. Fills its parent (flex 1 + stretch) so the underline sits 7 points above the
 * parent's bottom edge whatever the bar's height; `textStyle` is for extras like a text shadow over video.
 */
export function SlidingTabs<T extends string>({
  sections,
  section,
  onSelect,
  scrollX,
  pageWidth,
  tint,
  labelColor,
  dimColor,
  textStyle,
}: {
  sections: readonly { value: T; label: string }[];
  section: T;
  onSelect: (s: T) => void;
  scrollX: Animated.Value;
  pageWidth: number;
  tint: string;
  labelColor: string;
  dimColor: string;
  textStyle?: StyleProp<TextStyle>;
}) {
  const [boxes, setBoxes] = useState<(LabelBox | undefined)[]>(() => sections.map(() => undefined));
  // Same array unless a label really moved, so the interpolation below is not rebuilt on every layout pass.
  const measure = (i: number, { x, width }: LayoutRectangle) => setBoxes((prev) => (prev[i]?.x === x && prev[i]?.width === width ? prev : prev.map((b, j) => (j === i ? { x, width } : b))));

  // Page i (offset i * pageWidth) puts the underline under the middle of label i. Only once every label is measured and
  // pageWidth > 0 (so the input range is strictly increasing); until then the static underline below stands in.
  const slide = useMemo(() => {
    if (pageWidth <= 0 || boxes.length !== sections.length) return null;
    const centres: number[] = [];
    for (const b of boxes) {
      if (!b) return null;
      centres.push(b.x + b.width / 2);
    }
    return scrollX.interpolate({ inputRange: centres.map((_, i) => i * pageWidth), outputRange: centres.map((c) => c - UNDERLINE_WIDTH / 2), extrapolate: "clamp" });
  }, [boxes, pageWidth, scrollX, sections.length]);

  return (
    <View style={styles.labels} accessibilityRole="tablist">
      {sections.map((s, i) => {
        const active = s.value === section;
        return (
          <Pressable key={s.value} onPress={() => onSelect(s.value)} onLayout={(e) => measure(i, e.nativeEvent.layout)} hitSlop={6} accessibilityRole="tab" accessibilityLabel={s.label} accessibilityState={{ selected: active }} style={styles.tab}>
            <Text style={[styles.label, { color: active ? labelColor : dimColor }, active && { fontWeight: "800" }, textStyle]}>{s.label}</Text>
            {slide ? null : <View style={[styles.underline, { backgroundColor: active ? tint : "transparent" }]} />}
          </Pressable>
        );
      })}
      {slide ? <Animated.View pointerEvents="none" style={[styles.underline, { left: 0, backgroundColor: tint, transform: [{ translateX: slide }] }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 18 between four labels at 15pt leaves room on a 375pt phone between Home's two 40pt side slots ("+" and the Search magnifier).
  labels: { flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "stretch", justifyContent: "center", gap: 18 },
  // Stretched to the row's height so the underline below lands at the same place in a 48pt bar (Home) and a 44pt one (Housing).
  tab: { alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "600" },
  // The same bottom offset for the static underline (centred in its label) and the sliding one (at x = 0 + translateX), so nothing jumps.
  underline: { position: "absolute", bottom: 7, width: UNDERLINE_WIDTH, height: 3, borderRadius: 2 },
});
