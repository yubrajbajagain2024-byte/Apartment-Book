import { useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import type { ProfileVisibility } from "@apartment-book/shared";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

export type ProfileTabKey = "posts" | "classes" | "reels" | "saved" | "liked" | "listings";

/**
 * Posts first, then the semester's classes, Reels, Saved and Liked, and last the person's Listings (apartments, roommate
 * posts and items for sale): the order the profile asks for. The icons are the tabs themselves (outlined at rest, filled
 * when open), the labels name them for screen readers, empty states and menus.
 */
export const PROFILE_TABS: { key: ProfileTabKey; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "posts", label: "Posts", icon: "grid-outline", activeIcon: "grid" },
  { key: "classes", label: "Classes", icon: "school-outline", activeIcon: "school" },
  { key: "reels", label: "Reels", icon: "film-outline", activeIcon: "film" },
  { key: "saved", label: "Saved", icon: "bookmark-outline", activeIcon: "bookmark" },
  { key: "liked", label: "Liked", icon: "heart-outline", activeIcon: "heart" },
  { key: "listings", label: "Listings", icon: "storefront-outline", activeIcon: "storefront" },
];

/** The small mark beside the open tab's icon: who can see that section. */
const VISIBILITY_ICON: Record<ProfileVisibility, keyof typeof Ionicons.glyphMap> = { private: "lock-closed", friends: "people", public: "globe-outline" };
const VISIBILITY_NAME: Record<ProfileVisibility, string> = { private: "Only me", friends: "Friends", public: "Everyone" };

/** The underline is this share of a tab's width, centred under its icon. */
const UNDERLINE_SHARE = 0.58;
const ICON_SIZE = 24;

/**
 * The row of tabs above a profile's grid, TikTok style: an icon per tab, the open one filled and in the text colour with
 * a short rounded underline, the others outlined and grey, a hairline under the row. The open tab alone carries a small
 * mark of who can see that section (`badges`: a lock for Only me, two people for Friends, a globe for Everyone). A tab
 * with an entry in `locks` is explained to screen readers by it ("Only you can see your saved posts"); `counts` are
 * read out too but not drawn.
 *
 * With `scrollX` (the horizontal pager's offset) and `pageWidth`, the whole row follows the pager on the native side:
 * the underline slides page i under tab i, and each tab's filled look and its mark crossfade with the pager the way
 * Home's labels do (the open look within a quarter page of page i, the resting look from three quarters away, the
 * crossfade over the middle half of a swipe), so a swipe shows the next tab's mark as the finger moves, not once the
 * pager settles. `active` is what screen readers hear as selected, and the look until the pager is measured. The row
 * is opaque (the screen's colour): it stays at the top while the pages scroll under it. It has no space above it: the
 * profile's header leaves the gap, and it goes up with the header.
 */
