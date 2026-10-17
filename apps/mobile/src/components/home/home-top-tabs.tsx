import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HOME_BRAND, HOME_TABS, type HomeSection } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { HeaderActions } from "@/components/header-actions";
import { SlidingTabs } from "@/components/sliding-tabs";
import { hapticTap } from "@/lib/haptics";
import { useHomeScope } from "@/lib/home-scope";
import { useSession } from "@/lib/session";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useCreateMenu } from "./create-menu";

/** Height of each of the bar's first two rows: the wordmark row, then the labels row. */
const ROW = 44;
/** The third row: the Campus | Global toggle, a 32pt pill with 6pt above and below. */
const TOGGLE_ROW = 44;
/**
 * Breathing room between the status bar (the safe area's top inset) and the first row, so the photo ring and the bell sit
 * clearly under the clock on every phone: with the row starting right at the inset the 40pt ring came within 2pt of
 * it, and on a phone whose inset is only the status bar (no notch, Android) it touched the clock.
 */
const TOP_GAP = 8;
/** The side margin of the rows: the ring and the bell keep this clear of the screen's edges. */
const SIDE_PAD = 16;
export const HOME_TOP_BAR_HEIGHT = TOP_GAP + ROW * 2 + TOGGLE_ROW;
/** Your photo on the left of the bar: the picture, the gap around it and the gradient ring. */
const PHOTO = 32;
const PHOTO_GAP = 2;
const RING = 2;
const RING_SIZE = PHOTO + 2 * (PHOTO_GAP + RING);
/** The slot on each side of the wordmark (the ring on the left, the Notifications bell on the right). */
const SIDE = 44;
const LABEL_SIZE = 16;
/** The toggle: each segment this wide, the sliding thumb inset by the pill's padding. */
const SEGMENT = 108;
const TOGGLE_PAD = 3;
const TOGGLE_HEIGHT = 32;

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
const SOLID = HOME_TABS.map((s) => (s.value === "reels" ? 0 : 1));
/** The Following choice opens the Posts page, so it is offered only while Posts has a tab. */
const POSTS_SHOWN = HOME_TABS.some((s) => s.value === "posts");

type Segment = { key: "mine" | "all" | "following"; label: string; icon: keyof typeof Ionicons.glyphMap; hint: string };

/**
 * Floating top bar of Home, X style, in three rows. Row 1: your photo in a gradient ring on the left, which opens your
 * profile, with Instagram's small "+" badge on its corner that opens the create sheet (Post / Reel / Buzz); the
 * CampConnect wordmark in the middle (it reads "Following" while that feed shows); the Notifications bell on the right
 * (it opens the notifications screen; its badge counts the unread). Row 2: For you | Buzz | Reels spread across the row
 * with X's sliding underline (violet, as wide as the label) over a hairline. Row 3: the Campus | Global toggle, a small
 * segmented pill whose thumb slides to the choice (see useHomeScope: it scopes For you, Buzz, Posts and Reels alike;
 * Campus is the person's own university, Global every university; "Following" joins it only while Posts has a tab,
 * and moves to Posts). Someone without a university has nothing to choose, so the row is not drawn for them. `scrollX`
 * is the pager's offset in points and `pageWidth` the width of one page: the underline slides, the labels crossfade (see
 * SlidingTabs) and the bar's solid background (colors.bar and its hairline) fades out towards Reels with the finger, all
 * on the native driver. `overVideo` says when the text, icons and the toggle turn white and glassy for the video: Home
 * flips it halfway between Posts and Reels. Creating lives in the "+ New post" pill floating over the feed
 * (NewPostButton); over the Reels video, where that pill is gone, the left slot holds the "+" instead, white like the
 * rest of the bar. `section` is the section committed once the pager settles: what screen readers hear as selected
 * follows it. `translateY` slides the whole bar up out of the way as the page on screen scrolls down and back as soon as
 * it scrolls up, Instagram style (see useCollapsingHeader). Memoized: Home mounting a page ahead of time leaves it alone.
 */
