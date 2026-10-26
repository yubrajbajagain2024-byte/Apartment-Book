import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ColorValue, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Reanimated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/icon";
import { AnimatedPressable, usePressScale } from "@/components/ui";
import { useReduceMotion } from "@/lib/accessibility";
import { hapticSelect, hapticSoft } from "@/lib/haptics";
import { phosphor as P } from "@/lib/palette";
import { motion } from "@/lib/theme";

/*
 * The Buzz kit: UniVerse's UI pieces (Button, IconButton, SegmentedControl, Chip, Badge, OpBadge, EmptyState,
 * ErrorState, Skeleton, PageHeader) painted with Phosphor only. Buzz is always this dark world, in Light and Dark
 * alike, so these take no theme: every colour comes from `phosphor` (lib/palette.ts). Type follows UniVerse's scale on
 * the system font.
 */

export { P };

/** UniVerse's type scale (type-title-3, type-body-lg, type-label-sm …) on the system font. */
export const T = {
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  title3: { fontSize: 19, lineHeight: 24, fontWeight: "700" },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  bodyLg: { fontSize: 17, lineHeight: 25 },
  body: { fontSize: 15, lineHeight: 21 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
  label: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  labelSm: { fontSize: 13, lineHeight: 17, fontWeight: "600" },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: "600", letterSpacing: 0.9, textTransform: "uppercase" },
} as const satisfies Record<string, TextStyle>;

/** UniVerse's radii. */
export const R = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** The side gutter of every Buzz screen. */
export const GUTTER = 16;

/** "#c5f53b" at `alpha` as rgba(…): the alias tint behind an AliasAvatar. Anything that is not a 6-digit hex passes through. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** The Phosphor hero gradient (the FAB, "Buzz it"), as a CSS gradient for `experimental_backgroundImage`. */
export const HERO_GRADIENT = `linear-gradient(135deg, ${P.gradient[0]} 0%, ${P.gradient[1]} 52%, ${P.gradient[2]} 100%)`;
/** The soft gradient behind the "You're anonymous" banner and the prompt card. */
export const HERO_SOFT_GRADIENT = `linear-gradient(135deg, ${P.gradientSoft[0]}, ${P.gradientSoft[1]})`;

/* ───────────────────────────── the mask ───────────────────────────── */

/**
 * The mask that marks everything anonymous (UniVerse's VenetianMask): the Buzz label, the FAB's badge, the composer
 * banner, Buzz notifications. A domino mask on every platform (SF Symbols has none).
 */
export function MaskGlyph({ size = 16, color = P.accentInk, style }: { size?: number; color?: ColorValue; style?: StyleProp<TextStyle> }) {
  return <MaterialCommunityIcons name="domino-mask" size={size} color={color as string} style={style} accessibilityElementsHidden importantForAccessibility="no" />;
}

/** The mask in a soft lime disc (the gate's header, the composer banner, the anonymity card). */
export function MaskDisc({ size = 36, glyph = Math.round(size * 0.5) }: { size?: number; glyph?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: P.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <MaskGlyph size={glyph} />
    </View>
  );
}

/* ───────────────────────────── buttons ───────────────────────────── */

export type PButtonVariant = "primary" | "secondary" | "ghost" | "hero" | "danger";

const BUTTON_HEIGHT = { sm: 36, md: 44, lg: 52 } as const;

/**
 * UniVerse's Button: `primary` lime with dark ink, `secondary` the raised surface with a hairline, `ghost` bare words,
 * `hero` the Phosphor gradient ("Buzz it"), `danger` coral. It sinks under the finger like every control in the app,
 * and the primary kinds answer with the softest haptic.
 */
