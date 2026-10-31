import { StyleSheet, View } from "react-native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icon";
import { AnimatedPressable, usePressScale } from "@/components/ui";
import { hapticSoft } from "@/lib/haptics";
import { collapsedRide } from "@/lib/tab-bar";
import { tabBarCollapse } from "@/lib/tab-bar-collapse";
import { BUZZ_FEED_COPY } from "@apartment-book/shared";
import { HERO_GRADIENT, MaskGlyph, P } from "./ui";

const SIZE = 58;
/** In from the screen's right edge while the whole bar shows. */
const RIGHT = 16;

/**
 * The Buzz page's one create action (UniVerse's FAB with `badgeIcon`): a pen on the Phosphor gradient with the small
 * mask on its corner, floating over the list above the tab bar, X's way: it stays while the feed scrolls, and when the
 * bottom bar collapses to its Home button (lib/tab-bar-collapse.ts) it becomes that button's twin on the UI thread: the
 * same circle, at the same height, as far in from the right edge as Home is from the left (collapsedRide).
 */
export function BuzzFab({ onPress, bottom }: { onPress: () => void; bottom: number }) {
  const press = usePressScale(0.94, 0.92);
  const to = collapsedRide(useSafeAreaInsets(), bottom, SIZE, RIGHT);
  const ride = useAnimatedStyle(() => {
    const c = tabBarCollapse.value;
    return { transform: [{ translateX: c * to.x }, { translateY: c * to.y }, { scale: 1 + c * (to.scale - 1) }] };
  });
  return (
    <Reanimated.View pointerEvents="box-none" style={[styles.wrap, { bottom }, ride]}>
      <AnimatedPressable
        onPress={() => {
          hapticSoft();
          onPress();
        }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={BUZZ_FEED_COPY.newBuzz}
        accessibilityHint="Write an anonymous buzz"
        style={[styles.fab, { opacity: press.opacity, transform: [{ scale: press.scale }] }]}
      >
        <View>
          <Icon name="create-outline" size={26} weight="semibold" color={P.onAccent} />
          <View style={styles.badge}>
            <MaskGlyph size={12} color={P.accent} />
          </View>
        </View>
      </AnimatedPressable>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: RIGHT },
  fab: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.accent,
    experimental_backgroundImage: HERO_GRADIENT,
    borderWidth: 1,
    borderColor: P.accentLine,
    shadowColor: P.accent,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  badge: { position: "absolute", right: -11, bottom: -9, width: 20, height: 20, borderRadius: 10, backgroundColor: P.onAccent, borderWidth: 2, borderColor: P.accent, alignItems: "center", justifyContent: "center" },
});
