import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/lib/theme";

export type ProfileTabKey = "posts" | "classes" | "reels" | "saved" | "liked";

/** Posts first, then the semester's classes, Reels, Saved and Liked: the order the profile asks for. */
export const PROFILE_TABS: { key: ProfileTabKey; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "posts", label: "Posts", icon: "grid-outline", activeIcon: "grid" },
  { key: "classes", label: "Classes", icon: "school-outline", activeIcon: "school" },
  { key: "reels", label: "Reels", icon: "film-outline", activeIcon: "film" },
  { key: "saved", label: "Saved", icon: "bookmark-outline", activeIcon: "bookmark" },
  { key: "liked", label: "Liked", icon: "heart-outline", activeIcon: "heart" },
];

/**
 * The row of icon tabs above a profile's grid, TikTok style: the active icon dark with a thick underline, the others grey,
 * a hairline under the row. A tab with an entry in `locks` gets a small lock: on your own profile when it is not public, on
 * someone else's when you may not open it. The entry is what VoiceOver adds ("Only you can see your saved posts").
 */
export function ProfileTabs({ active, onSelect, locks }: { active: ProfileTabKey; onSelect: (tab: ProfileTabKey) => void; locks: Partial<Record<ProfileTabKey, string>> }) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {PROFILE_TABS.map((t) => {
        const selected = t.key === active;
        const lock = locks[t.key];
        return (
          <Pressable
            key={t.key}
            onPress={() => onSelect(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityHint={lock}
            accessibilityState={{ selected }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={styles.tab}
          >
            <View>
              <Ionicons name={selected ? t.activeIcon : t.icon} size={23} color={selected ? colors.text : colors.faint} />
              {lock ? (
                <View style={styles.lock}>
                  <Ionicons name="lock-closed" size={9} color={selected ? colors.text : colors.muted} />
                </View>
              ) : null}
            </View>
            <View style={[styles.underline, selected && styles.underlineActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginTop: 14 },
  tab: { flex: 1, alignItems: "center", justifyContent: "flex-end", paddingTop: 10, gap: 9 },
  lock: { position: "absolute", right: -9, bottom: -2, width: 13, height: 13, borderRadius: 7, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  underline: { height: 2.5, width: "42%", borderRadius: 2, backgroundColor: "transparent" },
  underlineActive: { backgroundColor: colors.text },
});
