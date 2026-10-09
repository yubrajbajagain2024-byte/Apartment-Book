import { Pressable, StyleSheet, View, type LayoutChangeEvent, type Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { HeaderAvatar } from "@/components/header-avatar";
import { SlidingTabs } from "@/components/sliding-tabs";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";

/** Height of the row of labels, without the safe-area padding above it. */
export const HOME_TOP_TABS_ROW = 48;

/**
 * Floating top bar of Home, TikTok style: "+" on the left, For you | Buzz | Posts | Reels in the middle, profile on the right.
 * `overVideo` = the Reels page is showing, so the bar is see-through with white text. `scrollX` is the pager's offset in
 * points and `pageWidth` the width of one page: the underline slides between the labels with the finger instead of
 * jumping once a swipe settles. The label colours still snap with `section`.
 */
export function HomeTopTabs({ section, onSelect, overVideo, onLayout, scrollX, pageWidth }: { section: HomeSection; onSelect: (s: HomeSection) => void; overVideo: boolean; onLayout?: (e: LayoutChangeEvent) => void; scrollX: Animated.Value; pageWidth: number }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const show = useActionSheet();
  const { user } = useSession();
  const fg = overVideo ? "#fff" : colors.text;
  const dim = overVideo ? "rgba(255,255,255,0.7)" : colors.muted;
  const ink = overVideo ? "#fff" : colors.brand;

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
        <SlidingTabs sections={HOME_SECTIONS} section={section} onSelect={onSelect} scrollX={scrollX} pageWidth={pageWidth} tint={ink} labelColor={fg} dimColor={dim} textStyle={overVideo ? styles.shadow : undefined} />
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
  shadow: { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
});
