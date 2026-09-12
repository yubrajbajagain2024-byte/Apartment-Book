import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { initials } from "@apartment-book/shared";
import { colors } from "@/lib/theme";
import { useIsOnline } from "@/lib/presence";

const SIZES = { xs: 20, sm: 32, md: 40, lg: 56, xl: 96 } as const;

export function Avatar({ name, url, size = "md", online, userId }: { name: string | null | undefined; url?: string | null; size?: keyof typeof SIZES; online?: boolean; userId?: string }) {
  const px = SIZES[size];
  const presence = useIsOnline(userId);
  const showDot = online ?? presence;
  return (
    <View style={{ width: px, height: px }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: px, height: px, borderRadius: px / 2 }} contentFit="cover" transition={150} accessibilityLabel={name ?? "Avatar"} />
      ) : (
        <View style={[styles.fallback, { width: px, height: px, borderRadius: px / 2 }]}>
          <Text style={{ color: colors.brand, fontWeight: "700", fontSize: px * 0.36 }}>{initials(name)}</Text>
        </View>
      )}
      {showDot ? <View accessibilityLabel="Active now" style={[styles.dot, { width: px * 0.3, height: px * 0.3, borderRadius: px * 0.15 }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", right: 0, bottom: 0, backgroundColor: colors.green, borderWidth: 2, borderColor: "#fff" },
});
