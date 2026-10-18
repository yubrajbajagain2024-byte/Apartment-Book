import { useEffect, useState, type ComponentProps } from "react";
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TAB_BAR_HEIGHT, TAB_BAR_SIDE, tabBarBottom } from "@/lib/tab-bar";
import { useReduceTransparency } from "@/lib/accessibility";
import { useAppTheme } from "@/lib/theme-provider";
import { hapticSelect } from "@/lib/haptics";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** iOS 26 draws real liquid glass; older iOS and Android get a translucent fill instead (expo-glass-effect falls back to a plain View there). */
const GLASS = isLiquidGlassAvailable();
/** How much more of the bar the tab on screen takes than each of the others, so the pill has room around its icon and label. */
const ACTIVE_SHARE = 1.5;
/** The pill's inset from the bar's top and bottom edges. */
const PILL_INSET = 6;
/** The system tab bars' glyph size: SF Symbols at this size read level with the 11pt labels under them. */
const ICON_SIZE = 26;
/** A soft, settled spring: no overshoot to speak of, so the pill never wobbles past a tab. */
const SPRING = { damping: 20, stiffness: 190, mass: 0.8 };

/**
 * The floating bottom bar, GroupMe style: a rounded glass pill with the five tabs in a row and one lighter capsule that
 * slides from the tab you were on to the one you tapped on a soft spring, while the tabs make room for it (the tab on
 * screen is ACTIVE_SHARE as wide as the others, and the widths follow the same spring, so nothing jumps), with a
 * selection tick and the new tab's symbol bouncing. The navigator's own events still fire (tabPress can be prevented, tabLongPress
 * is sent), each tab keeps its icon, title and badge from its screen options, and screen readers hear
 * "Home, tab, 1 of 5" as before. Everything that moves runs on the UI thread (Reanimated).
 */
export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const reduceTransparency = useReduceTransparency();
  const [rowWidth, setRowWidth] = useState(0);
  const count = state.routes.length;
  // The widths: an idle tab is one unit, the tab on screen ACTIVE_SHARE units, and the row holds them all exactly.
  const unit = rowWidth > 0 ? rowWidth / (count - 1 + ACTIVE_SHARE) : 0;
  const wide = unit * ACTIVE_SHARE;
  // Where the capsule is, in tabs: a whole number at rest, in between while it slides.
  const progress = useSharedValue(state.index);
  useEffect(() => {
    progress.value = withSpring(state.index, SPRING);
  }, [state.index, progress]);
  // Every tab before the capsule is one unit wide, so its left edge is simply progress × unit.
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * unit }] }), [unit]);

  return (
    <View style={[styles.bar, { bottom: tabBarBottom(insets), borderColor: colors.glassEdge }]}>
      {/* An all but opaque fill first: the liquid glass on top samples it, so the bar keeps its glass light, its edge and a
          breath of the feed's colour, while the grey labels stay readable over any content. The glass answers a touch
          (interactive), as the system's own bars do. Reduce Transparency, or no liquid glass, leaves a solid bar. */}
      <View style={[styles.fill, { backgroundColor: reduceTransparency ? colors.bar : colors.glass }]} />
      {GLASS && !reduceTransparency ? <GlassView style={styles.fill} glassEffectStyle="regular" isInteractive colorScheme={isDark ? "dark" : "light"} /> : null}
      {/* The row is measured empty first: a slot drawn before its width is known would keep a flex that overrides the widths later. */}
      <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        {unit > 0 ? <Animated.View pointerEvents="none" style={[styles.pill, { width: wide, backgroundColor: colors.glassHighlight }, pillStyle]} /> : null}
        {unit <= 0 ? null : state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key]!;
          const label = options.title ?? route.name;
          const color = focused ? colors.text : colors.muted;
          const badge = options.tabBarBadge;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (focused || event.defaultPrevented) return;
            // The selection tick of a picker as the capsule moves to the new tab.
            hapticSelect();
            // The route names are not known to the types here (any tab navigator can use this bar).
            (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });
          return (
            <TabSlot key={route.key} index={index} progress={progress} unit={unit} wide={wide}>
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
          );
        })}
      </View>
    </View>
  );
}

/**
 * One tab's slot: one unit wide at rest, growing to `wide` as the capsule arrives and shrinking back as it leaves, on
 * the same spring as the capsule. Only ever a width, never a flex: the widths add up to the row exactly.
 */
function TabSlot({ index, progress, unit, wide, children }: { index: number; progress: SharedValue<number>; unit: number; wide: number; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => {
    // 1 with the capsule on this tab, 0 a whole tab away, in between as it passes.
    const here = interpolate(Math.abs(progress.value - index), [0, 1], [1, 0], Extrapolation.CLAMP);
    return { width: unit + (wide - unit) * here };
  }, [index, unit, wide]);
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
  badgeText: { fontSize: 10, fontWeight: "800" },
});
