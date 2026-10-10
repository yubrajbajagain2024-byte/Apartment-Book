import { Text, View } from "react-native";
import { Image } from "expo-image";
import { initials } from "@apartment-book/shared";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useIsOnline } from "@/lib/presence";

const SIZES = { xs: 20, sm: 32, md: 40, lg: 56, xl: 96 } as const;

/**
 * `size` is one of the named steps, or a number of points for the odd in-between size (comment avatars are 36 and 24).
 * `ringColor` is the surface the avatar sits on, so the online dot looks cut out of it: the screen by default (rows, the
 * profile, the feed, bars), `colors.card` on cards and `colors.elevated` on sheets.
 */
export function Avatar({ name, url, size = "md", online, userId, ringColor, transition = 150 }: { name: string | null | undefined; url?: string | null; size?: keyof typeof SIZES | number; online?: boolean; userId?: string; ringColor?: string; transition?: number }) {
  const styles = useStyles();
  const colors = useColors();
  const px = typeof size === "number" ? size : SIZES[size];
  const presence = useIsOnline(userId);
  const showDot = online ?? presence;
  return (
    <View style={{ width: px, height: px }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: px, height: px, borderRadius: px / 2 }} contentFit="cover" transition={transition} accessibilityLabel={name ?? "Avatar"} />
      ) : (
        <View style={[styles.fallback, { width: px, height: px, borderRadius: px / 2 }]}>
          <Text style={{ color: colors.brand, fontWeight: "700", fontSize: px * 0.36 }}>{initials(name)}</Text>
        </View>
      )}
      {showDot ? <View accessibilityLabel="Active now" style={[styles.dot, { width: px * 0.3, height: px * 0.3, borderRadius: px * 0.15 }, ringColor ? { borderColor: ringColor } : null]} /> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  fallback: { backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  // The ring cuts the dot out of the photo in the colour of what the avatar sits on: the screen unless `ringColor` says otherwise.
  dot: { position: "absolute", right: 0, bottom: 0, backgroundColor: colors.green, borderWidth: 2, borderColor: colors.bg },
}));
