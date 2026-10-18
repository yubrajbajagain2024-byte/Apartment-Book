import { useCallback, useEffect, useMemo, useRef, type ReactNode, type Ref } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import Reanimated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { reduceMotionEnabled, useReduceMotion } from "@/lib/accessibility";
import { hapticSelect, hapticSoft } from "@/lib/haptics";
import { continuous, motion, radius, shadows, space, type } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

/**
 * The building blocks every screen is made of, in CampConnect's design system (see lib/theme.ts): ink buttons that sink
 * a touch under the finger, soft fields with a hairline when focused, hairline chips, quiet cards, a serif headline on
 * empty states, and skeletons that breathe while a feed loads. Colours come from the theme, so light and dark both hold.
 */

export function Screen({ children, scroll = false, padded = true, style }: { children: ReactNode; scroll?: boolean; padded?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const inner = <View style={[styles.screenInner, padded && { padding: space.lg }, style]}>{children}</View>;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

/** A Pressable whose style can carry animated values (the press sink): shared so no screen makes its own. */
export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The press feel every control shares: it sinks a touch on a soft spring while the finger is down, and rises back when
 * it lifts. Still under Reduce Motion.
 */
export function usePressScale(to: number = motion.pressScale) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => {
    if (!reduceMotionEnabled()) Animated.spring(scale, { toValue: to, ...motion.legacySpring }).start();
  };
  const onPressOut = () => {
    if (!reduceMotionEnabled()) Animated.spring(scale, { toValue: 1, ...motion.legacySpring }).start();
  };
  return { scale, onPressIn, onPressOut };
}

/**
 * Content arriving where a skeleton stood: a short fade in, once. Lists ask `useAppearOnce()` for each row's entering
 * animation, so a row fades in the first time it is drawn and never again (not when it is scrolled back into view).
 * Nothing moves under Reduce Motion.
 */
export function useAppearOnce() {
  const seen = useRef(new Set<string>());
  const reduce = useReduceMotion();
  return useCallback(
    (key: string) => {
      if (seen.current.has(key)) return undefined;
      seen.current.add(key);
      return reduce ? undefined : FadeIn.duration(motion.base);
    },
    [reduce],
  );
}

/**
 * A list's cell wrapper (pass it as CellRendererComponent): each row fades in the first time it is drawn (content
 * replacing the skeleton, the next page arriving) and never again, so scrolling back up does not flicker. One per list,
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

/** A view that fades in when it first mounts (see useAppearOnce for lists). */
export function Appear({ children, style, appear = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; appear?: boolean }) {
  const reduce = useReduceMotion();
  return (
    <Reanimated.View entering={appear && !reduce ? FadeIn.duration(motion.base) : undefined} style={style}>
      {children}
    </Reanimated.View>
  );
}

/**
 * Primary is ink (white ink in dark), secondary a hairline outline, ghost just the words, danger the one red fill.
 * `size="sm"` fits a row (Follow in a list). The whole button sinks slightly while pressed; disabled fades it. A
 * primary or danger button commits something, so it answers with the softest haptic; outline and ghost stay silent.
 */
export function Button({
  title,
  variant = "primary",
  size = "md",
  loading,
  icon,
  style,
  disabled,
  onPressIn,
  onPressOut,
  ...props
}: PressableProps & { title: string; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "sm"; loading?: boolean; icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle>; ref?: Ref<View> }) {
  const styles = useStyles();
  const colors = useColors();
  const press = usePressScale();
  const fill = variant === "primary" ? styles.primary : variant === "danger" ? styles.danger : variant === "secondary" ? styles.secondary : styles.ghost;
  const fg = variant === "primary" ? colors.onBrand : variant === "danger" ? colors.onMedia : colors.text;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPressIn={(e) => {
        press.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.onPressOut();
        onPressOut?.(e);
      }}
      style={[styles.button, size === "sm" && styles.buttonSmall, fill, { transform: [{ scale: press.scale }] }, disabled && styles.disabled, style]}
      {...props}
      onPress={(e) => {
        if (variant === "primary" || variant === "danger") hapticSoft();
        props.onPress?.(e);
      }}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} color={fg} /> : null}
      <Text style={[styles.buttonText, size === "sm" && styles.buttonTextSmall, { color: fg }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {title}
      </Text>
    </AnimatedPressable>
  );
}

