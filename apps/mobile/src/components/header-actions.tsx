import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme-provider";
import { useUnreadNotifications } from "@/lib/use-unread";
import { Icon } from "@/components/icon";

/**
 * The top-right corner of Home: the Notifications bell, which opens the notifications screen, with a badge of how many
 * are unread while signed in (Search is a tab of its own in the bottom bar). `color` lets Home paint it white over the
 * Reels page (with `iconStyle`'s shadow); `inHeader` adds the right margin a native header does not give its headerRight.
 */
export function HeaderActions({ color, inHeader = false, iconStyle }: { color?: string; inHeader?: boolean; iconStyle?: StyleProp<TextStyle> }) {
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  const unread = useUnreadNotifications(user?.id ?? null);
  return (
    <Pressable onPress={() => router.push("/notifications")} hitSlop={6} accessibilityRole="button" accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} style={[styles.button, inHeader && styles.inHeader]}>
      <Icon name="notifications-outline" size={26} color={color ?? colors.text} style={iconStyle} />
      {unread > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.dangerFill, borderColor: colors.bar }]}>
          <Text style={[styles.badgeText, { color: colors.onBrand }]} numberOfLines={1}>
            {unread > 99 ? "99+" : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  inHeader: { marginRight: 8 },
  // The same badge as the bottom bar's, on the bell's top-right corner.
  badge: { position: "absolute", top: 0, right: -4, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