export function ProfileTabs({
  active,
  onSelect,
  locks,
  badges = {},
  counts = {},
  scrollX,
  pageWidth = 0,
  onLayout,
}: {
  active: ProfileTabKey;
  onSelect: (tab: ProfileTabKey) => void;
  locks: Partial<Record<ProfileTabKey, string>>;
  badges?: Partial<Record<ProfileTabKey, ProfileVisibility>>;
  counts?: Partial<Record<ProfileTabKey, number>>;
  scrollX?: Animated.Value;
  pageWidth?: number;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = rowWidth / PROFILE_TABS.length;
  // The tabs share the row equally, so page i (offset i * pageWidth) puts the underline i tab widths from the first tab.
  // Until the row and the pager are measured the active tab draws its own underline instead.
  const slide = useMemo(() => {
    if (!scrollX || pageWidth <= 0 || tabWidth <= 0) return null;
    const last = PROFILE_TABS.length - 1;
    return scrollX.interpolate({ inputRange: [0, last * pageWidth], outputRange: [0, last * tabWidth], extrapolate: "clamp" });
  }, [scrollX, pageWidth, tabWidth]);
  // Tab i's open look (and its mark) is fully drawn within a quarter page of page i and gone from three quarters away;
  // the resting look is the reverse. Only once pageWidth > 0 (a strictly increasing input range).
  const fades = useMemo(() => {
    if (!scrollX || pageWidth <= 0) return null;
    return PROFILE_TABS.map((_, i) => {
      const inputRange = [i - 0.75, i - 0.25, i + 0.25, i + 0.75].map((p) => p * pageWidth);
      return {
        on: scrollX.interpolate({ inputRange, outputRange: [0, 1, 1, 0], extrapolate: "clamp" }),
        off: scrollX.interpolate({ inputRange, outputRange: [1, 0, 0, 1], extrapolate: "clamp" }),
      };
    });
  }, [scrollX, pageWidth]);

  return (
    <View
      style={styles.row}
      accessibilityRole="tablist"
      onLayout={(e) => {
        const width = e.nativeEvent.layout.width;
        setRowWidth((prev) => (prev === width ? prev : width));
        onLayout?.(e);
      }}
    >
      {PROFILE_TABS.map((t, i) => {
        const selected = t.key === active;
        const lock = locks[t.key];
        const count = counts[t.key];
        const badge = badges[t.key];
        const fade = fades?.[i];
        // Screen readers hear the mark of the open tab only, as before.
        const spokenBadge = selected ? badge : undefined;
        return (
          <Pressable
            key={t.key}
            onPress={() => onSelect(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={spokenBadge ? `${t.label}, ${VISIBILITY_NAME[spokenBadge]}` : t.label}
            accessibilityHint={lock}
            accessibilityValue={count === undefined ? undefined : { text: String(count) }}
            accessibilityState={{ selected }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={styles.tab}
          >
            <View style={styles.iconRow}>
              {fade ? (
                <>
                  {/* Both looks are drawn, one over the other, and crossfade with the pager on the UI thread: nothing re-renders while the finger moves. */}
                  <Animated.View style={{ opacity: fade.off }}>
                    <Icon name={t.icon} size={ICON_SIZE} color={colors.muted} />
                  </Animated.View>
                  <Animated.View style={[styles.over, { opacity: fade.on }]}>
                    <Icon name={t.activeIcon} size={ICON_SIZE} color={colors.text} />
                  </Animated.View>
                  {badge ? (
                    <Animated.View style={[styles.badge, { opacity: fade.on }]}>
                      <Icon name={VISIBILITY_ICON[badge]} size={12} color={colors.muted} />
                    </Animated.View>
                  ) : null}
                </>
              ) : (
                <>
                  <Icon name={selected ? t.activeIcon : t.icon} size={ICON_SIZE} color={selected ? colors.text : colors.muted} />
                  {selected && badge ? (
                    <View style={styles.badge}>
                      <Icon name={VISIBILITY_ICON[badge]} size={12} color={colors.muted} />
                    </View>
                  ) : null}
                </>
              )}
            </View>
            {/* Keeps the tab's height; it is the underline itself only until the sliding one can be drawn. */}
            <View style={[styles.underline, !slide && selected && styles.underlineActive]} />
          </Pressable>
        );
      })}
      {slide ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.slider, { width: tabWidth * UNDERLINE_SHARE, left: (tabWidth * (1 - UNDERLINE_SHARE)) / 2, transform: [{ translateX: slide }] }]}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Opaque, so the squares scrolling up under the row (once the header has gone) do not show through.
  row: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.bg },
  tab: { flex: 1, alignItems: "center", justifyContent: "flex-end", paddingTop: 12, gap: 10 },
  // The mark sits just right of the icon; the icon stays centred in the tab, so the row reads evenly whichever tab is open.
  iconRow: { alignItems: "center", justifyContent: "center" },
  // The filled look, drawn over the outlined one in the same spot.
  over: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", right: -16, top: -2 },
  // UNDERLINE_SHARE of the tab.
  underline: { height: 3, width: "58%", borderRadius: 2, backgroundColor: "transparent" },
  underlineActive: { backgroundColor: colors.text },
  // On the row's bottom edge, where each tab's own underline sits.
  slider: { position: "absolute", bottom: 0, height: 3, borderRadius: 2, backgroundColor: colors.text },
}));