export const HomeTopTabs = memo(function HomeTopTabs({ section, onSelect, overVideo: overVideoStore, onPosts: onPostsStore, onLayout, scrollX, pageWidth, translateY }: { section: HomeSection; onSelect: (s: HomeSection) => void; overVideo: OverVideoStore; onPosts: OverVideoStore; onLayout: (e: LayoutChangeEvent) => void; scrollX: Animated.Value; pageWidth: number; translateY: Animated.AnimatedInterpolation<number> }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile } = useSession();
  const [scope, setScope] = useHomeScope();
  const colors = useColors();
  const styles = useStyles();
  const create = useCreateMenu();
  const overVideo = useOverVideo(overVideoStore);
  // Whether the page under the finger is Posts: flipped halfway, like overVideo, so the title and the toggle follow the swipe, not the settle.
  const onPosts = useOverVideo(onPostsStore);
  // Page i (offset i * pageWidth) shows SOLID[i]; in between the background follows the finger. Only once pageWidth > 0
  // (strictly increasing input range); until then it simply matches `overVideo`.
  const solid = useMemo(() => (pageWidth > 0 ? scrollX.interpolate({ inputRange: SOLID.map((_, i) => i * pageWidth), outputRange: SOLID, extrapolate: "clamp" }) : null), [pageWidth, scrollX]);
  const fg = overVideo ? colors.onMedia : colors.text;
  const dim = overVideo ? colors.onMediaMuted : colors.muted;
  const ink = overVideo ? colors.onMedia : colors.accent;
  // Signed out there is nobody you follow: the Posts page drops the filter too (see PostsSection).
  const following = Boolean(user) && scope.following;
  // Like X's "Following", the wordmark reads it while that feed is showing. Only Posts can filter by follows, so on the
  // other sections the toggle shows the campus the page is really showing.
  const followingShown = following && onPosts;
  const title = followingShown ? "Following" : HOME_BRAND;

  // The person's own campus (by its name for screen readers), every campus, and the people they follow while Posts has a tab.
  const segments: Segment[] = [];
  if (profile?.university_id) segments.push({ key: "mine", label: "Campus", icon: "school-outline", hint: profile.university?.name ?? "Your university" });
  segments.push({ key: "all", label: "Global", icon: "globe-outline", hint: "Every university" });
  if (user && POSTS_SHOWN) segments.push({ key: "following", label: "Following", icon: "people-outline", hint: "Posts by the people you follow" });
  const chosen: Segment["key"] = followingShown ? "following" : profile?.university_id && scope.campus === "mine" ? "mine" : "all";

  function choose(key: Segment["key"]) {
    if (key === chosen) return;
    if (key === "following") {
      setScope({ following: true });
      // Only Posts can show the people you follow: picking it from another section goes there (that switch plays its own haptic).
      if (section !== "posts") return onSelect("posts");
    } else {
      setScope({ campus: key, following: false });
    }
    hapticTap();
  }

  return (
    <Animated.View onLayout={onLayout} pointerEvents={overVideo ? "box-none" : "auto"} style={[styles.bar, { paddingTop: insets.top + TOP_GAP, transform: [{ translateY }] }]}>
      <Animated.View pointerEvents="none" style={[styles.solid, { opacity: solid ?? (overVideo ? 0 : 1) }]} />
      <View style={styles.row}>
        {overVideo ? (
          <Pressable onPress={create} hitSlop={8} accessibilityRole="button" accessibilityLabel="Create" style={styles.side}>
            <Ionicons name="add-circle-outline" size={30} color={fg} style={styles.shadow} />
          </Pressable>
        ) : (
          <View style={styles.side}>
            <Pressable onPress={() => router.push("/(tabs)/profile")} hitSlop={4} accessibilityRole="button" accessibilityLabel="Your profile" style={styles.ring}>
              <View style={styles.ringGap}>
                {profile ? <Avatar name={profile.full_name} url={profile.avatar_url} size={PHOTO} online={false} transition={0} /> : <Ionicons name="person-circle" size={PHOTO} color={colors.faint} />}
              </View>
            </Pressable>
            {/* The create badge, labelled "Create" like the "+" over Reels: the end-to-end flows start from it. */}
            <Pressable onPress={create} hitSlop={8} accessibilityRole="button" accessibilityLabel="Create" accessibilityHint="A post, a reel or a Buzz thread" style={styles.plus}>
              <Ionicons name="add" size={13} color={colors.onBrand} />
            </Pressable>
          </View>
        )}
        {/* Two equal side slots keep the wordmark truly centred. */}
        <View style={styles.middle}>
          <View style={styles.title}>
            <Text style={[styles.wordmark, { color: fg }, overVideo && styles.shadow]} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
          </View>
        </View>
        <View style={styles.side}>
          <HeaderActions color={fg} iconStyle={overVideo ? styles.shadow : undefined} />
        </View>
      </View>
      <View style={styles.row}>
        <SlidingTabs sections={HOME_TABS} section={section} onSelect={onSelect} scrollX={scrollX} pageWidth={pageWidth} tint={ink} labelColor={fg} dimColor={dim} textStyle={overVideo ? styles.shadow : undefined} fontSize={LABEL_SIZE} spread />
      </View>
      {segments.length > 1 ? (
        <View style={styles.toggleRow}>
          <ScopeToggle segments={segments} value={chosen} onChange={choose} overVideo={overVideo} shadow={overVideo ? styles.shadow : undefined} />
        </View>
      ) : null}
    </Animated.View>
  );
});

