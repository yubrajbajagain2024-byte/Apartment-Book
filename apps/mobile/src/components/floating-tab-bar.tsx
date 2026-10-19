import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TAB_BAR_HEIGHT, TAB_BAR_SIDE, tabBarBottom } from "@/lib/tab-bar";
import { useReduceMotion, useReduceTransparency } from "@/lib/accessibility";
import { auroraGradient } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * An action in the middle of the bar (the app's "+"): its icon alone, centred in its slot (the label is for screen
 * readers). It opens something rather than going somewhere, so it never takes the capsule.
 */
export type TabBarAction = { label: string; hint?: string; icon: (p: { color: ColorValue; size: number }) => ReactNode; onPress: () => void };

/** iOS 26 draws real liquid glass; older iOS and Android get a translucent fill instead (expo-glass-effect falls back to a plain View there). */
const GLASS = isLiquidGlassAvailable();
/** How much more of the bar the tab on screen takes than each of the others, so the pill has room around its icon and label. */
const ACTIVE_SHARE = 1.5;
/** The pill's inset from the bar's top and bottom edges. */
const PILL_INSET = 6;
/** The system tab bars' glyph size: SF Symbols at this size read level with the 11pt labels under them. */
const ICON_SIZE = 26;
/** How the tabs make room for the one picked: critically damped, so no tab ever overshoots or wobbles as it settles. */
const SPRING = { damping: 31, stiffness: 300, mass: 0.8 };
/**
 * The capsule glides from the tab you were on to the one you tapped, each of its two edges on its own spring: the edge
 * in the direction of travel leads and the other follows a beat behind, so the capsule stretches a touch as it moves and
 * draws itself back in as it lands, like a drop of liquid. Both springs are close to critically damped: no wobble.
 */
const LEAD = { damping: 33, stiffness: 400, mass: 0.8 };
const TRAIL = { damping: 29, stiffness: 290, mass: 0.8 };

/**
 * A run of tabs side by side: where it starts in the row, its tabs (by index), each one's width with none of them on
 * screen, and how much the one on screen takes from the others (it ends up ACTIVE_SHARE as wide as each of them).
 */
type Group = { start: number; members: number[]; idle: number; delta: number };

function groupOf(members: number[], start: number, width: number): Group {
  const idle = width / members.length;
  const n = members.length;
  // Solved from (idle + delta) = ACTIVE_SHARE × (idle - delta / (n - 1)): the tab on screen grows by what the rest give up.
  const delta = n > 1 ? (idle * (ACTIVE_SHARE - 1) * (n - 1)) / (n - 1 + ACTIVE_SHARE) : 0;
  return { start, members, idle, delta };
}

/**
 * How the row is shared out. Without a middle slot every tab is in one group as wide as the row: an idle tab one unit,
 * the tab on screen ACTIVE_SHARE units. With one (`center` wide, an idle tab's share), the tabs before it and after it
 * are two groups of half the rest each, so the middle slot never moves: the tab on screen makes room within its own
 * half, and the other half rests evenly.
 */
function shareRow(width: number, count: number, middle: number, center: number): Group[] {
  const all = Array.from({ length: count }, (_, i) => i);
  if (middle < 0) return [groupOf(all, 0, width)];
  const half = (width - center) / 2;
  return [groupOf(all.slice(0, middle), 0, half), groupOf(all.slice(middle), half + center, half)];
}

/** Where the capsule sits on tab `index` at rest: the tabs of its group before it are each narrow, and it is wide. */
function restOf(groups: Group[], index: number): { left: number; width: number } {
  const g = groups.find((x) => x.members.includes(index)) ?? groups[0]!;
  const narrow = g.members.length > 1 ? g.idle - g.delta / (g.members.length - 1) : g.idle;
  return { left: g.start + g.members.indexOf(index) * narrow, width: g.idle + g.delta };
}

