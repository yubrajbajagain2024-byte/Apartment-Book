import { Alert, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { blockUser, getOrCreateDirectConversation, getProfile, isBlocked, listApartmentsByOwner, listItemsBySeller, listRoommatePostsByAuthor, reportContent, REPORT_REASONS, unblockUser, type ReportReason } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { Avatar } from "@/components/avatar";
import { ItemTile } from "@/components/item-tile";
import { Button, Card, EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const { data: profile, loading } = useQuery(() => getProfile(supabase, id), [id]);
  const { data: posts } = useQuery(async () => {
    const [apartments, roommates, items] = await Promise.all([listApartmentsByOwner(supabase, id), listRoommatePostsByAuthor(supabase, id), listItemsBySeller(supabase, id)]);
    return { apartments, roommates, items };
  }, [id]);
  const { data: blocked, refresh: refreshBlocked } = useQuery(() => (user && user.id !== id ? isBlocked(supabase, user.id, id) : Promise.resolve(false)), [user?.id, id]);
  if (loading) return <Loading />;
  if (!profile) return <EmptyState icon="person-outline" title="Profile not found" />;
  const own = user?.id === id;

  async function message() {
    if (!user) return router.push("/(auth)/login");
    const conv = await getOrCreateDirectConversation(supabase, id).catch((e: Error) => {
      Alert.alert("Message", e.message);
      return null;
    });
    if (conv) router.push({ pathname: "/messages/[id]", params: { id: conv } });
  }
  function more() {
    if (!user) return router.push("/(auth)/login");
    show([
      {
        label: blocked ? "Unblock" : "Block",
        icon: "ban-outline",
        destructive: !blocked,
        onPress: () => {
          if (blocked) return void unblockUser(supabase, user.id, id).then(refreshBlocked);
          Alert.alert(`Block ${profile?.full_name}?`, "They won't be able to message you, and you won't see each other's posts.", [
            { text: "Cancel", style: "cancel" },
            { text: "Block", style: "destructive", onPress: () => void blockUser(supabase, user.id, id).then(refreshBlocked) },
          ]);
        },
      },
      {
        label: "Report",
        icon: "flag-outline",
        destructive: true,
        onPress: () =>
          show(
            REPORT_REASONS.map((r) => ({
              label: r.label,
              onPress: () => {
                reportContent(supabase, user.id, { targetType: "profile", targetId: id, reason: r.value as ReportReason }).catch(() => {});
                Alert.alert("Thanks", "Our team will review this profile.");
              },
            })),
            "Why are you reporting this person?",
          ),
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ alignItems: "center" }}>
        <Avatar name={profile.full_name} url={profile.avatar_url} size="xl" userId={profile.id} />
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>{profile.full_name}</Text>
        {profile.university?.name ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="checkmark-circle" size={16} color={colors.brand} />
            <Text style={{ color: colors.muted }}>{profile.university.name}{profile.program ? ` · ${profile.program}` : ""}{profile.graduation_year ? ` '${String(profile.graduation_year).slice(-2)}` : ""}</Text>
          </View>
        ) : null}
        {profile.bio ? <Text style={{ color: colors.text, textAlign: "center" }}>{profile.bio}</Text> : null}
        {!own ? (
          <View style={{ flexDirection: "row", gap: 8, width: "100%" }}>
            <Button title={blocked ? "Blocked" : "Message"} icon="chatbubble-ellipses-outline" onPress={() => void message()} disabled={Boolean(blocked)} style={{ flex: 1 }} />
            <Button title="More" variant="secondary" icon="ellipsis-horizontal" onPress={more} />
          </View>
        ) : (
          <Button title="Edit profile" variant="secondary" icon="create-outline" onPress={() => router.push("/settings")} />
        )}
      </Card>
      {posts ? (
        <>
          <Section title="Apartments" count={posts.apartments.length}>
            {posts.apartments.map((a) => (
              <RowLink key={a.id} title={a.title} subtitle={`$${a.price_per_month}/mo`} onPress={() => router.push({ pathname: "/apartments/[id]", params: { id: a.id } })} />
            ))}
          </Section>
          <Section title="Roommate posts" count={posts.roommates.length}>
            {posts.roommates.map((p) => (
              <RowLink key={p.id} title={p.title} subtitle={p.post_type === "has_room" ? "Has a room" : "Looking for a room"} onPress={() => router.push({ pathname: "/roommates/[id]", params: { id: p.id } })} />
            ))}
          </Section>
          <Section title="For sale" count={posts.items.length}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {posts.items.map((i) => (
                <View key={i.id} style={{ width: "48%" }}>
                  <ItemTile item={i} />
                </View>
              ))}
            </View>
          </Section>
        </>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
        {title} · {count}
      </Text>
      {children}
    </View>
  );
}
function RowLink({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Card style={{ padding: 12, gap: 2 }}>
      <Text onPress={onPress} style={{ fontWeight: "600", color: colors.text }}>
        {title}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{subtitle}</Text>
    </Card>
  );
}
