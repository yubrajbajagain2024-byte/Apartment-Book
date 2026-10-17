import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type LayoutRectangle, type StyleProp, type TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * The sliding underline is laid out this wide and scaled to each label: the native driver animates transforms but not
 * `width`, so scaleX = labelWidth / BASE_WIDTH puts it under label i as wide as the label, translateX = centre - BASE_WIDTH / 2.
 */
// Close to a typical label width, so the scaled bar keeps its rounded ends.
const BASE_WIDTH = 48;
/**
 * How far the labels follow the phone's text size: enough to read, not enough for three labels (Explore's Room | Roommate |
 * Marketplace, each centred in a third of the row) to overflow their tabs and clip, which would also leave the underline
 * narrower than its label.
 */
const MAX_FONT_SCALE = 1.2;

/** Where one label sits in the labels row: enough to put the underline under it, as wide as it is. */
type LabelBox = Pick<LayoutRectangle, "x" | "width">;

/**
 * A row of section labels with one underline that slides between them as a horizontal pager scrolls (Home's top bar,
 * the Explore tab), X (Twitter) style: the active label is bold, the underline is as wide as that label and sits on the
 * row's bottom edge, where the bar draws its hairline. `scrollX` is the pager's offset in points and `pageWidth` the
 * width of one page: page i puts the underline under label i, and each label fades between its active look (bold,
 * `labelColor`) and its resting look (`dimColor`) as the page under it comes and goes, so the whole row follows the
 * finger instead of jumping once a swipe settles. Both run on the native driver: nothing re-renders while the pager
 * moves. `section` decides what screen readers hear as selected (and the look until `pageWidth` is known). Fills its
 * parent (flex 1 + stretch) whatever the bar's height; `textStyle` is for extras like a text shadow over video.
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
  gap = 28,
  fontSize = 15,
  spread = false,
  caret,
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
  /** Space between the labels and their size. */
  gap?: number;
  fontSize?: number;
  /** X's layout: the labels share the row equally, each centred in its share, the underline still as wide as the label. */
  spread?: boolean;
  /** The section(s) whose label carries a small chevron: it opens a menu (Home's For you, both halves of Housing). */
  caret?: T | readonly T[];
}) {
  const [boxes, setBoxes] = useState<(LabelBox | undefined)[]>(() => sections.map(() => undefined));
  // Same array unless a label really moved, so the interpolation below is not rebuilt on every layout pass.
  const measure = (i: number, { x, width }: LayoutRectangle) => setBoxes((prev) => (prev[i]?.x === x && prev[i]?.width === width ? prev : prev.map((b, j) => (j === i ? { x, width } : b))));
  // Spread, a tab is wider than its label: the label's box is its own offset inside the tab plus the tab's place in the row.
  const tabX = useRef<number[]>([]);
  const labelBox = useRef<(LabelBox | undefined)[]>([]);
  const measureSpread = (i: number) => {
    const x = tabX.current[i];
    const b = labelBox.current[i];
    if (x !== undefined && b) measure(i, { x: x + b.x, width: b.width, y: 0, height: 0 });
  };

  // Page i (offset i * pageWidth) puts the underline under label i, scaled to its width. Only once every label is
  // measured and pageWidth > 0 (so the input range is strictly increasing); until then the static underline below stands in.
  const slide = useMemo(() => {
    if (pageWidth <= 0 || boxes.length !== sections.length) return null;
    const centres: number[] = [];
    const widths: number[] = [];
    for (const b of boxes) {
      if (!b || b.width <= 0) return null;
      centres.push(b.x + b.width / 2);
      widths.push(b.width);
    }
    const inputRange = centres.map((_, i) => i * pageWidth);
    return {
      translateX: scrollX.interpolate({ inputRange, outputRange: centres.map((c) => c - BASE_WIDTH / 2), extrapolate: "clamp" }),
      scaleX: scrollX.interpolate({ inputRange, outputRange: widths.map((w) => w / BASE_WIDTH), extrapolate: "clamp" }),
    };
  }, [boxes, pageWidth, scrollX, sections.length]);

  // Each label is drawn in both looks, one over the other, and the two crossfade with the pager: label i keeps its active
  // look within a quarter page of page i and its resting look from three quarters of a page away, crossfading over the
  // middle half of a swipe (where the haptic plays), so the two weights spend little time half-drawn over each other.
  // Only once pageWidth > 0 (strictly increasing input range).
  const count = sections.length;
  const fades = useMemo(() => {
    if (pageWidth <= 0) return null;
    return Array.from({ length: count }, (_, i) => {
      const inputRange = [i - 0.75, i - 0.25, i + 0.25, i + 0.75].map((p) => p * pageWidth);
      return {
        on: scrollX.interpolate({ inputRange, outputRange: [0, 1, 1, 0], extrapolate: "clamp" }),
        off: scrollX.interpolate({ inputRange, outputRange: [1, 0, 0, 1], extrapolate: "clamp" }),
      };
    });
  }, [count, pageWidth, scrollX]);

  return (
    <View style={[styles.labels, { gap: spread ? 0 : gap }]} accessibilityRole="tablist">
      {sections.map((s, i) => {
        const active = s.value === section;
        const fade = fades?.[i];
        return (
          <Pressable
            key={s.value}
            onPress={() => onSelect(s.value)}
            onLayout={(e) => {
              if (!spread) return measure(i, e.nativeEvent.layout);
              tabX.current[i] = e.nativeEvent.layout.x;
              measureSpread(i);
            }}
            hitSlop={6}
            accessibilityRole="tab"
            accessibilityLabel={s.label}
            accessibilityState={{ selected: active }}
            style={[styles.tab, spread && styles.spread]}
          >
            <View
              style={styles.labelBox}
              onLayout={
                spread
                  ? (e) => {
                      labelBox.current[i] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
                      measureSpread(i);
                    }
                  : undefined
              }
            >
              <View>
                {/* An invisible bold copy gives every label the width of its bold form: nothing shifts when the active one changes weight, and the underline fits it exactly. */}
                <Text style={[styles.label, { fontSize }, styles.bold, styles.ghost, textStyle]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} aria-hidden>
                  {s.label}
                </Text>
                {fade ? (
                  <>
                    <Animated.Text style={[styles.label, { fontSize }, styles.text, { color: dimColor }, textStyle, { opacity: fade.off }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>{s.label}</Animated.Text>
                    <Animated.Text style={[styles.label, { fontSize }, styles.text, styles.bold, { color: labelColor }, textStyle, { opacity: fade.on }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>{s.label}</Animated.Text>
                  </>
                ) : (
                  <Text style={[styles.label, { fontSize }, styles.text, { color: active ? labelColor : dimColor }, active && styles.bold, textStyle]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>{s.label}</Text>
                )}
              </View>
              {(Array.isArray(caret) ? (caret as readonly T[]).includes(s.value) : caret === s.value) ? <Ionicons name="chevron-down" size={14} color={active ? labelColor : dimColor} style={[styles.caret, textStyle]} /> : null}
            </View>
            {slide ? null : <View style={[styles.underline, styles.staticUnderline, { backgroundColor: active ? tint : "transparent" }]} />}
          </Pressable>
        );
      })}
      {slide ? <Animated.View pointerEvents="none" style={[styles.underline, styles.slidingUnderline, { backgroundColor: tint, transform: [{ translateX: slide.translateX }, { scaleX: slide.scaleX }] }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred labels; the gap and the size come in as props (28 and 15pt by default, Housing's bar).
  labels: { flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "stretch", justifyContent: "center" },
  // Stretched to the row's height so the underline sits on the row's bottom edge whatever the bar's height (44pt in Home and Housing).
  tab: { alignItems: "center", justifyContent: "center" },
  spread: { flex: 1 },
  // The label and, for one section, the chevron after it: what the underline is measured against.
  labelBox: { flexDirection: "row", alignItems: "center", gap: 1 },
  caret: { marginTop: 1 },
  label: { fontSize: 15, fontWeight: "600" },
  bold: { fontWeight: "800" },
  ghost: { opacity: 0 },
  text: { position: "absolute", top: 0, left: 0, right: 0, textAlign: "center" },
  // The same bottom edge for the static underline (spanning its label) and the sliding one (scaled to the label), so nothing jumps when one replaces the other.
  underline: { position: "absolute", bottom: 0, height: 3, borderRadius: 2 },
  staticUnderline: { left: 0, right: 0 },
  slidingUnderline: { left: 0, width: BASE_WIDTH },
});
