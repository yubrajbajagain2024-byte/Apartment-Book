import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getOrCreateDirectConversation } from "@apartment-book/shared";
import { useOnlineUsers } from "@/lib/presence";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space, type } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Avatar } from "./avatar";

/** Who is online right now (like Messenger's active row). Tap to message. */
export function OnlineStrip() {
  const { user } = useSession();
  const router = useRouter();
  const users = useOnlineUsers();
  const styles = useStyles();
  const colors = useColors();
  const people = [...users.values()].filter((u) => u.id !== user?.id).sort((a, b) => a.full_name.localeCompare(b.full_name));
  if (!user || people.length === 0) return null;
  return (
    <View style={styles.wrap} accessibilityLabel="Online now">
      <Text style={styles.heading}>Online now</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingHorizontal: space.md, paddingBottom: space.md }}>
        {people.map((p) => (
          <Pressable
            key={p.id}
            style={({ pressed }) => [{ width: 60, alignItems: "center", gap: space.xs }, pressed && { opacity: 0.7 }]}
            accessibilityRole="button" accessibilityLabel={`Message ${p.full_name}`}
            onPress={async () => {
              const id = await getOrCreateDirectConversation(supabase, p.id).catch(() => null);
              if (id) router.push({ pathname: "/messages/[id]", params: { id } });
            }}
          >
            <Avatar name={p.full_name} url={p.avatar_url} size="lg" online ringColor={colors.card} />
            <Text style={styles.name} numberOfLines={1}>
              {p.full_name.split(" ")[0]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Outlined like Card, so the strip still stands apart from the feed in both themes.
  wrap: { backgroundColor: colors.card, borderRadius: radius.lg, borderCurve: "continuous", paddingTop: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  heading: { ...type.label, fontSize: 13, color: colors.muted, paddingHorizontal: space.md, paddingBottom: space.sm },
  name: { ...type.footnote, fontSize: 11, color: colors.text },
}));
