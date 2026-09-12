import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getOrCreateDirectConversation, searchProfiles, type ProfileSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Field, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function NewMessageScreen() {
  const { user } = useSession();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<ProfileSummary[]>([]);
  useEffect(() => {
    if (!user || q.trim().length < 2) return setPeople([]);
    const t = setTimeout(() => searchProfiles(supabase, q.trim(), { excludeIds: [user.id] }).then(setPeople).catch(() => setPeople([])), 250);
    return () => clearTimeout(t);
  }, [q, user]);
  return (
    <Screen>
      <Field placeholder="Search students by name" value={q} onChangeText={setQ} autoFocus />
      <FlatList
        data={people}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item: p }) => (
          <Pressable
            style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}
            onPress={async () => {
              const id = await getOrCreateDirectConversation(supabase, p.id).catch((e: Error) => {
                alert(e.message);
                return null;
              });
              if (id) router.replace({ pathname: "/messages/[id]", params: { id } });
            }}
          >
            <Avatar name={p.full_name} url={p.avatar_url} size="md" userId={p.id} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{p.full_name}</Text>
          </Pressable>
        )}
        ListEmptyComponent={q.trim().length >= 2 ? <Text style={{ color: colors.muted, textAlign: "center" }}>No one found.</Text> : <View />}
      />
    </Screen>
  );
}
