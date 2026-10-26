import { Platform, StyleSheet, UIManager, View, type StyleProp, type ViewStyle } from "react-native";
import { MaskedView } from "@/components/masked-view";
import { BlurView } from "expo-blur";
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
 * A blur that grows from nothing at its top edge to full strength at the bottom, the way iOS frosts what passes under a
 * bar: the picture behind it softens gradually, with no line where the blur starts. Draw it over the picture and under
 * the words; `height` is how far up from the bottom it reaches. `shown` (0 to 1) fades it in and out.
 */
export function ProgressiveBlur({ height, intensity = 30, style, shown }: { height: number; intensity?: number; style?: StyleProp<ViewStyle>; shown?: Readonly<SharedValue<number>> | null }) {
  const fade = useAnimatedStyle(() => ({ opacity: shown ? shown.value : 1 }));
  if (!CAN_BLUR) return null;
  const band = (
    <MaskedView
      pointerEvents="none"
      style={FADE_MASK ? [styles.band, { height }, style] : StyleSheet.absoluteFill}
      maskElement={
        <View style={styles.maskHolder}>
          <Reanimated.View style={[styles.mask, FADE_MASK && fade]} />
        </View>
      }
    >
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
    </MaskedView>
  );
  if (FADE_MASK) return band;
  return (
    <Reanimated.View pointerEvents="none" style={[styles.band, { height }, style, fade]}>
      {band}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  band: { position: "absolute", left: 0, right: 0, bottom: 0 },
  maskHolder: { flex: 1 },
  // The mask's opacity is the blur's strength: none at the top, half way by the middle, all of it at the bottom, on an eased ramp.
  mask: {
    flex: 1,
    experimental_backgroundImage:
      "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 18%, rgba(0,0,0,0.38) 38%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.92) 80%, rgba(0,0,0,1) 100%)",
  },
});
