import { Platform, StyleSheet, UIManager, View, type StyleProp, type ViewStyle } from "react-native";
import { MaskedView } from "@/components/masked-view";
import { BlurView, type BlurTint } from "expo-blur";
import { requireOptionalNativeModule } from "expo";
import Reanimated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

/**
 * Whether this build carries the native blur and mask views. Expo Go and every build made since they were added do; an
 * older installed build reading this code over the air does not, and then the page keeps its dark gradient alone.
 */
const CAN_BLUR = (() => {
  try {
    return Boolean(requireOptionalNativeModule("ExpoBlur")) && Boolean(UIManager.hasViewManagerConfig?.("RNCMaskedView"));
  } catch {
    return false;
  }
})();

/**
 * How `shown` fades the band. iOS: through its mask, so the blur itself is never made see-through (iOS does not draw a
 * see-through blur properly). Android: the whole band, its mask left alone, since the masked view there redraws its mask
 * into a new bitmap every time the mask changes (and the blur is a plain tint there, which fades fine).
 */
const FADE_MASK = Platform.OS === "ios";

/**
 * The mask's opacity is the blur's strength, on an eased ramp from the band's open edge (0) to the screen's edge (1):
 * none, half way by the middle, all of it at the edge. Drawn as a stack of strips rather than a gradient: a CSS
 * gradient background does not render inside a mask on iOS (the mask comes out empty and nothing blurs), while plain
 * fills do; the blur hides the steps.
 */
const RAMP: readonly [number, number][] = [
  [0, 0],
  [0.18, 0.12],
  [0.38, 0.38],
  [0.6, 0.7],
  [0.8, 0.92],
  [1, 1],
];
const STEPS = 28;

function rampAt(t: number): number {
  for (let i = 1; i < RAMP.length; i++) {
    const [x0, y0] = RAMP[i - 1];
    const [x1, y1] = RAMP[i];
    if (t <= x1) return y0 + ((t - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

/** The strips, first to last down the screen: the ramp runs up to a top band and down to a bottom one. */
function stripsFor(edge: "top" | "bottom"): string[] {
  return Array.from({ length: STEPS }, (_, i) => {
    const centre = (i + 0.5) / STEPS;
    const t = edge === "bottom" ? centre : 1 - centre;
    return `rgba(0,0,0,${rampAt(t).toFixed(3)})`;
  });
}
const STRIPS = { top: stripsFor("top"), bottom: stripsFor("bottom") };

/**
 * A blur that grows from nothing at its open edge to full strength at the screen's edge, the way iOS frosts what passes
 * under a bar: the picture behind it softens gradually, with no line where the blur starts. Draw it over the content and
 * under the words; `height` is how far it reaches in from that edge. `edge` is which edge it belongs to (the bottom,
 * as under a reel's caption, or the top, as under a chat's floating header); `tint` the blur's look (dark over video,
 * the theme's over a page). `shown` (0 to 1) fades it in and out.
 */
export function ProgressiveBlur({
  height,
  intensity = 30,
  edge = "bottom",
  tint = "dark",
  style,
  shown,
}: {
  height: number;
  intensity?: number;
  edge?: "top" | "bottom";
  tint?: BlurTint;
  style?: StyleProp<ViewStyle>;
  shown?: Readonly<SharedValue<number>> | null;
}) {
  const fade = useAnimatedStyle(() => ({ opacity: shown ? shown.value : 1 }));
  if (!CAN_BLUR) return null;
  const place: ViewStyle = edge === "top" ? { top: 0 } : { bottom: 0 };
  const band = (
    <MaskedView
      pointerEvents="none"
      style={FADE_MASK ? [styles.band, place, { height }, style] : StyleSheet.absoluteFill}
      maskElement={
        <Reanimated.View style={[styles.mask, FADE_MASK && fade]}>
          {STRIPS[edge].map((color, i) => (
            <View key={i} style={[styles.strip, { backgroundColor: color }]} />
          ))}
        </Reanimated.View>
      }
    >
      <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
    </MaskedView>
  );
  if (FADE_MASK) return band;
  return (
    <Reanimated.View pointerEvents="none" style={[styles.band, place, { height }, style, fade]}>
      {band}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  band: { position: "absolute", left: 0, right: 0 },
  mask: { flex: 1, flexDirection: "column" },
  strip: { flex: 1 },
});
