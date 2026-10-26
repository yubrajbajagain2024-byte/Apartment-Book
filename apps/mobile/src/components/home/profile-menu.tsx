import { useCallback, useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { Sheet } from "@/components/sheet";
import { useSession } from "@/lib/session";
import { SITE_URL } from "@/lib/supabase";
import { radius, sheetShape, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useCreateMenu } from "./create-menu";

/**
 * What your photo in Home's top bar opens, as UniVerse's account sheet: a card with your photo, name and @username that
 * opens your profile, then Upload (the create sheet: Post / Reel / Buzz / Snap), Saved, Settings and Community
 * Guidelines, and Log out on its own. A choice closes the sheet first and runs once it is gone (iOS presents nothing over
 * a modal that is still leaving), as the share sheet's do. Account status stays in Settings.
 */
export function ProfileMenuSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, signOut } = useSession();
  const create = useCreateMenu();
  /** Something to do once the sheet is gone. */
  const afterDismiss = useRef<(() => void) | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (fallback.current && clearTimeout(fallback.current)), []);

  const runAfterDismiss = useCallback(() => {
    const fn = afterDismiss.current;
    afterDismiss.current = null;
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    fn?.();
  }, []);
  /** Close, then act: straight away on Android, after the dismissal on iOS (onDismiss, or a timer if it never fires). */
  const closeThen = useCallback(
    (fn: () => void) => {
      onClose();
      if (Platform.OS !== "ios") return fn();
      afterDismiss.current = fn;
      // The sheet animates out first (about a quarter second), then the modal goes: allow for both.
      fallback.current = setTimeout(runAfterDismiss, 900);
    },
    [onClose, runAfterDismiss],
  );

  return (
    <Sheet visible={visible} onClose={onClose} onDismiss={runAfterDismiss} closeLabel="Close menu" draggable="sheet">
      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom - sheetShape.marginBottom, space.lg) }]}>
        <View style={styles.grabber} />
        {profile ? (
          <Pressable
            onPress={() => closeThen(() => router.push("/(tabs)/profile"))}
            accessibilityRole="button"
            accessibilityLabel={`${profile.full_name}, @${profile.username}`}
            accessibilityHint="Opens your profile"
            style={({ pressed }) => [styles.card, styles.person, pressed && styles.pressed]}
          >
            <Avatar name={profile.full_name} url={profile.avatar_url} size={56} online={false} transition={0} />
            <View style={styles.personText}>
              <Text style={styles.name} numberOfLines={1}>
                {profile.full_name}
              </Text>
              <Text style={styles.handle} numberOfLines={1}>
                @{profile.username} · View profile
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        ) : null}
        <View style={styles.card}>
          <MenuRow icon="add-circle-outline" title="Upload" subtitle="A post, a reel, a Buzz thread or a Snap" onPress={() => closeThen(create)} />
          <MenuRow icon="bookmark-outline" title="Saved" divider onPress={() => closeThen(() => router.push("/saved"))} />
          <MenuRow icon="settings-outline" title="Settings" divider onPress={() => closeThen(() => router.push("/settings"))} />
          <MenuRow icon="book-outline" title="Community Guidelines" divider onPress={() => closeThen(() => void WebBrowser.openBrowserAsync(`${SITE_URL}/guidelines`, { dismissButtonStyle: "close" }).catch(() => {}))} />
        </View>
        <View style={styles.card}>
          <MenuRow icon="log-out-outline" title="Log out" destructive onPress={() => closeThen(() => void signOut())} />
        </View>
      </View>
    </Sheet>
  );
}

/** One row of the menu: its icon in a soft circle, the words, and a chevron (none on Log out); `divider` draws the inset hairline above it. */
function MenuRow({ icon, title, subtitle, divider = false, destructive = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; divider?: boolean; destructive?: boolean; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const tint = destructive ? colors.dangerText : colors.text;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.iconWell}>
        <Icon name={icon} size={21} color={tint} />
      </View>
      <View style={[styles.rowText, divider && styles.divider]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.title, { color: tint }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {destructive ? null : <Icon name="chevron-forward" size={18} color={colors.faint} />}
      </View>
    </Pressable>
  );
}

const ICON_WELL = 40;

const useStyles = makeStyles((colors) => ({
  body: { paddingHorizontal: space.lg, paddingTop: 6, gap: space.md },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 2.5, backgroundColor: colors.grabber, marginBottom: space.xs },
  // The groups: the screen's own colour inside the sheet, with a hairline edge, so they read apart in both themes.
  card: { backgroundColor: colors.bg, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" },
  person: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  personText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: "700", color: colors.text },
  handle: { fontSize: 14, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingLeft: space.md },
  iconWell: { width: ICON_WELL, height: ICON_WELL, borderRadius: ICON_WELL / 2, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  // The words and the chevron, with the hairline above them starting after the icon, as iOS's grouped lists draw it.
  rowText: { flex: 1, minHeight: 62, flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, paddingRight: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  title: { fontSize: 16, fontWeight: "600" },
  subtitle: { fontSize: 13, color: colors.muted },
  pressed: { opacity: 0.7 },
}));
