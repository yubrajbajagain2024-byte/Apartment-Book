import { Animated, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icon";
import { AnimatedPressable, usePressScale } from "@/components/ui";
import { hapticSoft } from "@/lib/haptics";
import { BUZZ_FEED_COPY } from "@apartment-book/shared";
import { HERO_GRADIENT, MaskGlyph, P } from "./ui";

/**
 * The Buzz page's one create action (UniVerse's FAB with `badgeIcon`): a pen on the Phosphor gradient with the small
 * mask on its corner, floating over the list above the tab bar. `translateY` slides it away while the list scrolls down
 * and back as it scrolls up (on the native driver).
 */
export function BuzzFab({ onPress, bottom, translateY }: { onPress: () => void; bottom: number; translateY?: Animated.AnimatedInterpolation<number> | Animated.Value }) {
  const press = usePressScale(0.94, 0.92);
  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { bottom }, translateY ? { transform: [{ translateY }] } : null]}>
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: 16 },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
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
