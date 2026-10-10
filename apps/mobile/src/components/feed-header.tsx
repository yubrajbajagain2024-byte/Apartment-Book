import { type ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { radius } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";

/** Search box + chips row shared by the feeds, plus the floating "+" button. */
export function FeedHeader({ placeholder, value, onChange, children }: { placeholder: string; value: string; onChange: (v: string) => void; children?: ReactNode }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} returnKeyType="search" clearButtonMode="while-editing" style={styles.input} accessibilityLabel={placeholder} />
      </View>
      {children ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View> : null}
    </View>
  );
}

export function Fab({ href, label }: { href: string; label: string }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  return (
    <Pressable onPress={() => router.push((user ? href : "/(auth)/login") as never)} style={styles.fab} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name="add" size={28} color={colors.onBrand} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  // The input fill, not the card colour: the screen behind it is white in light and black in dark.
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 14, height: 42 },
  input: { flex: 1, fontSize: 15, color: colors.text },
  fab: { position: "absolute", right: 16, bottom: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
}));