/** A text field on a soft fill; a hairline in ink appears while it has focus, red while it carries an error. The label is an eyebrow. */
export function Field({ label, error, hint, style, multiline, onFocus, onBlur, ...props }: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const focus = useRef(new Animated.Value(0)).current;
  const borderColor = focus.interpolate({ inputRange: [0, 1], outputRange: [error ? colors.red : colors.border, error ? colors.red : colors.text] });
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Animated.View style={[styles.inputFrame, { borderColor }]}>
        <TextInput
          placeholderTextColor={colors.faint}
          keyboardAppearance={isDark ? "dark" : "light"}
          multiline={multiline}
          onFocus={(e) => {
            Animated.timing(focus, { toValue: 1, duration: motion.fast, useNativeDriver: false }).start();
            onFocus?.(e);
          }}
          onBlur={(e) => {
            Animated.timing(focus, { toValue: 0, duration: motion.fast, useNativeDriver: false }).start();
            onBlur?.(e);
          }}
          style={[styles.input, multiline && { minHeight: 104, paddingTop: 12, textAlignVertical: "top" }, style]}
          {...props}
        />
      </Animated.View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** A capsule filter: a hairline at rest, ink outline and a warm wash when selected. */
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
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.7 }]}
    >
      {icon ? <Icon name={icon} size={14} color={active ? colors.text : colors.muted} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A fact as a quiet hairline capsule ("Furnished", "Pets OK", an amenity): the words in grey, or in ink with `strong`
 * for the one that matters most. Not a button: a Chip is for choosing, a Badge for a status that needs its colour.
 */
export function Tag({ label, icon, strong }: { label: string; icon?: keyof typeof Ionicons.glyphMap; strong?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.tag, strong && styles.tagStrong]}>
      {icon ? <Icon name={icon} size={12} color={strong ? colors.text : colors.muted} /> : null}
      <Text style={[styles.tagText, strong && styles.tagTextStrong]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </View>
  );
}

