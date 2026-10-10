import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/lib/theme-provider";

/**
 * The top-right corner of every tab, like TikTok: the Search magnifier, which opens the people search. `color` lets Home
 * paint it white over the Reels page; `inHeader` adds the right margin a native header does not give its headerRight.
 */
export function HeaderActions({ color, inHeader = false }: { color?: string; inHeader?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/search")} hitSlop={6} accessibilityRole="button" accessibilityLabel="Search" style={[styles.button, inHeader && styles.inHeader]}>
      <Ionicons name="search-outline" size={26} color={color ?? colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  inHeader: { marginRight: 8 },
});
