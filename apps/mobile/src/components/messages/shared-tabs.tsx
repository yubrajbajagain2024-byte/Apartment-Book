import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SharedContentKind } from "@apartment-book/shared";
import { hapticTap } from "@/lib/haptics";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

export const SHARED_TABS: readonly { key: SharedContentKind; label: string }[] = [
  { key: "media", label: "Media" },
  { key: "files", label: "Files" },
  { key: "links", label: "Links" },
];

/**
 * Media | Files | Links over a chat's shared content, drawn like the app's other segment rows (Followers | Following): the
 * open tab bold with a blue underline, a hairline under the row. Opaque in the screen's colour, because it sticks to the
 * top while the grid scrolls under it.
 */
export function SharedTabs({ active, onSelect }: { active: SharedContentKind; onSelect: (kind: SharedContentKind) => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {SHARED_TABS.map((t) => {
        const selected = t.key === active;
        return (
          <Pressable
            key={t.key}
            onPress={() => {
              if (selected) return;
              hapticTap();
              onSelect(t.key);
            }}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected }}
            style={styles.tab}
          >
            <Text style={[styles.label, selected && styles.labelActive]}>{t.label}</Text>
            <View style={[styles.underline, selected && { backgroundColor: colors.brand }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { flex: 1, alignItems: "center", paddingTop: space.md, gap: space.sm },
  label: { fontSize: 15, fontWeight: "600", color: colors.muted },
  labelActive: { color: colors.text, fontWeight: "800" },
  underline: { height: 2, alignSelf: "stretch", backgroundColor: "transparent" },
}));