/**
 * The segmented pill: a thumb that slides on a soft spring to the chosen segment, each segment an icon and a word. Over
 * the Reels video it goes white and glassy like the rest of the bar. Screen readers hear it as a group of radio buttons,
 * the campus one named after the university.
 */
function ScopeToggle({ segments, value, onChange, overVideo, shadow }: { segments: Segment[]; value: Segment["key"]; onChange: (key: Segment["key"]) => void; overVideo: boolean; shadow: StyleProp<TextStyle> }) {
  const styles = useStyles();
  const colors = useColors();
  const index = Math.max(0, segments.findIndex((s) => s.key === value));
  const x = useRef(new Animated.Value(index * SEGMENT)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: index * SEGMENT, useNativeDriver: true, damping: 20, stiffness: 220, mass: 0.8 }).start();
  }, [index, x]);
  const on = overVideo ? colors.onMedia : colors.text;
  const off = overVideo ? colors.onMediaMuted : colors.muted;
  return (
    <View style={[styles.toggle, overVideo && styles.toggleOverVideo]} accessibilityRole="radiogroup" accessibilityLabel="Whose posts to show">
      <Animated.View pointerEvents="none" style={[styles.thumb, overVideo && styles.thumbOverVideo, { transform: [{ translateX: x }] }]} />
      {segments.map((s) => {
        const active = s.key === value;
        return (
          <Pressable key={s.key} onPress={() => onChange(s.key)} accessibilityRole="radio" accessibilityLabel={s.label} accessibilityHint={s.hint} accessibilityState={{ checked: active }} hitSlop={{ top: 6, bottom: 6 }} style={styles.segment}>
            <Ionicons name={s.icon} size={14} color={active ? on : off} style={shadow} />
            <Text style={[styles.segmentText, { color: active ? on : off }, active && styles.segmentTextOn, shadow]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors, scheme) => ({
  // The bar itself is see-through; its transparent hairline keeps the height the same as when the solid look was drawn on it.
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent" },
  // The solid look behind the rows, safe area included, its hairline on the bar's bottom edge: faded by the pager (see `solid`).
  solid: { position: "absolute", top: 0, left: 0, right: 0, bottom: -StyleSheet.hairlineWidth, backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { height: ROW, flexDirection: "row", alignItems: "center", paddingHorizontal: SIDE_PAD },
  side: { width: SIDE, height: ROW, alignItems: "center", justifyContent: "center" },
  middle: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { minHeight: ROW, alignItems: "center", justifyContent: "center", maxWidth: "100%" },
  wordmark: { fontSize: 21, fontWeight: "800", letterSpacing: -0.5, flexShrink: 1 },
  // The ring: a teal-to-violet gradient (plain violet where the platform draws none) with a gap in the bar's colour around the photo.
  ring: { width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, experimental_backgroundImage: `linear-gradient(135deg, ${colors.accentTeal} 0%, ${colors.accent} 100%)` },
  ringGap: { width: PHOTO + 2 * PHOTO_GAP, height: PHOTO + 2 * PHOTO_GAP, borderRadius: PHOTO / 2 + PHOTO_GAP, backgroundColor: colors.bar, alignItems: "center", justifyContent: "center" },
  // Instagram's "+" on the photo's bottom-right corner: a small blue disc with a ring of the bar's colour, so it reads apart from the photo.
  plus: { position: "absolute", right: 0, bottom: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.brand, borderWidth: 2, borderColor: colors.bar, alignItems: "center", justifyContent: "center" },
  shadow: { textShadowColor: colors.mediaScrim, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  // The toggle sits centred in its row, just under the labels' hairline.
  toggleRow: { height: TOGGLE_ROW, alignItems: "center", justifyContent: "center" },
  // The pill on the input fill; over video a glass fill instead. The thumb is a card with a whisper of shadow in light.
  toggle: { flexDirection: "row", padding: TOGGLE_PAD, borderRadius: radius.pill, backgroundColor: colors.input },
  toggleOverVideo: { backgroundColor: colors.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassEdge },
  thumb: { position: "absolute", top: TOGGLE_PAD, bottom: TOGGLE_PAD, left: TOGGLE_PAD, width: SEGMENT, borderRadius: radius.pill, backgroundColor: colors.card, shadowColor: colors.shadow, shadowOpacity: scheme === "dark" ? 0 : 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: scheme === "dark" ? 0 : 2 },
  thumbOverVideo: { backgroundColor: colors.glassHighlight, shadowOpacity: 0, elevation: 0 },
  segment: { width: SEGMENT, height: TOGGLE_HEIGHT - 2 * TOGGLE_PAD, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  segmentText: { fontSize: 13, fontWeight: "600" },
  segmentTextOn: { fontWeight: "700" },
}));