/**
 * The floating bottom bar, GroupMe style: a rounded glass pill with the tabs in a row and one capsule behind the tab on
 * screen. The capsule never blinks or jumps: it glides from the tab you were on to the one you tap (see LEAD and TRAIL),
 * while the tabs make room for it (the tab on screen is ACTIVE_SHARE as wide as the others) on a critically damped
 * spring. Only the new tab's symbol bounces (silently: no haptic); the tab you left returns to its plain look at once.
 * `action` sits in the middle of the row, between the two halves of the tabs (the app's "+"), its icon centred in a slot
 * as wide as an idle tab: it opens something rather than going somewhere, so the capsule passes behind it but never
 * stops on it, and it stays put while the tabs on either side make room (see shareRow). The navigator's own events still fire
 * (tabPress can be prevented, tabLongPress is sent), each tab keeps its icon, title and badge from its screen options,
 * and screen readers hear "Home, tab, 1 of 4". Everything that moves runs on the UI thread (Reanimated).
 */
export function FloatingTabBar({ state, descriptors, navigation, action }: TabBarProps & { action?: TabBarAction }) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const reduceTransparency = useReduceTransparency();
  const reduceMotion = useReduceMotion();
  const [rowWidth, setRowWidth] = useState(0);
  const count = state.routes.length;
  // The first tab after the middle slot (Home, Explore | + | Messages, Profile), or none; the slot is as wide as an idle tab.
  const middle = action ? Math.ceil(count / 2) : -1;
  const centerWidth = action ? rowWidth / (count + 1) : 0;
  const groups = useMemo(() => shareRow(rowWidth, count, middle, centerWidth), [rowWidth, count, middle, centerWidth]);
  // How far the tabs have made room, in tabs: a whole number at rest, in between while the widths change.
  const progress = useSharedValue(state.index);
  // The capsule's left and right edges, in points from the row's start. At rest it covers the tab on screen exactly.
  const leftEdge = useSharedValue(0);
  const rightEdge = useSharedValue(0);
  const shown = useRef(state.index);
  // Measured, or measured again (a rotation): the capsule simply sits on the tab on screen.
  useLayoutEffect(() => {
    const rest = restOf(groups, shown.current);
    leftEdge.value = rest.left;
    rightEdge.value = rest.left + rest.width;
  }, [groups, leftEdge, rightEdge]);
  // A new tab: the capsule glides there from where it is (a second tap mid-glide simply redirects it). Before the frame is
  // drawn, so it starts moving the moment the new tab lights up.
  useLayoutEffect(() => {
    const from = shown.current;
    const to = state.index;
    shown.current = to;
    if (from === to) return;
    const rest = restOf(groups, to);
    const left = rest.left;
    const right = left + rest.width;
    if (reduceMotion || rowWidth <= 0) {
      progress.value = to;
      leftEdge.value = left;
      rightEdge.value = right;
      return;
    }
    progress.value = withSpring(to, SPRING);
    const forward = to > from;
    leftEdge.value = withSpring(left, forward ? TRAIL : LEAD);
    rightEdge.value = withSpring(right, forward ? LEAD : TRAIL);
  }, [state.index, groups, rowWidth, reduceMotion, progress, leftEdge, rightEdge]);
  const pillStyle = useAnimatedStyle(() => ({
    width: Math.max(0, rightEdge.value - leftEdge.value),
    transform: [{ translateX: leftEdge.value }],
  }));

  return (
    <View style={[styles.bar, { bottom: tabBarBottom(insets), borderColor: colors.glassEdge }]}>
      {/* An all but opaque fill first: the liquid glass on top samples it, so the bar keeps its glass light, its edge and a
          breath of the feed's colour, while the grey labels stay readable over any content. The glass answers a touch
          (interactive), as the system's own bars do. Reduce Transparency, or no liquid glass, leaves a solid bar. */}
      <View style={[styles.fill, { backgroundColor: reduceTransparency ? colors.bar : colors.glass }]} />
      {GLASS && !reduceTransparency ? <GlassView style={styles.fill} glassEffectStyle="regular" isInteractive colorScheme={isDark ? "dark" : "light"} /> : null}
      {/* The row is measured empty first: a slot drawn before its width is known would keep a flex that overrides the widths later. */}
      <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        {/* The capsule behind the tab on screen: a faint wash of the aurora (the icon and label over it stay the text colour). */}
        {rowWidth > 0 ? <Animated.View pointerEvents="none" style={[styles.pill, { experimental_backgroundImage: auroraGradient(colors.auroraWash, 110) }, pillStyle]} /> : null}
        {rowWidth <= 0 ? null : state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key]!;
          const label = options.title ?? route.name;
          const color = focused ? colors.text : colors.muted;
          const badge = options.tabBarBadge;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (focused || event.defaultPrevented) return;
            // No haptic here: switching tabs is silent, the capsule's glide is the feedback.
            // The route names are not known to the types here (any tab navigator can use this bar).
            (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });
          const group = groups.find((g) => g.members.includes(index)) ?? groups[0]!;
          return (
            <Fragment key={route.key}>
              {/* The middle slot, between the two halves: an idle tab's width whichever tab is on screen. */}
              {index === middle && action ? (
                <View style={[styles.slot, { width: centerWidth }]}>
                  <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} accessibilityHint={action.hint} style={styles.tab}>
                    {action.icon({ color: colors.muted, size: ICON_SIZE })}
                  </Pressable>
                </View>
              ) : null}
              <TabSlot index={index} progress={progress} group={group}>
                <Pressable
                  onPress={onPress}
                  onLongPress={onLongPress}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: focused }}
                  accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label}, tab, ${index + 1} of ${count}`}
                  testID={options.tabBarButtonTestID}
                  style={styles.tab}
                >
                  <View>
                    {options.tabBarIcon ? options.tabBarIcon({ focused, color, size: ICON_SIZE }) : null}
                    {badge !== undefined && badge !== null ? (
                      <View style={[styles.badge, { backgroundColor: colors.dangerFill, borderColor: colors.bar }]}>
                        <Text style={[styles.badgeText, { color: colors.onBrand }]} numberOfLines={1}>
                          {String(badge)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {/* One line that shrinks a little rather than ending in "…" when a tab is narrow ("Messages" next to the lit tab on a small phone). */}
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={1.2} style={[styles.label, focused && styles.labelOn, { color }]}>
                    {label}
                  </Text>
                </Pressable>
              </TabSlot>
            </Fragment>
          );
        })}
      </View>
    </View>
  );
}

/**
 * One tab's slot: its group's idle width with no tab of the group on screen, growing as the capsule arrives and
 * shrinking back as it leaves, on the same spring as the capsule; while another tab of the group is on screen it gives
 * up its share of the room. Only ever a width, never a flex: each group's widths add up to the group exactly, at rest
 * and all the way through a move, so nothing beside it shifts.
 */
function TabSlot({ index, progress, group, children }: { index: number; progress: SharedValue<number>; group: Group; children: ReactNode }) {
  const { members, idle, delta } = group;
  const style = useAnimatedStyle(() => {
    // 1 with the capsule on tab i, 0 a whole tab away, in between as it passes.
    const here = (i: number) => interpolate(Math.abs(progress.value - i), [0, 1], [1, 0], Extrapolation.CLAMP);
    if (members.length < 2) return { width: idle };
    let others = 0;
    for (let k = 0; k < members.length; k++) if (members[k] !== index) others += here(members[k]!);
    return { width: idle + delta * (here(index) - others / (members.length - 1)) };
  }, [index, members, idle, delta]);
  return <Animated.View style={[styles.slot, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  // Floating over the content: a pill with a hairline edge, clipped so the glass takes its shape. No shadow (iOS would clip it).
  bar: { position: "absolute", left: TAB_BAR_SIDE, right: TAB_BAR_SIDE, height: TAB_BAR_HEIGHT, borderRadius: TAB_BAR_HEIGHT / 2, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: TAB_BAR_HEIGHT / 2 },
  row: { flex: 1, flexDirection: "row", marginHorizontal: 2 },
  pill: { position: "absolute", top: PILL_INSET, bottom: PILL_INSET, left: 0, borderRadius: 999 },
  slot: { height: "100%", flexGrow: 0, flexShrink: 0 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  // 11pt: small labels read crisp a step larger; the tab on screen is heavier.
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0, marginTop: 2 },
  labelOn: { fontWeight: "700" },
  badge: { position: "absolute", top: -5, right: -10, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
