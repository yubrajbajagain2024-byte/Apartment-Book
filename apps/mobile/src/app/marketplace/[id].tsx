import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteItem, getItem, ITEM_CATEGORIES, ITEM_CONDITIONS, labelFor, listingMedia, setItemStatus } from "@apartment-book/shared";
import { AuroraHeading, AuroraPill } from "@/components/aurora";
import { Fact, ListingDetail, useDetailStyles } from "@/components/listing-detail";
import { categoryIcon, priceText } from "@/components/marketplace/item-text";
import { Badge, Button, EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { alertWithHaptic } from "@/lib/haptics";

/** "Good condition", "Fair condition"; "New" and "Like new" read fine alone. */
function conditionLabel(condition: string): string {
  const label = labelFor(ITEM_CONDITIONS, condition);
  return condition === "new" || condition === "like_new" ? label : `${label} condition`;
}

/**
 * A Marketplace item's own page, laid out as a roommate post's is: the photos and video full width and swipeable, the
 * heart, share, Inbox and the bookmark right under them, then the item's name and price, where to pick it up and its
 * category, its condition, About (the seller's description), and the seller with Message. Items have no public
 * comments (hasPublicComments), like roommate posts: buyers reach the seller in private.
 */
export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: item, loading, refresh } = useQuery(() => getItem(supabase, id), [id]);
  const detailStyles = useDetailStyles();
  if (loading) return <Loading />;
  if (!item) return <EmptyState icon="bag-handle-outline" title="This item is no longer available" />;
  const description = item.description.trim();
  return (
    <ListingDetail
      targetType="item"
      targetId={item.id}
      title={item.title}
      lead={priceText(item)}
      media={listingMedia(item.images, item.image_meta, item.videos)}
      poster={{ id: item.seller.id, name: item.seller.full_name, avatarUrl: item.seller.avatar_url }}
      createdAt={item.created_at}
      aurora
      facts={
        <>
          {item.pickup_location ? <Fact accent icon="location-outline" label={item.pickup_location} /> : null}
          <Fact accent icon={categoryIcon(item.category)} label={labelFor(ITEM_CATEGORIES, item.category)} />
        </>
      }
      ownerActions={
        <>
          {item.status === "available" ? <Button title="Mark as sold" variant="secondary" onPress={() => setItemStatus(supabase, item.id, "sold").then(refresh).catch((e) => Alert.alert("Error", e.message))} /> : null}
          <Button
            title="Delete item"
            variant="danger"
            style={{ marginTop: 8 }}
            onPress={() =>
              alertWithHaptic("warning", "Delete this item?", "This cannot be undone.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => deleteItem(supabase, item.id).then(() => router.back()).catch((e) => Alert.alert("Could not delete", e.message)) },
              ])
            }
          />
        </>
      }
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <AuroraPill icon="sparkles-outline" label={conditionLabel(item.condition)} />
        {/* A status that wants attention keeps its own colour. */}
        {item.status !== "available" ? <Badge label={item.status === "sold" ? "Sold" : "No longer for sale"} tone="amber" /> : null}
      </View>
      {description ? (
        <>
          <AuroraHeading>About</AuroraHeading>
          <Text style={detailStyles.body}>{description}</Text>
        </>
      ) : null}
    </ListingDetail>
  );
}
