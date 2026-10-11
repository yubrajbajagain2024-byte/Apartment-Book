import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { CampusMenu, type CampusChoice, type CampusMenuRow } from "./campus-menu";

/** Height of the bar under the safe area. */
const ROW = 48;
const MENU_GAP = 4;

/**
 * The Marketplace tab's own top bar, under the safe area with a hairline below it: "+" (sell an item) on the left, the
 * title in the middle with a small round chevron that drops down the campus menu, and the magnifier on the right. The
 * magnifier turns the bar into a search box with a Cancel; `searchBusy` swaps the box's magnifier for a spinner while the
 * grid catches up with the words.
 */
export function MarketHeader({
  title,
  campusRows,
  onPickCampus,
  onSell,
  searchOpen,
  query,
  onQueryChange,
  onOpenSearch,
  onCancelSearch,
  searchBusy,
}: {
  title: string;
  campusRows: CampusMenuRow[];
  onPickCampus: (value: CampusChoice) => void;
  onSell: () => void;
  searchOpen: boolean;
  query: string;
  onQueryChange: (text: string) => void;
  onOpenSearch: () => void;
  onCancelSearch: () => void;
  searchBusy: boolean;
}) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);

  function pick(value: CampusChoice) {
    setMenu(false);
    onPickCampus(value);
  }

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      {searchOpen ? (
        <View style={[styles.row, styles.searchRow]}>
          <View style={styles.search}>
            <View style={styles.searchMark}>{searchBusy ? <ActivityIndicator size="small" color={colors.muted} /> : <Ionicons name="search" size={18} color={colors.muted} />}</View>
            <TextInput
              value={query}
              onChangeText={onQueryChange}
              placeholder="Search marketplace"
              placeholderTextColor={colors.faint}
              keyboardAppearance={isDark ? "dark" : "light"}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
              accessibilityLabel="Search items"
              style={styles.input}
            />
            {query ? (
              <Pressable onPress={() => onQueryChange("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.faint} />
              </Pressable>
            ) : null}
          </View>
          <Pressable onPress={onCancelSearch} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel search" style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          <Pressable onPress={onSell} hitSlop={8} accessibilityRole="button" accessibilityLabel="Sell an item" style={({ pressed }) => [styles.side, pressed && styles.pressed]}>
            <Ionicons name="add-circle-outline" size={30} color={colors.text} />
          </Pressable>
          {/* Two equal side slots keep the title truly centred. */}
          <View style={styles.middle}>
            <Pressable
              onPress={() => setMenu(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Choose campus"
              accessibilityHint="Your university or all universities"
              accessibilityValue={{ text: title }}
              accessibilityState={{ expanded: menu }}
              style={({ pressed }) => [styles.titleButton, pressed && styles.pressed]}
            >
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <View style={styles.chevron}>
                <Ionicons name="chevron-down" size={14} color={colors.text} />
              </View>
            </Pressable>
          </View>
          <Pressable onPress={onOpenSearch} hitSlop={8} accessibilityRole="button" accessibilityLabel="Search items" style={({ pressed }) => [styles.side, pressed && styles.pressed]}>
            <Ionicons name="search-outline" size={26} color={colors.text} />
          </Pressable>
        </View>
      )}
      <CampusMenu visible={menu} top={insets.top + ROW + MENU_GAP} rows={campusRows} onPick={pick} onClose={() => setMenu(false)} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, zIndex: 1 },
  row: { height: ROW, flexDirection: "row", alignItems: "center", paddingHorizontal: space.md },
  searchRow: { gap: space.md },
  side: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xs },
  // As tall as the bar, so the whole height under the title opens the menu.
  titleButton: { minHeight: ROW, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flexShrink: 1, fontSize: 20, fontWeight: "800", letterSpacing: -0.3, color: colors.text },
  chevron: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },
  // The input fill, like the Chat inbox's search box: the bar behind it is white in light and black in dark.
  search: { flex: 1, height: 38, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.input },
  // The same slot for the magnifier and the spinner, so the words never shift.
  searchMark: { width: 20, alignItems: "center" },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  cancel: { fontSize: 15, fontWeight: "600", color: colors.text },
}));
