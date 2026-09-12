import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AMENITIES, deleteApartment, formatDate, formatDistance, formatPrice, getApartment, labelFor, listingMedia } from "@apartment-book/shared";
import { detailStyles, Fact, ListingDetail } from "@/components/listing-detail";
import { Badge, Button, EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

export default function ApartmentScreen() {
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const router = useRouter();
  const { data: a, loading } = useQuery(() => getApartment(supabase, id), [id]);
  if (loading) return <Loading />;
  if (!a) return <EmptyState icon="home-outline" title="This listing is no longer available" />;
  return (
    <ListingDetail
      targetType="apartment"
      targetId={a.id}
      title={a.title}
      lead={`${formatPrice(a.price_per_month, a.currency)} / month`}
      media={listingMedia(a.images, a.image_meta, a.videos)}
      poster={{ id: a.owner.id, name: a.owner.full_name, avatarUrl: a.owner.avatar_url }}
      createdAt={a.created_at}
      focusComments={comment === "1"}
      facts={
        <>
          <Fact icon="bed-outline" label={a.bedrooms === 0 ? "Studio" : `${a.bedrooms} bed`} />
          <Fact icon="water-outline" label={`${a.bathrooms} bath`} />
          <Fact icon="location-outline" label={a.city || a.address} />
          {a.distance_km !== null ? <Fact icon="school-outline" label={`${formatDistance(a.distance_km)} to campus`} /> : null}
          {a.available_from ? <Fact icon="calendar-outline" label={`From ${formatDate(a.available_from)}`} /> : null}
          {a.lease_months ? <Fact icon="time-outline" label={`${a.lease_months}-month lease`} /> : null}
        </>
      }
      ownerActions={
        <Button
          title="Delete listing"
          variant="danger"
          onPress={() =>
            Alert.alert("Delete this listing?", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => deleteApartment(supabase, a.id).then(() => router.back()).catch((e) => Alert.alert("Could not delete", e.message)) },
            ])
          }
        />
      }
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {a.furnished ? <Badge label="Furnished" tone="blue" /> : null}
        {a.utilities_included ? <Badge label="Utilities included" tone="green" /> : null}
        {a.pets_allowed ? <Badge label="Pets allowed" /> : null}
        {a.status !== "active" ? <Badge label={a.status} tone="amber" /> : null}
      </View>
      <Text style={detailStyles.h2}>About this place</Text>
      <Text style={detailStyles.body}>{a.description}</Text>
      {a.amenities.length > 0 ? (
        <>
          <Text style={detailStyles.h2}>Amenities</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {a.amenities.map((am) => (
              <Badge key={am} label={labelFor(AMENITIES, am)} />
            ))}
          </View>
        </>
      ) : null}
      <Text style={detailStyles.h2}>Address</Text>
      <Text style={detailStyles.body}>{a.address}</Text>
    </ListingDetail>
  );
}
