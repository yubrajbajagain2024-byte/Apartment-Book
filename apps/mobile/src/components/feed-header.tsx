import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { useTabBarInset } from "@/lib/tab-bar";
import { hapticTap } from "@/lib/haptics";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";
import { AnimatedPressable, usePressScale } from "@/components/ui";

/**
 * The round floating "+" of a feed (Explore's), above the bottom bar: the one prominent action, a solid brand-blue disc
 * with a soft shadow that dips under the finger with a light tap. Signed out it goes to log in.
 */
export function Fab({ href, label }: { href: string; label: string }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  const tabBar = useTabBarInset();
  const press = usePressScale(0.92, 1);
  return (
    <AnimatedPressable
      onPress={() => {
        hapticTap();
        router.push((user ? href : "/(auth)/login") as never);
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.fab, { bottom: 20 + tabBar, transform: [{ scale: press.scale }] }]}
    >
      <Icon name="add" size={28} weight="semibold" color={colors.onBrand} />
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
  fab: { position: "absolute", right: 16, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
}));
