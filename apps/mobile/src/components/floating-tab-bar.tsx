import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type ColorValue } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TAB_BAR_COLLAPSED_SCALE, TAB_BAR_HEIGHT, TAB_BAR_SIDE, tabBarBottom } from "@/lib/tab-bar";
import { setTabBarCollapsed, tabBarCollapse, useTabBarCollapsed } from "@/lib/tab-bar-collapse";
import { useReduceMotion, useReduceTransparency } from "@/lib/accessibility";
import { auroraGradient } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * An action in the middle of the bar (a "+", say; the app's bar has none: creating starts from Home): its icon alone, centred in its slot (the label is for screen
 * readers). It opens something rather than going somewhere, so it never takes the capsule.
 */
export type TabBarAction = { label: string; hint?: string; icon: (p: { color: ColorValue; size: number }) => ReactNode; onPress: () => void };

/**
 * The bar as it is right now (its tabs, the one on screen, their icons and badges, any middle action), for a screen drawn over the
 * tabs that keeps the bar in view: the full-screen viewer (app/reels/[id].tsx) is a modal above them, so the bar itself
 * is under it, and the viewer draws this same bar in the same place instead. Published by the tabs' own bar each time
 * it renders (a new tab, a new unread count), and gone with it.
 */
export type TabBarMirror = { props: TabBarProps; action?: TabBarAction };
/** By the navigator's first tab's route key: a screen over the tabs copies the bar of the tabs right under it. */
const mirrors = new Map<string, TabBarMirror>();
let latestMirror: string | null = null;
const mirrorListeners = new Set<() => void>();
function publishMirror(key: string, next: TabBarMirror | null) {
  if (next) {
    mirrors.set(key, next);
    latestMirror = key;
  } else {
    mirrors.delete(key);
    if (latestMirror === key) latestMirror = mirrors.size > 0 ? [...mirrors.keys()].at(-1)! : null;
  }
  mirrorListeners.forEach((l) => l());
}
function subscribeMirror(listener: () => void) {
  mirrorListeners.add(listener);
  return () => {
    mirrorListeners.delete(listener);
  };
}
/** The bar of the tabs whose first tab has this route key, or (no key known) the one that rendered last. */
export function useTabBarMirror(firstTabKey?: string | null): TabBarMirror | null {
  const read = () => (firstTabKey ? mirrors.get(firstTabKey) : undefined) ?? (latestMirror ? (mirrors.get(latestMirror) ?? null) : null);
  return useSyncExternalStore(subscribeMirror, read, read);
}

/** iOS 26 draws real liquid glass; older iOS and Android get a translucent fill instead (expo-glass-effect falls back to a plain View there). */
const GLASS = isLiquidGlassAvailable();
/** How much more of the bar the tab on screen takes than each of the others, so the pill has room around its icon and label. */
const ACTIVE_SHARE = 1.5;
/** The pill's inset from the bar's top and bottom edges. */
const PILL_INSET = 6;
/** The system tab bars' glyph size: SF Symbols at this size read level with the 11pt labels under them. */
const ICON_SIZE = 26;
/** The row's inset from the bar's sides. */
const ROW_INSET = 2;
/** What a label adds under its icon (its line and the gap above it): the collapsed bar drops the icon by half of it, to its middle. */
const LABEL_LINE = 13;
const LABEL_GAP = 2;
const LABEL_ROOM = LABEL_LINE + LABEL_GAP;
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
 * `action`, when given, sits in the middle of the row, between the two halves of the tabs, its icon centred in a slot
 * as wide as an idle tab: it opens something rather than going somewhere, so the capsule passes behind it but never
 * stops on it, and it stays put while the tabs on either side make room (see shareRow). The navigator's own events still fire
 * (tabPress can be prevented, tabLongPress is sent), each tab keeps its icon, title and badge from its screen options,
 * and screen readers hear "Home, tab, 1 of 5". Everything that moves runs on the UI thread (Reanimated).
 *
 * The bar collapses like Reddit's while a feed scrolls on (lib/tab-bar-collapse.ts): it narrows to a circle as tall
 * as itself and shrinks a little from its bottom left corner, the row sliding so the tab on screen stays in the circle's
 * middle while the labels and the capsule fade, so only that tab's icon is left. The row keeps its measured width the
 * whole time (the bar clips it), so no tab is laid out again while it moves, and the other tabs fade as it goes. Home,
 * Explore and Events collapse it, each to its own icon. A tap on the circle brings the whole bar back. A copy of the bar
 * (`onSelect`, over the full-screen viewer) never collapses.
 */
