import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getOrCreateDirectConversation } from "@apartment-book/shared";
import { useOnlineUsers } from "@/lib/presence";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { Avatar } from "./avatar";

/** Who is online right now (like Messenger's active row). Tap to message. */
export function OnlineStrip() {
  const { user } = useSession();
  const router = useRouter();
  const users = useOnlineUsers();
  const people = [...users.values()].filter((u) => u.id !== user?.id).sort((a, b) => a.full_name.localeCompare(b.full_name));
  if (!user || people.length === 0) return null;
  return (
    <View style={styles.wrap} accessibilityLabel="Online now">
      <Text style={styles.heading}>Online now</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: 12, paddingBottom: 10 }}>
        {people.map((p) => (
          <Pressable
            key={p.id}
            style={{ width: 60, alignItems: "center", gap: 4 }}
            accessibilityRole="button" accessibilityLabel={`Message ${p.full_name}`}
            onPress={async () => {
              const id = await getOrCreateDirectConversation(supabase, p.id).catch(() => null);
              if (id) router.push({ pathname: "/messages/[id]", params: { id } });
            }}
          >
            <Avatar name={p.full_name} url={p.avatar_url} size="lg" online />
            <Text style={styles.name} numberOfLines={1}>
              {p.full_name.split(" ")[0]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.card, borderRadius: radius.lg, paddingTop: 10 },
  heading: { fontSize: 13, fontWeight: "700", color: colors.muted, paddingHorizontal: 12, paddingBottom: 8 },
  name: { fontSize: 11, color: colors.text },
});
