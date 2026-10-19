import { StyleSheet, UIManager, View, type StyleProp, type ViewStyle } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { requireOptionalNativeModule } from "expo";

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
 * A blur that grows from nothing at its top edge to full strength at the bottom, the way iOS frosts what passes under a
 * bar: the picture behind it softens gradually, with no line where the blur starts. Draw it over the picture and under
 * the words; `height` is how far up from the bottom it reaches.
 */
export function ProgressiveBlur({ height, intensity = 30, style }: { height: number; intensity?: number; style?: StyleProp<ViewStyle> }) {
  if (!CAN_BLUR) return null;
  return (
    <MaskedView pointerEvents="none" style={[styles.band, { height }, style]} maskElement={<View style={styles.mask} />}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  band: { position: "absolute", left: 0, right: 0, bottom: 0 },
  // The mask's opacity is the blur's strength: none at the top, half way by the middle, all of it at the bottom, on an eased ramp.
  mask: {
    flex: 1,
    experimental_backgroundImage:
      "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 18%, rgba(0,0,0,0.38) 38%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.92) 80%, rgba(0,0,0,1) 100%)",
  },
});
