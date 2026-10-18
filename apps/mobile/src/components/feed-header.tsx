import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { useTabBarInset } from "@/lib/tab-bar";
import { shadows } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { GlassIconButton } from "@/components/glass";

/**
 * The round floating "+" of a feed (Explore's), above the bottom bar: the one prominent action, so it is Liquid Glass
 * tinted with the ink (a solid ink disc where there is no glass). Signed out it goes to log in.
 */
export function Fab({ href, label }: { href: string; label: string }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  const tabBar = useTabBarInset();
  return (
    <GlassIconButton icon="add" label={label} variant="prominent" size={56} iconSize={26} iconColor={colors.onBrand} onPress={() => router.push((user ? href : "/(auth)/login") as never)} style={[styles.fab, { bottom: 20 + tabBar }]} />
  );
}

const useStyles = makeStyles((colors) => ({
  fab: { position: "absolute", right: 16, shadowColor: colors.shadow, ...shadows.float },
}));
