import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** Whose items the Marketplace shows: the person's own university, or every university. */
export type CampusChoice = "mine" | "all";
export type CampusMenuRow = { value: CampusChoice; label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean };

const MENU_WIDTH = 280;

/**
 * The menu that drops down from the Marketplace title, like Home's feed menu: a card just under the title with the
 * person's university and All universities, a checkmark on the one showing. The page stays fully visible behind it and a
 * tap anywhere outside closes it. `top` is where the card starts, in window coordinates.
 */
export function CampusMenu({ visible, top, rows, onPick, onClose }: { visible: boolean; top: number; rows: CampusMenuRow[]; onPick: (value: CampusChoice) => void; onClose: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
      <View style={[styles.anchor, { top }]}>
        <View style={styles.menu} accessibilityRole="menu">
          {rows.map((r) => (
            <Pressable key={r.value} onPress={() => onPick(r.value)} accessibilityRole="menuitem" accessibilityLabel={r.label} accessibilityState={{ selected: r.selected }} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.input }]}>
              <Ionicons name={r.icon} size={20} color={colors.text} />
              <Text style={[styles.itemText, r.selected && styles.itemSelected]} numberOfLines={1}>
                {r.label}
              </Text>
              <View style={styles.check}>{r.selected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}</View>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors, scheme) => ({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // Touches beside the card fall through to the backdrop, which closes the menu.
  anchor: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: 16, pointerEvents: "box-none" },
  // A shadow cannot be seen on black, so in the dark theme a hairline outline keeps the menu apart from the page.
  menu: { width: MENU_WIDTH, maxWidth: "100%", backgroundColor: colors.elevated, borderRadius: radius.lg, paddingVertical: 6, shadowColor: colors.shadow, shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10, borderWidth: scheme === "dark" ? StyleSheet.hairlineWidth : 0, borderColor: colors.border },
  item: { height: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  itemText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
  itemSelected: { fontWeight: "700" },
  check: { width: 20, alignItems: "center" },
}));
