import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HOME_BRAND, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { HeaderActions } from "@/components/header-actions";
import { SlidingTabs } from "@/components/sliding-tabs";
import { hapticTap } from "@/lib/haptics";
import { useHomeScope } from "@/lib/home-scope";
import { useSession } from "@/lib/session";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** Height of each of the bar's two rows. */
const ROW = 44;
/** Height of the two rows (the wordmark, then the labels), without the safe-area padding above them. */
export const HOME_TOP_BAR_ROWS = ROW * 2;
/** The feed menu that drops down from the wordmark. */
const MENU_WIDTH = 240;
const MENU_GAP = 6;

/** `pick` returns true when it also moved to another section (that switch plays its own haptic). */
type MenuRow = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; pick: () => boolean | void };

/**
 * Floating top bar of Home, Instagram style, in two rows. Row 1: "+" on the left, the CampConnect wordmark in the middle
 * with a chevron that drops down the feed menu (your university | all universities | Following, see useHomeScope), the
 * Search magnifier on the right. Row 2: For you | Buzz | Posts | Reels with X's sliding underline, and a hairline under them.
 * `overVideo` = the Reels page is showing, so the bar is see-through with white text. `scrollX` is the pager's offset in
 * points and `pageWidth` the width of one page: the underline slides between the labels with the finger instead of
 * jumping once a swipe settles. The label colours still snap with `section`.
 */
export function HomeTopTabs({ section, onSelect, overVideo, onLayout, scrollX, pageWidth }: { section: HomeSection; onSelect: (s: HomeSection) => void; overVideo: boolean; onLayout?: (e: LayoutChangeEvent) => void; scrollX: Animated.Value; pageWidth: number }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const show = useActionSheet();
  const { user, profile } = useSession();
  const [scope, setScope] = useHomeScope();
  const [menu, setMenu] = useState(false);
  const colors = useColors();
  const styles = useStyles();
  const fg = overVideo ? colors.onMedia : colors.text;
  const dim = overVideo ? colors.onMediaMuted : colors.muted;
  const ink = overVideo ? colors.onMedia : colors.brand;
  // Signed out there is nobody you follow: the Posts page drops the filter too (see PostsSection).
  const following = Boolean(user) && scope.following;
  // Like Instagram, the wordmark reads "Following" while that feed is showing. Only Posts can filter by follows, so on the
  // other sections the menu checks the campus the page is really showing.
  const followingShown = following && section === "posts";
  const title = followingShown ? "Following" : HOME_BRAND;

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

  const rows: MenuRow[] = [];
  if (profile?.university_id) rows.push({ key: "mine", label: profile.university?.name ?? "My university", icon: "school-outline", selected: !followingShown && scope.campus === "mine", pick: () => setScope({ campus: "mine", following: false }) });
  // Without a university of their own, the person sees every campus whatever `campus` says (the sections pass no university).
  rows.push({ key: "all", label: "All universities", icon: "globe-outline", selected: !followingShown && (scope.campus === "all" || !profile?.university_id), pick: () => setScope({ campus: "all", following: false }) });
  if (user) {
    rows.push({
      key: "following",
      label: "Following",
      icon: "people-outline",
      selected: followingShown,
      pick: () => {
        setScope({ following: true });
        // Only Posts can show the people you follow: picking it from another section goes there.
        if (section === "posts") return false;
        onSelect("posts");
        return true;
      },
    });
  }

  function pick(row: MenuRow) {
    setMenu(false);
    // One haptic per choice: a pick that switches section leaves the feedback to that switch.
    if (!row.pick()) hapticTap();
  }

  return (
    <View onLayout={onLayout} pointerEvents={overVideo ? "box-none" : "auto"} style={[styles.bar, { paddingTop: insets.top }, overVideo ? styles.clear : styles.solid]}>
      <View style={styles.row}>
        <Pressable onPress={create} hitSlop={8} accessibilityRole="button" accessibilityLabel="Create" style={styles.side}>
          <Ionicons name="add-circle-outline" size={30} color={fg} />
        </Pressable>
        <View style={styles.middle}>
          <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Choose feed" accessibilityHint="Your university, all universities or people you follow" accessibilityValue={{ text: title }} accessibilityState={{ expanded: menu }} style={styles.title}>
            <Text style={[styles.wordmark, { color: fg }, overVideo && styles.shadow]} numberOfLines={1}>
              {title}
            </Text>
            <Ionicons name="chevron-down" size={18} color={fg} style={overVideo ? styles.shadow : undefined} />
          </Pressable>
        </View>
        <View style={styles.side}>
          <HeaderActions color={fg} />
        </View>
      </View>
      <View style={styles.row}>
        <SlidingTabs sections={HOME_SECTIONS} section={section} onSelect={onSelect} scrollX={scrollX} pageWidth={pageWidth} tint={ink} labelColor={fg} dimColor={dim} textStyle={overVideo ? styles.shadow : undefined} />
      </View>
      {/* Instagram's feed menu: a card anchored just under the wordmark, the page still fully visible behind it. The card keeps the theme's colours over video. */}
      <Modal visible={menu} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenu(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View pointerEvents="box-none" style={[styles.anchor, { top: insets.top + ROW + MENU_GAP }]}>
          <View style={styles.menu} accessibilityRole="menu">
            {rows.map((r) => (
              <Pressable key={r.key} onPress={() => pick(r)} accessibilityRole="menuitem" accessibilityLabel={r.label} accessibilityState={{ selected: r.selected }} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.input }]}>
                <Ionicons name={r.icon} size={20} color={colors.text} />
                <Text style={[styles.itemText, r.selected && styles.itemSelected]} numberOfLines={1}>
                  {r.label}
                </Text>
                {r.selected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors, scheme) => ({
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  solid: { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  clear: { backgroundColor: "transparent", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent" },
  row: { height: ROW, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  side: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  // Two equal side slots keep the wordmark truly centred.
  middle: { flex: 1, alignItems: "center", justifyContent: "center" },
  // As tall as its row, so the whole 44pt under the wordmark opens the menu.
  title: { minHeight: ROW, flexDirection: "row", alignItems: "center", gap: 2, maxWidth: "100%" },
  wordmark: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5, flexShrink: 1 },
  shadow: { textShadowColor: colors.mediaScrim, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  // Transparent like Instagram's: the page stays fully visible behind the menu, and a tap anywhere outside it closes it.
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  anchor: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  // A shadow cannot be seen on black, so in the dark theme a hairline outline keeps the menu apart from the page.
  menu: { width: MENU_WIDTH, backgroundColor: colors.elevated, borderRadius: radius.lg, paddingVertical: 6, shadowColor: colors.shadow, shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10, borderWidth: scheme === "dark" ? StyleSheet.hairlineWidth : 0, borderColor: colors.border },
  item: { height: ROW, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  itemText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
  itemSelected: { fontWeight: "700" },
}));
