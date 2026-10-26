import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { useTabBarInset } from "@/lib/tab-bar";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";
import { AnimatedPressable, usePressScale } from "@/components/ui";

/**
 * The round floating "+" of a feed (Explore's, Orbit's), above the bottom bar: the one prominent action, an aurora disc
 * with a soft shadow that dips under the finger (no haptic). With `href` it goes there (signed out, to log in); with
 * `onPress` it does that instead (Orbit's opens the create sheet, which sends a signed-out person to log in itself).
 */
export function Fab({ label, hint, ...target }: { label: string; hint?: string } & ({ href: string } | { onPress: () => void })) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  const tabBar = useTabBarInset();
  const press = usePressScale(0.92, 1);
  return (
    <AnimatedPressable
      onPress={() => ("onPress" in target ? target.onPress() : router.push((user ? target.href : "/(auth)/login") as never))}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={[styles.fab, { bottom: 20 + tabBar, transform: [{ scale: press.scale }] }]}
    >
      <Icon name="add" size={28} weight="semibold" color={colors.onBrand} />
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
  fab: { position: "absolute", right: 16, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135), alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
}));
