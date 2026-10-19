import { type ReactNode } from "react";
import { StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { SFSymbol } from "expo-symbols";
import { useReduceTransparency } from "@/lib/accessibility";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { useAppTheme } from "@/lib/theme-provider";
import { Icon, type IconName } from "./icon";
import { AnimatedPressable, usePressScale } from "./ui";

/** iOS 26 draws real Liquid Glass; older iOS and Android get the solid fill each variant names. */
export const LIQUID_GLASS = isLiquidGlassAvailable();

/**
 * Glass only where it does a job, as in Apple's guidance, never as decoration: `bar` is the navigation layer over the
 * app's own surfaces (regular glass on an all but opaque fill of the bar's colour, so what is on it stays readable), and
 * `media` is a control over photos and video (clear glass on a dark dimming layer, the same in both themes). Everything
 * else in the app is solid. Reduce Transparency, or no Liquid Glass, leaves the fill.
 */
export type GlassVariant = "bar" | "media";

/** The layers behind a glass control, absolutely filling its parent: put it first, then the control's content. */
export function GlassBackdrop({ variant = "bar", radius, interactive = false }: { variant?: GlassVariant; radius?: number; interactive?: boolean }) {
  const { colors, isDark } = useAppTheme();
  const reduce = useReduceTransparency();
  const glass = LIQUID_GLASS && !reduce;
  const fill: ColorValue = variant === "media" ? (reduce ? colors.mediaPill : colors.mediaControl) : reduce ? colors.bar : colors.glass;
  const shape: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, borderCurve: "continuous" };
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
 * A round floating icon button on glass: the Reels viewer's Back, a sound switch on a video, a cover's Back and menu.
 * It sinks under the finger, answers with a haptic, and its glass reacts to the touch on iOS 26. The icon is the text
 * colour on `bar` glass and white on `media` glass. `label` is what VoiceOver says.
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
  haptic = "tap",
  hitSlop = 6,
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
  /** "tap" for an action, "select" for a switch (sound on or off), false for navigation (Back). */
  haptic?: "tap" | "select" | false;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  /** Drawn over the icon, e.g. a count badge. */
  children?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const press = usePressScale(0.92, 0.9);
  const tint = iconColor ?? (variant === "bar" ? colors.text : colors.onMedia);
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
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", opacity: press.opacity, transform: [{ scale: press.scale }] },
        variant === "bar" && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassEdge },
        variant === "media" && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.mediaControlEdge },
        style,
      ]}
    >
      <GlassBackdrop variant={variant} radius={size / 2} interactive />
      <Icon name={icon} sf={sf} size={iconSize ?? Math.round(size * 0.5)} color={tint} weight="medium" />
      {children}
    </AnimatedPressable>
  );
}