export function PButton({
  title,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  iconNode,
  loading,
  disabled,
  fullWidth,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: PButtonVariant;
  size?: keyof typeof BUTTON_HEIGHT;
  icon?: IconName;
  iconNode?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const press = usePressScale();
  const off = disabled || loading;
  const fg = variant === "primary" || variant === "hero" ? P.onAccent : variant === "danger" ? "#ffffff" : variant === "ghost" ? P.ink2 : P.ink;
  const fill: ViewStyle =
    variant === "primary"
      ? { backgroundColor: P.accent }
      : variant === "hero"
        ? { backgroundColor: P.accent, experimental_backgroundImage: HERO_GRADIENT }
        : variant === "danger"
          ? { backgroundColor: "#d5383e" }
          : variant === "secondary"
            ? { backgroundColor: P.surface3, borderWidth: StyleSheet.hairlineWidth, borderColor: P.lineStrong }
            : { backgroundColor: "transparent" };
  return (
    <AnimatedPressable
      onPress={() => {
        if (variant === "primary" || variant === "hero" || variant === "danger") hapticSoft();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      style={[
        styles.button,
        { minHeight: BUTTON_HEIGHT[size], paddingHorizontal: size === "sm" ? 14 : size === "lg" ? 24 : 18 },
        fill,
        fullWidth && styles.fullWidth,
        { opacity: disabled ? 0.45 : press.opacity, transform: [{ scale: press.scale }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : iconNode ? iconNode : icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} weight="semibold" color={fg} /> : null}
      <Text style={[size === "sm" ? T.labelSm : T.label, size === "lg" && styles.labelLg, { color: fg }]} numberOfLines={1}>
        {title}
      </Text>
    </AnimatedPressable>
  );
}

/** A round icon button: `plain` (ink on nothing, a soft fill while pressed), `filled` (a raised disc), `accent` (lime). */
export function PIconButton({
  icon,
  label,
  onPress,
  size = 40,
  iconSize,
  variant = "plain",
  color,
  disabled,
  hint,
  node,
  style,
  hitSlop = 6,
}: {
  icon?: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  iconSize?: number;
  variant?: "plain" | "filled" | "accent";
  color?: ColorValue;
  disabled?: boolean;
  hint?: string;
  /** Draw this instead of `icon` (a MaterialCommunityIcons glyph). */
  node?: ReactNode;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
}) {
  const tint = color ?? (variant === "accent" ? P.onAccent : P.ink2);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" },
        variant === "filled" && { backgroundColor: P.surface3 },
        variant === "accent" && { backgroundColor: P.accent },
        pressed && variant === "plain" && { backgroundColor: P.surface3 },
        pressed && variant !== "plain" && { opacity: 0.8 },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {node ?? (icon ? <Icon name={icon} size={iconSize ?? Math.round(size * 0.5)} color={tint} weight="medium" /> : null)}
    </Pressable>
  );
}

/* ───────────────────────────── segmented control ───────────────────────────── */

export type SegmentOption<T extends string> = { value: T; label: string; icon?: IconName };

/**
 * UniVerse's SegmentedControl: 2–4 mutually exclusive views of the same data (Hot | New | Top, Campus | Global) in a
 * pill, the chosen one on a raised thumb that slides there on a snappy spring (still under Reduce Motion). Screen
 * readers hear a group of radio buttons.
 */
export function Segmented<T extends string>({ value, options, onChange, label, size = "sm", fullWidth, style }: { value: T; options: readonly SegmentOption<T>[]; onChange: (value: T) => void; label: string; size?: "sm" | "md"; fullWidth?: boolean; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const [boxes, setBoxes] = useState<Record<string, { x: number; width: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  const box = boxes[value];
  useEffect(() => {
    if (!box) return;
    if (!placed.current || reduce) {
      x.value = box.x;
      w.value = box.width;
      placed.current = true;
      return;
    }
    x.value = withSpring(box.x, motion.snappy);
    w.value = withSpring(box.width, motion.snappy);
  }, [box, reduce, x, w]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: w.value, opacity: w.value > 0 ? 1 : 0 }));
  const height = size === "sm" ? 36 : 44;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segmented, { height }, fullWidth && styles.fullWidth, style]}>
      <Reanimated.View pointerEvents="none" style={[styles.thumb, thumb]} />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onLayout={(e: LayoutChangeEvent) => {
              const { x: ox, width } = e.nativeEvent.layout;
              setBoxes((prev) => (prev[o.value]?.x === ox && prev[o.value]?.width === width ? prev : { ...prev, [o.value]: { x: ox, width } }));
            }}
            onPress={() => {
              if (active) return;
              hapticSelect();
              onChange(o.value);
            }}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: active }}
            style={[styles.segment, { paddingHorizontal: size === "sm" ? 12 : 16 }, fullWidth && styles.segmentFill]}
          >
            {o.icon ? <Icon name={o.icon} size={16} color={active ? P.ink : P.ink3} weight="medium" /> : null}
            <Text style={[T.labelSm, { color: active ? P.ink : P.ink3 }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ───────────────────────────── chips, badges ───────────────────────────── */

/** A filter chip (Today | This week | All time, search suggestions, Poll, Video): selected ones in lime. */
export function Chip({ label, selected, onPress, icon, iconNode, disabled, size = "sm", accessibilityHint }: { label: string; selected?: boolean; onPress: () => void; icon?: IconName; iconNode?: ReactNode; disabled?: boolean; size?: "sm" | "md"; accessibilityHint?: string }) {
  const ink = selected ? P.accentInk : P.ink2;
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.chip,
        { height: size === "sm" ? 34 : 40, paddingHorizontal: size === "sm" ? 14 : 16 },
        selected && styles.chipOn,
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.45 },
      ]}
    >
      {iconNode ?? (icon ? <Icon name={icon} size={16} color={ink} /> : null)}
      <Text style={[size === "sm" ? T.labelSm : T.label, { color: ink, fontWeight: "500" }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export type BadgeTone = "neutral" | "accent" | "warning" | "danger" | "info" | "success";

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: P.surface3, fg: P.ink2 },
  accent: { bg: P.accentSoft, fg: P.accentInk },
  warning: { bg: P.warningSoft, fg: P.warning },
  danger: { bg: P.dangerSoft, fg: P.danger },
  info: { bg: P.infoSoft, fg: P.info },
  success: { bg: P.successSoft, fg: P.success },
};

/** A small non-interactive status pill (a campus name on Global, "Held for review", "Buzz only"). */
export function Badge({ label, tone = "neutral", outline }: { label: string; tone?: BadgeTone; outline?: boolean }) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, outline ? { borderWidth: 1, borderColor: P.lineStrong } : { backgroundColor: t.bg }]}>
      <Text style={[T.micro, { color: outline ? P.ink2 : t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** "OP" on the original poster's replies. */
export function OpBadge() {
  return (
    <View style={styles.op} accessible accessibilityLabel="Original poster">
      <Text style={[T.micro, { color: P.accentInk }]}>OP</Text>
    </View>
  );
}

/* ───────────────────────────── states ───────────────────────────── */

/** UniVerse's EmptyState (compact): an icon in a soft lime disc, a title, a line, a primary and a secondary action. */
export function EmptyState({ icon, iconNode, title, body, action, secondary, style }: { icon?: IconName; iconNode?: ReactNode; title: string; body?: string; action?: { label: string; onPress: () => void }; secondary?: { label: string; onPress: () => void }; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.empty, style]}>
      <View style={styles.emptyIcon}>{iconNode ?? (icon ? <Icon name={icon} size={28} color={P.accentInk} /> : <MaskGlyph size={28} />)}</View>
      <Text style={[T.headline, styles.center, { color: P.ink }]} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={[T.footnote, styles.center, { color: P.ink2 }]}>{body}</Text> : null}
      {action || secondary ? (
        <View style={styles.emptyActions}>
          {action ? <PButton title={action.label} onPress={action.onPress} /> : null}
          {secondary ? <PButton title={secondary.label} variant="ghost" onPress={secondary.onPress} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** UniVerse's ErrorState: what failed, why, and Retry. */
export function ErrorState({ title, message, onRetry, style }: { title: string; message?: string | null; onRetry?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.empty, style]} accessibilityLiveRegion="polite">
      <View style={[styles.emptyIcon, { backgroundColor: P.dangerSoft }]}>
        <Icon name="cloud-offline-outline" size={26} color={P.danger} />
      </View>
      <Text style={[T.headline, styles.center, { color: P.ink }]}>{title}</Text>
      {message && message !== title ? <Text style={[T.footnote, styles.center, { color: P.ink3 }]}>{message}</Text> : null}
      {onRetry ? <PButton title="Try again" icon="refresh" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** A placeholder shape that breathes while its content loads (still under Reduce Motion). */
export function Skeleton({ w, h, radius = R.xs, circle, style }: { w: ViewStyle["width"]; h: number; radius?: number; circle?: boolean; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    o.value = withRepeat(withSequence(withTiming(0.55, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
  }, [reduce, o]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Reanimated.View style={[{ width: w, height: h, borderRadius: circle ? h / 2 : radius, backgroundColor: P.skeleton }, pulse, style]} />;
}

/* ───────────────────────────── page header ───────────────────────────── */

/**
 * The compact header of a Buzz screen (Thread, Search Buzz, My buzzes): Back, the title (and a line under it), the
 * screen's actions on the right, then whatever sits `below` (the search box, the tabs). Clear of the status bar.
 */
export function PageHeader({ title, subtitle, onBack, actions, below }: { title: string; subtitle?: string | null; onBack: () => void; actions?: ReactNode; below?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <PIconButton icon="chevron-back" label="Back" onPress={onBack} size={44} iconSize={24} color={P.ink} />
        <View style={styles.headerTitle}>
          <Text style={[T.title3, { color: P.ink }]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text style={[T.footnote, { color: P.ink2 }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>
      {below}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: R.pill, borderCurve: "continuous" },
  fullWidth: { alignSelf: "stretch" },
  labelLg: { fontSize: 17 },
  segmented: { flexDirection: "row", alignItems: "stretch", alignSelf: "flex-start", padding: 4, borderRadius: R.pill, backgroundColor: P.surface2 },
  thumb: { position: "absolute", top: 4, bottom: 4, left: 0, borderRadius: R.pill, backgroundColor: P.surface4, shadowColor: P.shadow, shadowOpacity: 0.3, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  segment: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: R.pill },
  segmentFill: { flex: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: R.pill, borderWidth: 1, borderColor: P.line, backgroundColor: P.surface2 },
  chipOn: { borderColor: P.accentLine, backgroundColor: P.accentSoft },
  badge: { height: 20, maxWidth: "100%", flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderRadius: R.pill, flexShrink: 1 },
  op: { height: 18, paddingHorizontal: 6, borderRadius: R.xs, backgroundColor: P.accentSoft, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: 10, paddingHorizontal: 24, paddingVertical: 28 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: P.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  emptyActions: { alignItems: "center", gap: 4, marginTop: 6 },
  center: { textAlign: "center" },
  header: { backgroundColor: P.canvas },
  headerRow: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 4 },
  headerTitle: { flex: 1, minWidth: 0, paddingLeft: 4 },
  headerActions: { flexDirection: "row", alignItems: "center", paddingRight: 4 },
});
