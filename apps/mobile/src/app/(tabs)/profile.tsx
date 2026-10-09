import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Avatar } from "@/components/avatar";
import { Button, Card, EmptyState } from "@/components/ui";
import { useSession } from "@/lib/session";
import { SITE_URL } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function ProfileTab() {
  const { user, profile, loading, signOut } = useSession();
  const router = useRouter();
  if (!loading && !user) {
    return (
      <EmptyState
        icon="person-circle-outline"
        title="Join Apartment Book"
        body="Sign in with your university email to post, save and message."
        action={
          <View style={{ gap: 8, width: 220 }}>
            <Button title="Log in" onPress={() => router.push("/(auth)/login")} />
            <Button title="Create account" variant="secondary" onPress={() => router.push("/(auth)/signup")} />
          </View>
        }
      />
    );
  }
  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[] = [
    { icon: "person-outline", label: "My posts and profile", onPress: () => user && router.push({ pathname: "/profile/[id]", params: { id: user.id } }) },
    { icon: "bookmark-outline", label: "Saved", onPress: () => router.push("/saved") },
    { icon: "settings-outline", label: "Settings", onPress: () => router.push("/settings") },
    { icon: "shield-checkmark-outline", label: "Privacy policy", onPress: () => void Linking.openURL(`${SITE_URL}/privacy`) },
    { icon: "document-text-outline", label: "Terms of use", onPress: () => void Linking.openURL(`${SITE_URL}/terms`) },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ alignItems: "center" }}>
        <Avatar name={profile?.full_name} url={profile?.avatar_url} size="xl" />
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text }}>{profile?.full_name || "Your name"}</Text>
        <Text style={{ color: colors.muted }}>{user?.email}</Text>
        {profile?.university?.name ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="checkmark-circle" size={16} color={colors.brand} />
            <Text style={{ color: colors.muted }}>{profile.university.name}</Text>
          </View>
        ) : null}
      </Card>
      <Card style={{ padding: 4, gap: 0 }}>
        {rows.map((r) => (
          <Pressable key={r.label} onPress={r.onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg }]} accessibilityRole="button">
            <Ionicons name={r.icon} size={22} color={colors.text} />
            <Text style={styles.rowText}>{r.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        ))}
      </Card>
      <Button title="Log out" variant="secondary" icon="log-out-outline" onPress={() => void signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 12 },
  rowText: { flex: 1, fontSize: 16, color: colors.text, fontWeight: "500" },
});
