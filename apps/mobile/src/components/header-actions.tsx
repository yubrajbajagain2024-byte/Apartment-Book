import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/lib/theme";
import { useUnread } from "@/lib/use-unread";

/**
 * The top-right corner of every tab, like TikTok: the inbox (with its unread count) and the magnifier, so the bottom bar
 * can stay Home | Housing | Marketplace | Profile. `color` lets Home paint the icons white over the Reels page; `inHeader`
 * adds the right margin a native header does not give its headerRight.
 */
export function HeaderActions({ color = colors.text, inHeader = false }: { color?: string; inHeader?: boolean }) {
  const router = useRouter();
  // One subscription for the whole navigator (UnreadProvider in the tabs layout), not one per header.
  const unread = useUnread();
  return (
    <View style={[styles.row, inHeader && styles.inHeader]}>
      <Pressable onPress={() => router.push("/messages")} hitSlop={6} accessibilityRole="button" accessibilityLabel="Messages" style={styles.button}>
        <Ionicons name="chatbubble-outline" size={26} color={color} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable onPress={() => router.push("/search")} hitSlop={6} accessibilityRole="button" accessibilityLabel="Search" style={styles.button}>
        <Ionicons name="search-outline" size={26} color={color} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  inHeader: { marginRight: 8 },
  button: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  // Red whatever sits behind it (a white header or a Reel) so the count reads at a glance; the "99+" cap keeps it a pill.
  badge: { position: "absolute", top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: "#e0245e", alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
