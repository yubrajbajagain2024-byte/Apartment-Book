import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { HeaderAvatar } from "@/components/header-avatar";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";

/** Height of the row of labels, without the safe-area padding above it. */
export const HOME_TOP_TABS_ROW = 48;

/**
 * Floating top bar of Home, TikTok style: "+" on the left, Reels | Buzz | Posts in the middle, profile on the right.
 * `overVideo` = the Reels page is showing, so the bar is see-through with white text.
 */
export function HomeTopTabs({ section, onSelect, overVideo, onLayout }: { section: HomeSection; onSelect: (s: HomeSection) => void; overVideo: boolean; onLayout?: (e: LayoutChangeEvent) => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const show = useActionSheet();
  const { user } = useSession();
  const fg = overVideo ? "#fff" : colors.text;
  const dim = overVideo ? "rgba(255,255,255,0.7)" : colors.muted;

  function create() {
    if (!user) return router.push("/(auth)/login");
    show(
      [
        { label: "Post", icon: "create-outline", onPress: () => router.push("/create/post" as never) },
        { label: "Reel", icon: "videocam-outline", onPress: () => router.push("/create/reel" as never) },
        { label: "Buzz (anonymous)", icon: "chatbubbles-outline", onPress: () => router.push("/create/buzz" as never) },
      ],
      "What would you like to share?",
    );
  }

  return (
    <View onLayout={onLayout} pointerEvents={overVideo ? "box-none" : "auto"} style={[styles.bar, { paddingTop: insets.top }, overVideo ? styles.clear : styles.solid]}>
      <View style={styles.row}>
        <Pressable onPress={create} hitSlop={8} accessibilityRole="button" accessibilityLabel="Create" style={styles.side}>
          <Ionicons name="add-circle-outline" size={30} color={fg} />
        </Pressable>
        <View style={styles.labels} accessibilityRole="tablist">
          {HOME_SECTIONS.map((s) => {
            const active = s.value === section;
            return (
              <Pressable key={s.value} onPress={() => onSelect(s.value)} hitSlop={6} accessibilityRole="tab" accessibilityLabel={s.label} accessibilityState={{ selected: active }} style={styles.tab}>
                <Text style={[styles.label, { color: active ? fg : dim }, active && { fontWeight: "800" }, overVideo && styles.shadow]}>{s.label}</Text>
                <View style={[styles.underline, { backgroundColor: active ? (overVideo ? "#fff" : colors.brand) : "transparent" }]} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.side}>
          <HeaderAvatar color={fg} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  solid: { backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  clear: { backgroundColor: "transparent", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent" },
  row: { height: HOME_TOP_TABS_ROW, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  side: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  labels: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22 },
  tab: { alignItems: "center", justifyContent: "center", height: HOME_TOP_TABS_ROW, gap: 4 },
  label: { fontSize: 16, fontWeight: "600" },
  underline: { width: 24, height: 3, borderRadius: 2 },
  shadow: { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
});
