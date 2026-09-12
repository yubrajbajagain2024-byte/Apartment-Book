import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getApartmentsByIds, getItemsByIds, getRoommatePostsByIds, listSaved } from "@apartment-book/shared";
import { ItemTile } from "@/components/item-tile";
import { Card, EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function SavedScreen() {
  const { user } = useSession();
  const router = useRouter();
  const { data, loading } = useQuery(async () => {
    if (!user) return null;
    const saved = await listSaved(supabase, user.id);
    const [apartments, roommates, items] = await Promise.all([getApartmentsByIds(supabase, saved.apartment), getRoommatePostsByIds(supabase, saved.roommate), getItemsByIds(supabase, saved.item)]);
    return { apartments, roommates, items };
  }, [user?.id]);
  if (loading) return <Loading />;
  if (!data || data.apartments.length + data.roommates.length + data.items.length === 0) return <EmptyState icon="bookmark-outline" title="Nothing saved yet" body="Use the ••• menu on any post to save it for later." />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {data.apartments.map((a) => (
        <Card key={a.id} style={{ padding: 12, gap: 2 }}>
          <Text onPress={() => router.push({ pathname: "/apartments/[id]", params: { id: a.id } })} style={{ fontWeight: "700", color: colors.text }}>{a.title}</Text>
          <Text style={{ color: colors.muted }}>${a.price_per_month}/mo · {a.city || a.address}</Text>
        </Card>
      ))}
      {data.roommates.map((p) => (
        <Card key={p.id} style={{ padding: 12, gap: 2 }}>
          <Text onPress={() => router.push({ pathname: "/roommates/[id]", params: { id: p.id } })} style={{ fontWeight: "700", color: colors.text }}>{p.title}</Text>
          <Text style={{ color: colors.muted }}>{p.author.full_name}</Text>
        </Card>
      ))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {data.items.map((i) => (
          <View key={i.id} style={{ width: "48%" }}>
            <ItemTile item={i} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
