import { useMemo, useRef, type ReactNode, type Ref } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import Reanimated, { FadeIn } from "react-native-reanimated";
import type { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { reduceMotionEnabled, useReduceMotion } from "@/lib/accessibility";
import { motion, radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import { hapticSelect, hapticSoft } from "@/lib/haptics";
import { Icon } from "@/components/icon";

export function Screen({ children, scroll = false, padded = true, style }: { children: ReactNode; scroll?: boolean; padded?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const inner = <View style={[styles.screenInner, padded && { padding: space.lg }, style]}>{children}</View>;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

/** A Pressable whose style can carry animated values (the press response). */
export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The instant response every control shares, as on iOS: while the finger is down it sinks a touch and dims on a quick
 * spring (`dimTo` 1 keeps it fully opaque), and it rises back the moment the finger lifts. Still under Reduce Motion,
 * where only the dim remains.
 */
export function usePressScale(to: number = motion.pressScale, dimTo = 0.85) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const onPressIn = () => {
    if (!reduceMotionEnabled()) Animated.spring(scale, { toValue: to, ...motion.legacySpring }).start();
    Animated.timing(opacity, { toValue: dimTo, duration: 80, useNativeDriver: true }).start();
  };
  const onPressOut = () => {
    if (!reduceMotionEnabled()) Animated.spring(scale, { toValue: 1, ...motion.legacySpring }).start();
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  };
  return { scale, opacity, onPressIn, onPressOut };
}

/**
 * A list's cell wrapper (pass it as CellRendererComponent): each row fades in the first time it is drawn (content
 * replacing the spinner, the next page arriving) and never again, so scrolling back up does not flicker. One per list,
 * stable for its life. Nothing moves under Reduce Motion.
 */
export function useAppearingCells() {
  const reduce = useReduceMotion();
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  return useMemo(() => {
    const seen = new Set<string>();
    return function AppearingCell({ children, cellKey, style, onLayout }: { children?: ReactNode; cellKey: string; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void }) {
      const first = useRef<boolean | null>(null);
      if (first.current === null) {
        first.current = !seen.has(cellKey);
        seen.add(cellKey);
      }
      return (
        <Reanimated.View entering={first.current && !reduceRef.current ? FadeIn.duration(motion.base) : undefined} style={style} onLayout={onLayout}>
          {children}
        </Reanimated.View>
      );
    };
  }, []);
}

/**
 * The app's one button, an iOS 26 capsule in every size: `regular` (44pt, the minimum touch target) for most actions,
 * `compact` (34pt) inside list rows, `large` (50pt) for the full-width action that ends a form or a sheet. Primary is
 * the brand fill, secondary the quiet grey fill, ghost brand-coloured words, danger the red fill.
 */
export function Button({
  title,
  variant = "primary",
  size = "regular",
  loading,
  icon,
  style,
  disabled,
  ...props
}: PressableProps & { title: string; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "compact" | "regular" | "large"; loading?: boolean; icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle>; ref?: Ref<View> }) {
  const styles = useStyles();
  const colors = useColors();
  const bg = variant === "primary" ? colors.brand : variant === "danger" ? colors.dangerFill : variant === "secondary" ? colors.border : "transparent";
  const fg = variant === "primary" || variant === "danger" ? colors.onBrand : variant === "ghost" ? colors.brand : colors.text;
  // The same dim as before while pressed, now with the sink of a native button.
  const press = usePressScale();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={[styles.button, size === "compact" ? styles.buttonCompact : size === "large" ? styles.buttonLarge : null, { backgroundColor: bg, opacity: disabled ? 0.5 : press.opacity, transform: [{ scale: press.scale }] }, style]}
      {...props}
      onPressIn={(e) => {
        press.onPressIn();
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.onPressOut();
        props.onPressOut?.(e);
      }}
      onPress={(e) => {
        // A primary or danger button commits something: the softest haptic. Secondary and ghost stay silent.
        if (variant === "primary" || variant === "danger") hapticSoft();
        props.onPress?.(e);
      }}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={size === "compact" ? 16 : 18} weight="semibold" color={fg} /> : null}
      <Text style={[styles.buttonText, size === "compact" ? styles.buttonTextCompact : size === "large" ? styles.buttonTextLarge : null, { color: fg }]} numberOfLines={1}>
        {title}
      </Text>
    </AnimatedPressable>
  );
}

export function Field({ label, error, hint, style, multiline, ...props }: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.faint}
        keyboardAppearance={isDark ? "dark" : "light"}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 96, textAlignVertical: "top" }, error ? { borderColor: colors.red } : null, style]}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }} style={({ pressed }) => [styles.chip, active && { backgroundColor: colors.brandSoft, borderColor: colors.brand }, pressed && { opacity: 0.7 }]}>
      {icon ? <Icon name={icon} size={14} color={active ? colors.brand : colors.muted} /> : null}
      <Text style={[styles.chipText, active && { color: colors.brand }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = "gray" }: { label: string; tone?: "gray" | "blue" | "green" | "amber" }) {
  const styles = useStyles();
  const colors = useColors();
  const bg = tone === "blue" ? colors.brandSoft : tone === "green" ? colors.successSoft : tone === "amber" ? colors.warningSoft : colors.border;
  const fg = tone === "blue" ? colors.brand : tone === "green" ? colors.successText : tone === "amber" ? colors.warningText : colors.muted;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brand} size="large" />
      {label ? <Text style={styles.hint}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon = "search-outline", title, body, action }: { icon?: keyof typeof Ionicons.glyphMap; title: string; body?: string; action?: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.center, { padding: space.xl, gap: space.sm }]}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={28} color={colors.brand} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" }}>{title}</Text>
      {body ? <Text style={[styles.hint, { textAlign: "center" }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.errorBanner}>
      <Text style={{ color: colors.dangerText, flex: 1 }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry}>
          <Text style={{ color: colors.dangerText, fontWeight: "700" }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { flex: 1 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, paddingHorizontal: 20, borderRadius: radius.pill },
  buttonCompact: { minHeight: 34, paddingHorizontal: 14, gap: 5 },
  buttonLarge: { minHeight: 50, paddingHorizontal: 24 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  buttonTextCompact: { fontSize: 14 },
  buttonTextLarge: { fontSize: 17 },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderCurve: "continuous", paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  error: { color: colors.red, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 13 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  // The hairline outline keeps a card apart from the screen in both themes: white on white in light, dark grey on black in dark.
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderCurve: "continuous", padding: space.lg, gap: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.lg },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.dangerSoft, padding: 12, borderRadius: radius.md, borderCurve: "continuous" },
}));
