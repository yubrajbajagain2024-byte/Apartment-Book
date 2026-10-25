import { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { auroraGradient, radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/**
 * The Aurora (cyan, blue, violet) where a screen wants a quiet accent rather than a grey box: a panel tinted at its
 * faintest with a hairline of the same light, a pill for a status, and a short gradient bar beside a heading. Words on
 * them keep the theme's own text colours, so nothing loses contrast. Used sparingly: one screen's cards and headings,
 * not every surface.
 */
export function AuroraPanel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const colors = useColors();
  return <View style={[styles.panel, { experimental_backgroundImage: auroraGradient(colors.auroraPanel, 135) }, style]}>{children}</View>;
}

/** A status on the Aurora: its icon and words in the accent ink, on a tinted capsule. */
export function AuroraPill({ label, icon }: { label: string; icon?: IconName }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.pill, { experimental_backgroundImage: auroraGradient(colors.auroraPanel, 110) }]}>
      {icon ? <Icon name={icon} size={13} color={colors.auroraInk} weight="semibold" /> : null}
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

/** A section heading with a short Aurora bar before it. */
export function AuroraHeading({ children }: { children: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.heading} accessibilityRole="header">
      <View style={[styles.bar, { experimental_backgroundImage: `linear-gradient(to bottom, ${colors.auroraGlow[0]}, ${colors.auroraGlow[1]} 45%, ${colors.auroraGlow[3]})` }]} />
      <Text style={styles.headingText}>{children}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  panel: { borderRadius: radius.md + 2, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.auroraEdge, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.bg },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", height: 26, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.auroraEdge, backgroundColor: colors.bg },
  pillText: { fontSize: 12, fontWeight: "600", color: colors.auroraInk },
  heading: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  bar: { width: 3, height: 16, borderRadius: 1.5 },
  headingText: { fontSize: 16, fontWeight: "700", color: colors.text },
}));
