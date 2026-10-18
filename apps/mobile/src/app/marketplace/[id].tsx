import { Alert, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteItem, formatPrice, getItem, ITEM_CATEGORIES, ITEM_CONDITIONS, labelFor, listingMedia, setItemStatus } from "@apartment-book/shared";
import { DetailSkeleton, Fact, ListingDetail, useDetailStyles } from "@/components/listing-detail";
import { Button, EmptyState } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { alertWithHaptic } from "@/lib/haptics";

export default function ItemScreen() {
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const router = useRouter();
  const { data: item, loading, refresh } = useQuery(() => getItem(supabase, id), [id]);
  const detailStyles = useDetailStyles();
  if (loading) return <DetailSkeleton />;
  if (!item) return <EmptyState icon="bag-handle-outline" title="This item is no longer available" />;
  return (
    <ListingDetail
      targetType="item"
      targetId={item.id}
      title={item.title}
      lead={item.price === 0 ? "Free" : formatPrice(item.price, item.currency)}
      media={listingMedia(item.images, item.image_meta)}
      poster={{ id: item.seller.id, name: item.seller.full_name, avatarUrl: item.seller.avatar_url }}
      createdAt={item.created_at}
      focusComments={comment === "1"}
      // The facts as a spec sheet: an eyebrow over each value, two to a row in a hairline grid.
      facts={
        <>
          <Fact icon="pricetag-outline" eyebrow="Category" label={labelFor(ITEM_CATEGORIES, item.category)} />
          <Fact icon="sparkles-outline" eyebrow="Condition" label={labelFor(ITEM_CONDITIONS, item.condition)} />
          {item.pickup_location ? <Fact icon="location-outline" eyebrow="Pickup" label={item.pickup_location} /> : null}
          {item.status !== "available" ? <Fact icon="checkmark-done-outline" eyebrow="Status" label={item.status === "sold" ? "Sold" : "Archived"} /> : null}
        </>
      }
      // Quiet, side by side under the seller's name (ListingDetail lays them out in a row).
      ownerActions={
        <>
          {item.status === "available" ? <Button title="Mark as sold" variant="secondary" size="sm" onPress={() => setItemStatus(supabase, item.id, "sold").then(refresh).catch((e) => Alert.alert("Error", e.message))} /> : null}
          <Button
            title="Delete item"
            variant="danger"
            size="sm"
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
      <Text style={detailStyles.h2}>Details</Text>
      <Text style={detailStyles.body}>{item.description}</Text>
    </ListingDetail>
  );
}
