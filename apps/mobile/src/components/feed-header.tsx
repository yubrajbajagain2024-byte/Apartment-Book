import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { useTabBarInset } from "@/lib/tab-bar";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";
import { GlassBackdrop, GlassIconButton } from "@/components/glass";

/**
 * The round floating "+" of a feed (Explore's), above the bottom bar: the one prominent action, so it is Liquid Glass
 * tinted with the brand blue (the same blue disc where there is no glass). Signed out it goes to log in.
 */
export function Fab({ href, label }: { href: string; label: string }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  const tabBar = useTabBarInset();
  return (
    <GlassIconButton icon="add" label={label} variant="prominent" size={56} iconSize={28} iconColor={colors.onBrand} onPress={() => router.push((user ? href : "/(auth)/login") as never)} style={[styles.fab, { bottom: 20 + tabBar }]} />
  );
}

const useStyles = makeStyles((colors) => ({
  fab: { position: "absolute", right: 16, shadowColor: colors.shadow, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
}));
