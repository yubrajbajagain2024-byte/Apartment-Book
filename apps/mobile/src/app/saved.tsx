import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getApartmentsByIds, getFeedPostsByIds, getItemsByIds, getRoommatePostsByIds, getSavedIds, listingMedia, listSaved, timeAgo, type FeedPostWithAuthor } from "@apartment-book/shared";
import { ItemTile } from "@/components/item-tile";
import { Card, EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme-provider";
import { entryForPost, openViewer, postHasMedia, viewerThumb } from "@/lib/reel-viewer";

export default function SavedScreen() {
  const { user } = useSession();
  const router = useRouter();
  const colors = useColors();
  const { data, loading } = useQuery(async () => {
    if (!user) return null;
    const saved = await listSaved(supabase, user.id);
    // listSaved groups ids by type; fall back to getSavedIds while it does not return Home-feed posts.
    const postIds = (saved as { post?: string[] }).post ?? [...(await getSavedIds(supabase, user.id, "post").catch(() => new Set<string>()))];
    const [apartments, roommates, items, posts] = await Promise.all([getApartmentsByIds(supabase, saved.apartment), getRoommatePostsByIds(supabase, saved.roommate), getItemsByIds(supabase, saved.item), getFeedPostsByIds(supabase, postIds).catch(() => [])]);
    posts.sort((a, b) => postIds.indexOf(a.id) - postIds.indexOf(b.id));
    return { apartments, roommates, items, posts };
  }, [user?.id]);
  /**
   * A saved post with a picture opens full screen, with your other saved posts with pictures to swipe through in the
   * order you saved them; a words-only post opens its own screen.
   */
  function openSavedPost(p: FeedPostWithAuthor) {
    if (!postHasMedia(p)) return router.push({ pathname: "/posts/[id]", params: { id: p.id } } as never);
    const list = (data?.posts ?? []).filter(postHasMedia);
    const index = Math.max(0, list.findIndex((x) => x.id === p.id));
    openViewer(router, { entries: list.map((x) => entryForPost(x.id, viewerThumb(listingMedia(x.images, x.image_meta, x.videos)))), index, then: "end" });
  }
  if (loading) return <Loading />;
  if (!data || data.apartments.length + data.roommates.length + data.items.length + data.posts.length === 0) return <EmptyState icon="bookmark-outline" title="Nothing saved yet" body="Use the ••• menu on any post to save it for later." />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {data.posts.map((p) => {
        // A post's title names it best (migration 44; older rows have none), then the start of its words.
        const text = p.title?.trim() || (p.body?.trim().replace(/\s+/g, " ") ?? "");
        return (
          <Card key={p.id} style={{ padding: 12, gap: 2 }}>
            <Text onPress={() => openSavedPost(p)} numberOfLines={2} style={{ fontWeight: "700", color: colors.text }}>{text || (p.kind === "reel" ? "Reel" : p.images.length > 0 ? "Photo post" : "Video post")}</Text>
            <Text style={{ color: colors.muted }}>{p.author.full_name} · {timeAgo(p.created_at)}</Text>
          </Card>
        );
      })}
      {data.apartments.map((a) => (
        <Card key={a.id} style={{ padding: 12, gap: 2 }}>
          <Text onPress={() => router.push({ pathname: "/apartments/[id]", params: { id: a.id } })} style={{ fontWeight: "700", color: colors.text }}>{a.title}</Text>
          <Text style={{ color: colors.muted }}>${a.price_per_month}/mo · {a.city || a.address}</Text>
        </Card>
      ))}
      {data.roommates.map((p) => (
        <Card key={p.id} style={{ padding: 12, gap: 2 }}>
          <Text onPress={() => router.push({ pathname: "/roommates/[id]", params: { id: p.id } })} style={{ fontWeight: "700", color: colors.text }}>{p.title}</Text>
          <Text style={{ color: colors.muted }}>{p.author?.full_name ?? "Anonymous"}</Text>
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
