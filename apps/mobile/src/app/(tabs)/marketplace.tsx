import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { ITEM_CATEGORIES, listItems, type ItemWithSeller } from "@apartment-book/shared";
import { Fab, FeedHeader } from "@/components/feed-header";
import { ItemTile } from "@/components/item-tile";
import { Chip, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function MarketplaceScreen() {
  const { profile } = useSession();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [allCampuses, setAllCampuses] = useState(false);
  const universityId = allCampuses ? undefined : (profile?.university_id ?? undefined);
  const feed = useFeed<ItemWithSeller>((page) => listItems(supabase, { q: q || undefined, universityId, category, page, pageSize: 20 }), [q, universityId, category]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={feed.items}
        keyExtractor={(i) => i.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 8 }}
        contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 4 }}>
            <FeedHeader placeholder="Search mattresses, desks, textbooks…" value={q} onChange={setQ}>
              {profile?.university_id ? <Chip label={allCampuses ? "All universities" : "My campus"} icon="school-outline" active={!allCampuses} onPress={() => setAllCampuses((v) => !v)} /> : null}
              {ITEM_CATEGORIES.slice(0, 6).map((c) => (
                <Chip key={c.value} label={c.label} active={category === c.value} onPress={() => setCategory(category === c.value ? undefined : c.value)} />
              ))}
            </FeedHeader>
          </View>
        }
        renderItem={({ item }) => <ItemTile item={item} />}
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <ErrorBanner message={feed.error} onRetry={feed.refresh} /> : <EmptyState icon="bag-handle-outline" title="Nothing for sale yet" body="Moving out? Sell your mattress, desk or textbooks here." />}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} />}
      />
      <Fab href="/create/item" label="Sell an item" />
    </View>
  );
}
