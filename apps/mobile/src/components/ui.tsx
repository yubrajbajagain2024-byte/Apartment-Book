import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, space } from "@/lib/theme";

export function Screen({ children, scroll = false, padded = true, style }: { children: ReactNode; scroll?: boolean; padded?: boolean; style?: StyleProp<ViewStyle> }) {
  const inner = <View style={[styles.screenInner, padded && { padding: space.lg }, style]}>{children}</View>;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

export function Button({
  title,
  variant = "primary",
  loading,
  icon,
  style,
  disabled,
  ...props
}: PressableProps & { title: string; variant?: "primary" | "secondary" | "ghost" | "danger"; loading?: boolean; icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle> }) {
  const bg = variant === "primary" ? colors.brand : variant === "danger" ? colors.red : variant === "secondary" ? colors.border : "transparent";
  const fg = variant === "primary" || variant === "danger" ? "#fff" : variant === "ghost" ? colors.brand : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
      {...props}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, style, multiline, ...props }: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.faint}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 96, textAlignVertical: "top" }, error ? { borderColor: colors.red } : null, style]}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && { backgroundColor: colors.brandSoft, borderColor: colors.brand }]}>
      {icon ? <Ionicons name={icon} size={14} color={active ? colors.brand : colors.muted} /> : null}
      <Text style={[styles.chipText, active && { color: colors.brand }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = "gray" }: { label: string; tone?: "gray" | "blue" | "green" | "amber" }) {
  const bg = tone === "blue" ? colors.brandSoft : tone === "green" ? "#e6f6ea" : tone === "amber" ? "#fff4d6" : colors.border;
  const fg = tone === "blue" ? colors.brand : tone === "green" ? "#1f7a37" : tone === "amber" ? "#8a5a00" : colors.muted;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brand} size="large" />
      {label ? <Text style={styles.hint}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon = "search-outline", title, body, action }: { icon?: keyof typeof Ionicons.glyphMap; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={[styles.center, { padding: space.xl, gap: space.sm }]}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={28} color={colors.brand} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" }}>{title}</Text>
      {body ? <Text style={[styles.hint, { textAlign: "center" }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={{ color: "#8a1c1c", flex: 1 }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry}>
          <Text style={{ color: "#8a1c1c", fontWeight: "700" }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { flex: 1 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: radius.md },
  buttonText: { fontSize: 15, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  error: { color: colors.red, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 13 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.lg },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fdecec", padding: 12, borderRadius: radius.md },
});
