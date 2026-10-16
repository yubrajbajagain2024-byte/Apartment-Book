import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HOME_BRAND, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { HeaderActions } from "@/components/header-actions";
import { SlidingTabs } from "@/components/sliding-tabs";
import { hapticTap } from "@/lib/haptics";
import { useHomeScope } from "@/lib/home-scope";
import { useSession } from "@/lib/session";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useCreateMenu } from "./create-menu";

/** Height of the bar's one row, without the safe-area padding above it. */
const ROW = 50;
export const HOME_TOP_BAR_HEIGHT = ROW;
/** Your photo on the left of the bar: the picture, the gap around it and the gradient ring. */
const PHOTO = 32;
const PHOTO_GAP = 2;
const RING = 2;
const RING_SIZE = PHOTO + 2 * (PHOTO_GAP + RING);
/** The slot on each side of the labels (the ring on the left, Search on the right). */
const SIDE = 44;
/** The four labels sit between the two slots: 16pt with 20 between them still fits a 360pt phone. */
const LABEL_GAP = 20;
const LABEL_SIZE = 16;
/** The feed menu that drops down from your photo. */
const MENU_WIDTH = 240;
const MENU_GAP = 6;

/** `pick` returns true when it also moved to another section (that switch plays its own haptic). */
type MenuRow = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; pick: () => boolean | void };

/**
 * Whether the bar is drawn for the Reels video: white text and icons with a soft shadow, and touches between them going
 * through to the video. A tiny store rather than a prop: Home's scroll listener flips it the moment the pager crosses the
 * halfway point between Posts and Reels (a swipe or a label tap's scroll), and only the bar, the status bar and the
 * floating "New post" pill re-render, never Home and its pages.
 */
export type OverVideoStore = { get: () => boolean; set: (next: boolean) => void; subscribe: (listener: () => void) => () => void };

