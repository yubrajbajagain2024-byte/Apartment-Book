import { useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { compactCount } from "@apartment-book/shared";
import { makeStyles, useColors } from "@/lib/theme-provider";

export type ProfileTabKey = "posts" | "classes" | "reels" | "saved" | "liked" | "listings";

/**
 * Posts first, then the semester's classes, Reels, Saved and Liked, and last the person's Listings (apartments, roommate
 * posts and items for sale): the order the profile asks for. The icons name each tab elsewhere (empty states, menus).
 */
export const PROFILE_TABS: { key: ProfileTabKey; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "posts", label: "Posts", icon: "grid-outline", activeIcon: "grid" },
  { key: "classes", label: "Classes", icon: "school-outline", activeIcon: "school" },
  { key: "reels", label: "Reels", icon: "film-outline", activeIcon: "film" },
  { key: "saved", label: "Saved", icon: "bookmark-outline", activeIcon: "bookmark" },
  { key: "liked", label: "Liked", icon: "heart-outline", activeIcon: "heart" },
  { key: "listings", label: "Listings", icon: "storefront-outline", activeIcon: "storefront" },
];

/** The underline is this share of a tab's width, centred under its label. */
const UNDERLINE_SHARE = 0.58;

/**
 * The row of tabs above a profile's grid: each tab's name with its count beside it ("Reels 2"), the open one bold with a
 * short rounded underline, the others grey, a hairline under the row. A tab with an entry in `locks` gets a small lock: on
 * your own profile when it is not public, on someone else's when you may not open it. The entry is what VoiceOver adds
 * ("Only you can see your saved posts"). `counts` holds the numbers that are known (Posts, Reels, Classes, Listings).
 *
 * With `scrollX` (the horizontal pager's offset) and `pageWidth`, the underline slides with the pager on the native side,
 * page i under tab i, so it follows the finger during a swipe; the labels change once the pager settles on a tab (`active`).
 * The row is opaque (the screen's colour): it stays at the top while the pages scroll under it. It has no space above it:
 * the profile's header leaves the gap, and it goes up with the header.
 */
export function ProfileTabs({
  active,
  onSelect,
  locks,
  counts = {},
  scrollX,
  pageWidth = 0,
  onLayout,
}: {
  active: ProfileTabKey;
  onSelect: (tab: ProfileTabKey) => void;
  locks: Partial<Record<ProfileTabKey, string>>;
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
      {PROFILE_TABS.map((t) => {
        const selected = t.key === active;
        const lock = locks[t.key];
        const count = counts[t.key];
        return (
          <Pressable
            key={t.key}
            onPress={() => onSelect(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityHint={lock}
            accessibilityValue={count === undefined ? undefined : { text: String(count) }}
            accessibilityState={{ selected }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={styles.tab}
          >
            <View style={styles.labelRow}>
              {/* Six names share the row: a long one ("Listings 12") shrinks a little rather than wrapping. */}
              <Text style={[styles.label, selected && styles.labelOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                {t.label}
                {count === undefined ? null : <Text style={[styles.count, selected && styles.countOn]}>{` ${compactCount(count)}`}</Text>}
              </Text>
              {lock ? <Ionicons name="lock-closed" size={10} color={selected ? colors.text : colors.muted} style={styles.lock} /> : null}
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
  labelRow: { flexDirection: "row", alignItems: "center", maxWidth: "100%", paddingHorizontal: 2 },
  label: { fontSize: 14, fontWeight: "600", color: colors.muted, flexShrink: 1 },
  labelOn: { color: colors.text, fontWeight: "800" },
  count: { fontSize: 13, fontWeight: "500", color: colors.faint },
  countOn: { color: colors.muted },
  lock: { marginLeft: 3 },
  // UNDERLINE_SHARE of the tab.
  underline: { height: 3, width: "58%", borderRadius: 2, backgroundColor: "transparent" },
  underlineActive: { backgroundColor: colors.text },
  // On the row's bottom edge, where each tab's own underline sits.
  slider: { position: "absolute", bottom: 0, height: 3, borderRadius: 2, backgroundColor: colors.text },
}));