export function FloatingTabBar({ state, descriptors, emitter, navigateToTab, action, onSelect, ...rest }: TabBarProps & { action?: TabBarAction; onSelect?: (routeKey: string, focused: boolean) => void }) {
  const insets = useSafeAreaInsets();
  // The tabs' own bar publishes itself for the screens drawn over it (see TabBarMirror); a copy (`onSelect`) does not.
  // Under its first tab's route key, which names this navigator (the state handed to the bar carries only its routes
  // and index); a screen over these tabs finds the same key in the root stack (see app/reels/[id].tsx).
  const navigatorKey = state.routes[0]?.key ?? "tabs";
  useEffect(() => {
    if (!onSelect) publishMirror(navigatorKey, { props: { state, descriptors, emitter, navigateToTab, ...rest } as TabBarProps, action });
  });
  useEffect(() => {
    if (onSelect) return;
    return () => publishMirror(navigatorKey, null);
  }, [onSelect, navigatorKey]);
  const { colors, isDark } = useAppTheme();
  const reduceTransparency = useReduceTransparency();
  const reduceMotion = useReduceMotion();
  const [rowWidth, setRowWidth] = useState(0);
  const count = state.routes.length;
  // The first tab after the middle slot (with four tabs: Home, Explore | + | Messages, Profile), or none; the slot is as wide as an idle tab.
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
  // Collapsing (see the note above): 0 with the whole bar, 1 collapsed. A copy of the bar stays whole.
  const collapsible = !onSelect;
  const collapsed = useTabBarCollapsed() && collapsible;
  const { width: windowWidth } = useWindowDimensions();
  const barWidth = windowWidth - TAB_BAR_SIDE * 2;
  // The tab on screen's middle in the row at rest: the collapsed circle holds it in its own middle.
  const focusRest = restOf(groups, state.index);
  const focusCenter = ROW_INSET + focusRest.left + focusRest.width / 2;
  const shrinkStyle = useAnimatedStyle(() => {
    const c = collapsible ? tabBarCollapse.value : 0;
    return { width: interpolate(c, [0, 1], [barWidth, TAB_BAR_HEIGHT]), transform: [{ scale: interpolate(c, [0, 1], [1, TAB_BAR_COLLAPSED_SCALE]) }] };
  });
  const rowSlide = useAnimatedStyle(() => ({ transform: [{ translateX: -(collapsible ? tabBarCollapse.value : 0) * (focusCenter - TAB_BAR_HEIGHT / 2) }] }));
  const labelFade = useAnimatedStyle(() => ({ opacity: 1 - (collapsible ? tabBarCollapse.value : 0) }));
  const iconDrop = useAnimatedStyle(() => ({ transform: [{ translateY: ((collapsible ? tabBarCollapse.value : 0) * LABEL_ROOM) / 2 }] }));
  const pillStyle = useAnimatedStyle(() => ({
    width: Math.max(0, rightEdge.value - leftEdge.value),
    transform: [{ translateX: leftEdge.value }],
    opacity: 1 - (collapsible ? tabBarCollapse.value : 0),
  }));

  return (
    <Animated.View style={[styles.bar, { bottom: tabBarBottom(insets), borderColor: colors.glassEdge }, shrinkStyle]}>
      {/* An all but opaque fill first: the liquid glass on top samples it, so the bar keeps its glass light, its edge and a
          breath of the feed's colour, while the grey labels stay readable over any content. The glass answers a touch
          (interactive), as the system's own bars do. Reduce Transparency, or no liquid glass, leaves a solid bar. */}
      <View style={[styles.fill, { backgroundColor: reduceTransparency ? colors.bar : colors.glass }]} />
      {GLASS && !reduceTransparency ? <GlassView style={styles.fill} glassEffectStyle="regular" isInteractive colorScheme={isDark ? "dark" : "light"} /> : null}
      {/* The row is measured empty first: a slot drawn before its width is known would keep a flex that overrides the widths later.
          It is as wide as the whole bar even while the bar is collapsed: the bar clips it, and it slides instead. */}
      <Animated.View style={[styles.row, { width: barWidth - ROW_INSET * 2 }, rowSlide]} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        {/* The capsule behind the tab on screen: a faint wash of the aurora (the icon and label over it stay the text colour). */}
        {rowWidth > 0 ? <Animated.View pointerEvents="none" style={[styles.pill, { experimental_backgroundImage: auroraGradient(colors.auroraWash, 110) }, pillStyle]} /> : null}
        {rowWidth <= 0 ? null : state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key]!;
          const label = options.title ?? route.name;
          const color = focused ? colors.text : colors.muted;
          const badge = options.tabBarBadge;
          const onPress = () => {
            // A copy of the bar over another screen decides for itself what a tab does there (see TabBarMirror).
            if (onSelect) return onSelect(route.key, focused);
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (focused || event.defaultPrevented) return;
            // No haptic here: switching tabs is silent, the capsule's glide is the feedback. The navigator switches by
            // route key and keeps the tab's params, as its own bar does.
            navigateToTab(route.key);
          };
          const onLongPress = () => (onSelect ? undefined : emitter.emit({ type: "tabLongPress", target: route.key }));
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
              <TabSlot index={index} progress={progress} group={group} fades={collapsible && !focused}>
                <Pressable
                  onPress={onPress}
                  onLongPress={onLongPress}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: focused }}
                  accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label}, tab, ${index + 1} of ${count}`}
                  testID={options.tabBarButtonTestID}
                  style={styles.tab}
                >
                  {/* The tab on screen drops its icon to the middle as the bar collapses, and its label fades (the other tabs fade and are clipped away). */}
                  <Animated.View style={focused ? iconDrop : undefined}>
                    {options.tabBarIcon ? options.tabBarIcon({ focused, color, size: ICON_SIZE }) : null}
                    {badge !== undefined && badge !== null ? (
                      <View style={[styles.badge, { backgroundColor: colors.dangerFill, borderColor: colors.bar }]}>
                        <Text style={[styles.badgeText, { color: colors.onBrand }]} numberOfLines={1}>
                          {String(badge)}
                        </Text>
                      </View>
                    ) : null}
                  </Animated.View>
                  {/* One line that shrinks a little rather than ending in "…" when a tab is narrow ("Messages" next to the lit tab on a small phone). */}
                  <Animated.Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={1.2} style={[styles.label, focused && styles.labelOn, { color }, focused ? labelFade : null]}>
                    {label}
                  </Animated.Text>
                </Pressable>
              </TabSlot>
            </Fragment>
          );
        })}
      </Animated.View>
      {/* Collapsed, the circle is one button: a tap brings the whole bar back (the tabs under it are clipped away anyway). */}
      {collapsed ? <Pressable onPress={() => setTabBarCollapsed(false)} accessibilityRole="button" accessibilityLabel="Show all tabs" style={StyleSheet.absoluteFill} /> : null}
    </Animated.View>
  );
}

/**
 * One tab's slot: its group's idle width with no tab of the group on screen, growing as the capsule arrives and
 * shrinking back as it leaves, on the same spring as the capsule; while another tab of the group is on screen it gives
 * up its share of the room. Only ever a width, never a flex: each group's widths add up to the group exactly, at rest
 * and all the way through a move, so nothing beside it shifts.
 */
function TabSlot({ index, progress, group, fades, children }: { index: number; progress: SharedValue<number>; group: Group; fades: boolean; children: ReactNode }) {
  const { members, idle, delta } = group;
  const style = useAnimatedStyle(() => {
    // 1 with the capsule on tab i, 0 a whole tab away, in between as it passes.
    const here = (i: number) => interpolate(Math.abs(progress.value - i), [0, 1], [1, 0], Extrapolation.CLAMP);
    // Every tab but the one on screen fades out as the bar collapses (and back as it returns), so none of them slides
    // through the shrinking bar on its way out: only the tab on screen is left, whichever it is.
    const opacity = fades ? 1 - tabBarCollapse.value : 1;
    if (members.length < 2) return { width: idle, opacity };
    let others = 0;
    for (let k = 0; k < members.length; k++) if (members[k] !== index) others += here(members[k]!);
    return { width: idle + delta * (here(index) - others / (members.length - 1)), opacity };
    // No dependency list: Reanimated follows what the worklet captures (index, members, idle, delta).
  });
  return <Animated.View style={[styles.slot, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  // Floating over the content: a pill with a hairline edge, clipped so the glass takes its shape. No shadow (iOS would clip it).
  // Its width is animated (it collapses to a circle), and it shrinks from its bottom left corner, where it stays.
  bar: { position: "absolute", left: TAB_BAR_SIDE, height: TAB_BAR_HEIGHT, borderRadius: TAB_BAR_HEIGHT / 2, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, transformOrigin: "left bottom" },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: TAB_BAR_HEIGHT / 2 },
  row: { position: "absolute", top: 0, bottom: 0, left: ROW_INSET, flexDirection: "row" },
  pill: { position: "absolute", top: PILL_INSET, bottom: PILL_INSET, left: 0, borderRadius: 999 },
  slot: { height: "100%", flexGrow: 0, flexShrink: 0 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  // 11pt: small labels read crisp a step larger; the tab on screen is heavier.
  label: { fontSize: 11, lineHeight: LABEL_LINE, fontWeight: "600", letterSpacing: 0, marginTop: LABEL_GAP },
  labelOn: { fontWeight: "700" },
  badge: { position: "absolute", top: -5, right: -10, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