export function createOverVideoStore(initial: boolean): OverVideoStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The current value of an OverVideoStore; re-renders the caller when it flips. */
export function useOverVideo(store: OverVideoStore): boolean {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** How solid the bar's background is on each page: fully on For you, Buzz and Posts, gone on Reels. */
const SOLID = HOME_SECTIONS.map((s) => (s.value === "reels" ? 0 : 1));

/**
 * Floating top bar of Home, one row: your photo in a gradient ring on the left, which drops down the feed menu (your
 * university | all universities | Following, see useHomeScope); For you | Buzz | Posts | Reels in the middle with X's
 * sliding underline (violet) and a hairline under the row; the Search magnifier on the right. Creating lives in the
 * "+ New post" pill floating over the feed (NewPostButton); over the Reels video, where that pill is gone and the menu has
 * nothing to choose (Reels is not scoped by campus), the left slot holds the "+" instead, white like the rest of the bar.
 * `scrollX` is the pager's offset in points and `pageWidth` the width of one page: the underline slides, the labels
 * crossfade (see SlidingTabs) and the bar's solid background (colors.bar and its hairline) fades out towards Reels with
 * the finger, all on the native driver. `overVideo` says when the text and icons turn white for the video: Home flips it
 * halfway between Posts and Reels. `section` is the section committed once the pager settles: the menu and what screen
 * readers hear as selected follow it. Memoized: Home mounting a page ahead of time leaves it alone.
 */
export const HomeTopTabs = memo(function HomeTopTabs({ section, onSelect, overVideo: overVideoStore, onPosts: onPostsStore, onLayout, scrollX, pageWidth }: { section: HomeSection; onSelect: (s: HomeSection) => void; overVideo: OverVideoStore; onPosts: OverVideoStore; onLayout?: (e: LayoutChangeEvent) => void; scrollX: Animated.Value; pageWidth: number }) {
  const insets = useSafeAreaInsets();
  const { user, profile } = useSession();
  const [scope, setScope] = useHomeScope();
  const [menu, setMenu] = useState(false);
  const colors = useColors();
  const styles = useStyles();
  const create = useCreateMenu();
  const overVideo = useOverVideo(overVideoStore);
  // Whether the page under the finger is Posts: flipped halfway, like overVideo, so the menu's check follows the swipe, not the settle.
  const onPosts = useOverVideo(onPostsStore);
  // Page i (offset i * pageWidth) shows SOLID[i]; in between the background follows the finger. Only once pageWidth > 0
  // (strictly increasing input range); until then it simply matches `overVideo`.
  const solid = useMemo(() => (pageWidth > 0 ? scrollX.interpolate({ inputRange: SOLID.map((_, i) => i * pageWidth), outputRange: SOLID, extrapolate: "clamp" }) : null), [pageWidth, scrollX]);
  const fg = overVideo ? colors.onMedia : colors.text;
  const dim = overVideo ? colors.onMediaMuted : colors.muted;
  const ink = overVideo ? colors.onMedia : colors.accent;
  // Signed out there is nobody you follow: the Posts page drops the filter too (see PostsSection).
  const following = Boolean(user) && scope.following;
  // Only Posts can filter by follows, so on the other sections the menu checks the campus the page is really showing.
  const followingShown = following && onPosts;
  // What the menu button reads to screen readers: the feed it is showing.
  const title = followingShown ? "Following" : HOME_BRAND;

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
    <View onLayout={onLayout} pointerEvents={overVideo ? "box-none" : "auto"} style={[styles.bar, { paddingTop: insets.top }]}>
      <Animated.View pointerEvents="none" style={[styles.solid, { opacity: solid ?? (overVideo ? 0 : 1) }]} />
      <View style={styles.row}>
        {overVideo ? (
          <Pressable onPress={create} hitSlop={8} accessibilityRole="button" accessibilityLabel="Create" style={styles.side}>
            <Ionicons name="add-circle-outline" size={30} color={fg} style={styles.shadow} />
          </Pressable>
        ) : (
          <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Choose feed" accessibilityHint="Your university, all universities or people you follow" accessibilityValue={{ text: title }} accessibilityState={{ expanded: menu }} style={styles.side}>
            <View style={styles.ring}>
              <View style={styles.ringGap}>
                {profile ? <Avatar name={profile.full_name} url={profile.avatar_url} size={PHOTO} online={false} transition={0} /> : <Ionicons name="person-circle" size={PHOTO} color={colors.faint} />}
              </View>
            </View>
          </Pressable>
        )}
        <View style={styles.middle}>
          <SlidingTabs sections={HOME_SECTIONS} section={section} onSelect={onSelect} scrollX={scrollX} pageWidth={pageWidth} tint={ink} labelColor={fg} dimColor={dim} textStyle={overVideo ? styles.shadow : undefined} gap={LABEL_GAP} fontSize={LABEL_SIZE} />
        </View>
        <View style={styles.side}>
          <HeaderActions color={fg} iconStyle={overVideo ? styles.shadow : undefined} />
        </View>
      </View>
      {/* The feed menu: a card hanging under your photo, the page still fully visible behind it. */}
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
                {r.selected ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
});

const useStyles = makeStyles((colors, scheme) => ({
  // The bar itself is see-through; its transparent hairline keeps the height the same as when the solid look was drawn on it.
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent" },
  // The solid look behind the row, safe area included, its hairline on the bar's bottom edge: faded by the pager (see `solid`).
  solid: { position: "absolute", top: 0, left: 0, right: 0, bottom: -StyleSheet.hairlineWidth, backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { height: ROW, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  side: { width: SIDE, height: ROW, alignItems: "center", justifyContent: "center" },
  // Two equal side slots keep the labels truly centred; stretched to the row so the underline sits on its bottom edge.
  middle: { flex: 1, alignSelf: "stretch", flexDirection: "row", paddingHorizontal: 4 },
  // The ring: a teal-to-violet gradient (plain violet where the platform draws none) with a gap in the bar's colour around the photo.
  ring: { width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, experimental_backgroundImage: `linear-gradient(135deg, ${colors.accentTeal} 0%, ${colors.accent} 100%)` },
  ringGap: { width: PHOTO + 2 * PHOTO_GAP, height: PHOTO + 2 * PHOTO_GAP, borderRadius: PHOTO / 2 + PHOTO_GAP, backgroundColor: colors.bar, alignItems: "center", justifyContent: "center" },
  shadow: { textShadowColor: colors.mediaScrim, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  // Transparent: the page stays fully visible behind the menu, and a tap anywhere outside it closes it.
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  anchor: { position: "absolute", left: 12, alignItems: "flex-start" },
  // A shadow cannot be seen on black, so in the dark theme a hairline outline keeps the menu apart from the page.
  menu: { width: MENU_WIDTH, backgroundColor: colors.elevated, borderRadius: radius.lg, paddingVertical: 6, shadowColor: colors.shadow, shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10, borderWidth: scheme === "dark" ? StyleSheet.hairlineWidth : 0, borderColor: colors.border },
  item: { height: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  itemText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
  itemSelected: { fontWeight: "700" },
}));
