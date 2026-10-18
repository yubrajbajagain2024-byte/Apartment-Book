import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AMENITIES, deleteApartment, formatDate, formatDistance, formatPrice, getApartment, labelFor, listingMedia } from "@apartment-book/shared";
import { DetailSkeleton, Fact, ListingDetail, useDetailStyles } from "@/components/listing-detail";
import { Badge, Button, EmptyState, Tag } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import { alertWithHaptic } from "@/lib/haptics";

export default function ApartmentScreen() {
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const router = useRouter();
  const { data: a, loading } = useQuery(() => getApartment(supabase, id), [id]);
  const detailStyles = useDetailStyles();
  if (loading) return <DetailSkeleton />;
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
      // The facts as a spec sheet: an eyebrow over each value, two to a row in a hairline grid.
      facts={
        <>
          <Fact icon="bed-outline" eyebrow="Bedrooms" label={a.bedrooms === 0 ? "Studio" : `${a.bedrooms} bed`} />
          <Fact icon="water-outline" eyebrow="Bathrooms" label={`${a.bathrooms} bath`} />
          <Fact icon="location-outline" eyebrow="Location" label={a.city || a.address} />
          {a.distance_km !== null ? <Fact icon="school-outline" eyebrow="Campus" label={`${formatDistance(a.distance_km)} to campus`} /> : null}
          {a.available_from ? <Fact icon="calendar-outline" eyebrow="Available" label={`From ${formatDate(a.available_from)}`} /> : null}
          {a.lease_months ? <Fact icon="time-outline" eyebrow="Lease" label={`${a.lease_months}-month lease`} /> : null}
        </>
      }
      ownerActions={
        <Button
          title="Delete listing"
          variant="danger"
          size="sm"
          onPress={() =>
            alertWithHaptic("warning", "Delete this listing?", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => deleteApartment(supabase, a.id).then(() => router.back()).catch((e) => Alert.alert("Could not delete", e.message)) },
            ])
          }
        />
      }
    >
      {/* What the place offers as hairline capsules; only a status that is not "active" keeps a tinted badge. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        {a.furnished ? <Tag label="Furnished" /> : null}
        {a.utilities_included ? <Tag label="Utilities included" /> : null}
        {a.pets_allowed ? <Tag label="Pets allowed" /> : null}
        {a.status !== "active" ? <Badge label={a.status} tone="amber" /> : null}
      </View>
      <Text style={detailStyles.h2}>About this place</Text>
      <Text style={detailStyles.body}>{a.description}</Text>
      {a.amenities.length > 0 ? (
        <>
          <Text style={detailStyles.h2}>Amenities</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {a.amenities.map((am) => (
              <Tag key={am} label={labelFor(AMENITIES, am)} />
            ))}
          </View>
        </>
      ) : null}
      <Text style={detailStyles.h2}>Address</Text>
      <Text style={detailStyles.body}>{a.address}</Text>
    </ListingDetail>
  );
}
