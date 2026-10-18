import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getApartmentsByIds, getFeedPostsByIds, getItemsByIds, getRoommatePostsByIds, getSavedIds, listSaved, timeAgo } from "@apartment-book/shared";
import { ItemTile } from "@/components/item-tile";
import { Card, EmptyState, Skeleton } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space, type } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

export default function SavedScreen() {
  const { user } = useSession();
  const router = useRouter();
  const styles = useStyles();
  const { data, loading } = useQuery(async () => {
    if (!user) return null;
    const saved = await listSaved(supabase, user.id);
    // listSaved groups ids by type; fall back to getSavedIds while it does not return Home-feed posts.
    const postIds = (saved as { post?: string[] }).post ?? [...(await getSavedIds(supabase, user.id, "post").catch(() => new Set<string>()))];
    const [apartments, roommates, items, posts] = await Promise.all([getApartmentsByIds(supabase, saved.apartment), getRoommatePostsByIds(supabase, saved.roommate), getItemsByIds(supabase, saved.item), getFeedPostsByIds(supabase, postIds).catch(() => [])]);
    posts.sort((a, b) => postIds.indexOf(a.id) - postIds.indexOf(b.id));
    return { apartments, roommates, items, posts };
  }, [user?.id]);
  if (loading) {
    return (
      <View style={styles.content} accessibilityLabel="Loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={64} style={styles.skeleton} />
        ))}
      </View>
    );
  }
  if (!data || data.apartments.length + data.roommates.length + data.items.length + data.posts.length === 0) return <EmptyState icon="bookmark-outline" title="Nothing saved yet" body="Use the ••• menu on any post to save it for later." />;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {data.posts.map((p) => {
        const text = p.body?.trim().replace(/\s+/g, " ") ?? "";
        return (
          <Card key={p.id} style={styles.card}>
            <Text onPress={() => router.push({ pathname: "/posts/[id]", params: { id: p.id } } as never)} numberOfLines={2} style={styles.title}>{text || (p.kind === "reel" ? "Reel" : p.images.length > 0 ? "Photo post" : "Video post")}</Text>
            <Text style={styles.meta}>{p.author.full_name} · {timeAgo(p.created_at)}</Text>
          </Card>
        );
      })}
      {data.apartments.map((a) => (
        <Card key={a.id} style={styles.card}>
          <Text onPress={() => router.push({ pathname: "/apartments/[id]", params: { id: a.id } })} style={styles.title}>{a.title}</Text>
          <Text style={styles.meta}>${a.price_per_month}/mo · {a.city || a.address}</Text>
        </Card>
      ))}
      {data.roommates.map((p) => (
        <Card key={p.id} style={styles.card}>
          <Text onPress={() => router.push({ pathname: "/roommates/[id]", params: { id: p.id } })} style={styles.title}>{p.title}</Text>
          <Text style={styles.meta}>{p.author.full_name}</Text>
        </Card>
      ))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {data.items.map((i) => (
          <View key={i.id} style={{ width: "48%" }}>
            <ItemTile item={i} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { padding: space.lg, gap: space.md },
  skeleton: { borderRadius: radius.lg },
  card: { padding: space.md, gap: 2 },
  title: { ...type.subheading, color: colors.text },
  meta: { ...type.caption, color: colors.muted },
}));