/** A small status label: a soft tint behind quiet, slightly tracked text. */
export function Badge({ label, tone = "gray" }: { label: string; tone?: "gray" | "blue" | "green" | "amber" }) {
  const styles = useStyles();
  const colors = useColors();
  const bg = tone === "blue" ? colors.brandSoft : tone === "green" ? colors.successSoft : tone === "amber" ? colors.warningSoft : colors.input;
  const fg = tone === "blue" ? colors.text : tone === "green" ? colors.successText : tone === "amber" ? colors.warningText : colors.muted;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** A surface on the screen: a hairline edge, and in light the faintest lift. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A tracked small-caps label above a section, a stat or a form field. */
export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const styles = useStyles();
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

/** A serif section title with an optional quiet action on the right ("See all"). */
export function SectionTitle({ title, action, style }: { title: string; action?: { label: string; onPress: () => void }; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={[styles.sectionTitle, style]}>
      <Text style={styles.sectionTitleText} numberOfLines={1}>
        {title}
      </Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button">
          <Text style={styles.sectionAction}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A quiet spinner for a screen that is still loading; feeds prefer a skeleton (see FeedSkeleton). */
export function Loading({ label }: { label?: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.muted} size="small" />
      {label ? <Text style={styles.hint}>{label}</Text> : null}
    </View>
  );
}

/** A placeholder shape that breathes (a slow fade in and out) while what goes there loads. */
export function Skeleton({ width, height, round, style }: { width?: number | `${number}%`; height: number; round?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }), Animated.timing(pulse, { toValue: 0.55, duration: 900, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  return <Animated.View style={[styles.skeleton, { width: width ?? "100%", height, borderRadius: round ? height / 2 : radius.sm, opacity: pulse }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

/** The shape of a feed while it loads: a few posts drawn as grey shapes, so the page keeps its layout instead of a spinner. */
export function FeedSkeleton({ rows = 3, media = true }: { rows?: number; media?: boolean }) {
  return (
    <View accessibilityLabel="Loading" style={{ paddingTop: 8 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ paddingHorizontal: space.lg, paddingVertical: 12, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Skeleton width={40} height={40} round />
            <View style={{ flex: 1, gap: 7 }}>
              <Skeleton width="42%" height={12} />
              <Skeleton width="26%" height={10} />
            </View>
          </View>
          {media ? <Skeleton height={i === 1 ? 220 : 300} style={{ borderRadius: radius.lg, borderCurve: "continuous" }} /> : <Skeleton width="88%" height={12} />}
          <View style={{ flexDirection: "row", gap: 18 }}>
            <Skeleton width={24} height={24} round />
            <Skeleton width={24} height={24} round />
            <Skeleton width={24} height={24} round />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The shape of a list of rows (people, chats) while it loads. */
export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" style={{ paddingTop: 4 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.lg, paddingVertical: 11 }}>
          <Skeleton width={44} height={44} round />
          <View style={{ flex: 1, gap: 7 }}>
            <Skeleton width={i % 2 ? "48%" : "36%"} height={12} />
            <Skeleton width="62%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Nothing here yet: a thin-ringed mark, a serif headline, a quiet line of body, and whatever can be done about it. */
export function EmptyState({ icon = "search-outline", title, body, action }: { icon?: keyof typeof Ionicons.glyphMap; title: string; body?: string; action?: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.center, { padding: space.xl, gap: space.sm }]}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={24} color={colors.text} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={[styles.hint, styles.emptyBody]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.errorBanner}>
      <Text style={{ color: colors.dangerText, flex: 1, ...type.caption, fontSize: 14 }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: colors.dangerText, fontWeight: "700" }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

const useStyles = makeStyles((colors, scheme) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { flex: 1 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, paddingHorizontal: 20, borderRadius: radius.lg, ...continuous },
  buttonSmall: { minHeight: 34, paddingHorizontal: 14, borderRadius: radius.md, borderCurve: "continuous" },
  buttonText: { ...type.label, fontSize: 15, letterSpacing: 0.1 },
  buttonTextSmall: { fontSize: 13 },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.borderStrong },
  ghost: { backgroundColor: "transparent", paddingHorizontal: 12 },
  danger: { backgroundColor: colors.dangerFill },
  disabled: { opacity: 0.45 },
  label: { ...type.eyebrow, color: colors.muted, marginLeft: 2 },
  inputFrame: { backgroundColor: colors.input, borderRadius: radius.md, borderWidth: 1, ...continuous },
  input: { paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, lineHeight: 20, color: colors.text },
  error: { color: colors.red, ...type.footnote, marginLeft: 2 },
  hint: { color: colors.muted, ...type.caption },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: "transparent" },
  chipActive: { backgroundColor: colors.brandSoft, borderColor: colors.text },
  chipText: { ...type.label, fontSize: 13, color: colors.muted },
  chipTextActive: { color: colors.text },
  tag: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong },
  tagStrong: { borderColor: colors.text },
  tagText: { ...type.footnote, fontWeight: "600", color: colors.muted },
  tagTextStrong: { color: colors.text },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  // A hairline keeps the card apart from the screen in both themes; light adds the faintest lift.
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderCurve: "continuous", padding: space.lg, gap: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, shadowColor: colors.shadow, ...(scheme === "light" ? shadows.card : { elevation: 0 }) },
  eyebrow: { ...type.eyebrow, color: colors.muted },
  sectionTitle: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  sectionTitleText: { ...type.headline, color: colors.text, flexShrink: 1 },
  sectionAction: { ...type.label, fontSize: 13, color: colors.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.lg },
  skeleton: { backgroundColor: colors.skeleton },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { ...type.headline, color: colors.text, textAlign: "center" },
  emptyBody: { textAlign: "center", fontSize: 14, lineHeight: 20, maxWidth: 300 },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.dangerSoft, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.md, borderCurve: "continuous" },
}));
