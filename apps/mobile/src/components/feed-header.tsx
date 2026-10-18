import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { useTabBarInset } from "@/lib/tab-bar";
import { shadows } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** The round floating "+" button of a feed (Housing's), above the bottom bar; signed out it goes to log in. */
export function Fab({ href, label }: { href: string; label: string }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  const tabBar = useTabBarInset();
  return (
    <Pressable onPress={() => router.push((user ? href : "/(auth)/login") as never)} style={[styles.fab, { bottom: 20 + tabBar }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name="add" size={28} color={colors.onBrand} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  fab: { position: "absolute", right: 16, width: 54, height: 54, borderRadius: 27, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, ...shadows.float },
}));
