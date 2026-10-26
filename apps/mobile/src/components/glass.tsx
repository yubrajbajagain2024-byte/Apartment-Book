import { type ReactNode } from "react";
import { Platform, StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { BlurView } from "expo-blur";
import { requireOptionalNativeModule } from "expo";
import type { SFSymbol } from "expo-symbols";
import { useReduceTransparency } from "@/lib/accessibility";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { useAppTheme } from "@/lib/theme-provider";
import { Icon, type IconName } from "./icon";
import { AnimatedPressable, usePressScale } from "./ui";

/** iOS 26 draws real Liquid Glass; older iOS and Android get the solid fill each variant names. */
export const LIQUID_GLASS = isLiquidGlassAvailable();

/** Whether this build carries expo-blur's native module (Expo Go and every build made since it was added do). */
const CAN_BLUR = (() => {
  try {
    return Platform.OS === "ios" && Boolean(requireOptionalNativeModule("ExpoBlur"));
  } catch {
    return false;
  }
})();

/**
 * Glass only where it does a job, as in Apple's guidance, never as decoration: `bar` is the navigation layer over the
 * app's own surfaces (regular glass on an all but opaque fill of the bar's colour, so what is on it stays readable),
 * `media` is a control over photos and video (clear glass on a dark dimming layer, the same in both themes), and
 * `float` is a chat's floating header pill and message bar, see-through so the messages scroll under them as under
 * the Messages app's: regular glass over a thin wash on iOS 26, a system blur over the same wash on older iOS, the
 * translucent bar fill on Android. Everything else in the app is solid. Reduce Transparency, or no Liquid Glass,
 * leaves a fill.
 */
export type GlassVariant = "bar" | "media" | "float";

/** The layers behind a glass control, absolutely filling its parent: put it first, then the control's content. */
export function GlassBackdrop({ variant = "bar", radius, interactive = false }: { variant?: GlassVariant; radius?: number; interactive?: boolean }) {
  const { colors, isDark } = useAppTheme();
  const reduce = useReduceTransparency();
  const glass = LIQUID_GLASS && !reduce;
  const shape: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, borderCurve: "continuous", overflow: "hidden" };
  if (variant === "float") {
    // See-through: a blur where the build has one (glass on iOS 26, the system material before it), a wash under it.
    const blur = !reduce && (glass || CAN_BLUR);
    return (
      <>
        <View pointerEvents="none" style={[shape, { backgroundColor: blur ? colors.floatFill : colors.glass }]} />
        {glass ? (
          <GlassView pointerEvents="none" style={shape} glassEffectStyle="regular" isInteractive={interactive} colorScheme={isDark ? "dark" : "light"} />
        ) : blur ? (
          <BlurView pointerEvents="none" style={shape} intensity={55} tint={isDark ? "systemThinMaterialDark" : "systemThinMaterialLight"} />
        ) : null}
      </>
    );
  }
  const fill: ColorValue = variant === "media" ? (reduce ? colors.mediaPill : colors.mediaControl) : reduce ? colors.bar : colors.glass;
  return (
    <>
      <View pointerEvents="none" style={[shape, { backgroundColor: fill }]} />
      {glass ? (
        <GlassView
          pointerEvents="none"
          style={shape}
          glassEffectStyle={variant === "media" ? "clear" : "regular"}
          isInteractive={interactive}
          colorScheme={variant === "media" ? "dark" : isDark ? "dark" : "light"}
        />
      ) : null}
    </>
  );
}

/**
 * A round floating icon button on glass: the Reels viewer's Back, a sound switch on a video, a cover's Back and menu,
 * a chat's Back, Search and Info. It sinks under the finger, answers with a haptic, and its glass reacts to the touch
 * on iOS 26. The icon is the text colour on `bar` and `float` glass and white on `media` glass. `label` is what
 * VoiceOver says.
 */
export function GlassIconButton({
  icon,
  sf,
  label,
  onPress,
  variant = "bar",
  size = 44,
  iconSize,
  iconColor,
  weight = "medium",
  haptic = "tap",
  hitSlop = 6,
  disabled,
  style,
  children,
}: {
  icon: IconName;
  sf?: SFSymbol;
  label: string;
  onPress: () => void;
  variant?: GlassVariant;
  size?: number;
  iconSize?: number;
  iconColor?: ColorValue;
  weight?: "regular" | "medium" | "semibold" | "bold";
  /** "tap" for an action, "select" for a switch (sound on or off), false for navigation (Back). */
  haptic?: "tap" | "select" | false;
  hitSlop?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Drawn over the icon, e.g. a count badge or a spinner in its place. */
  children?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const press = usePressScale(0.92, 0.9);
  const tint = iconColor ?? (variant === "media" ? colors.onMedia : colors.text);
  return (
    <AnimatedPressable
      onPress={() => {
        if (haptic === "tap") hapticTap();
        else if (haptic === "select") hapticSelect();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={hitSlop}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={[
        { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", opacity: press.opacity, transform: [{ scale: press.scale }] },
        variant !== "media" && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassEdge },
        variant === "media" && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.mediaControlEdge },
        style,
      ]}
    >
      <GlassBackdrop variant={variant} radius={size / 2} interactive />
      {children ?? <Icon name={icon} sf={sf} size={iconSize ?? Math.round(size * 0.5)} color={tint} weight={weight} />}
    </AnimatedPressable>
  );
}
