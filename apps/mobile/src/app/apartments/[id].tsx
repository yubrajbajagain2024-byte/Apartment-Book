import { Alert, Linking, Platform, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AMENITIES, businessLabel, deleteApartment, formatDate, formatDistance, formatPrice, getApartment, labelFor, listingMedia, listingPoster, type ApartmentWithOwner } from "@apartment-book/shared";
import { AuroraHeading, AuroraPanel, AuroraPill } from "@/components/aurora";
import { Icon, type IconName } from "@/components/icon";
import { Fact, ListingDetail, useDetailStyles } from "@/components/listing-detail";
import { Badge, Button, EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme-provider";
import { alertWithHaptic } from "@/lib/haptics";

/** An icon for each amenity, so the list reads at a glance. */
const AMENITY_ICONS: Record<string, IconName> = {
  wifi: "wifi",
  laundry: "shirt-outline",
  parking: "car-outline",
  gym: "barbell-outline",
  ac: "snow-outline",
  heating: "flame-outline",
  dishwasher: "restaurant-outline",
  balcony: "sunny-outline",
  study_room: "book-outline",
  security: "shield-checkmark-outline",
  bike_storage: "bicycle-outline",
  elevator: "swap-vertical-outline",
};

/** Where the address opens: the listing's own map link, else the phone's maps app on the address. */
function mapsUrl(a: ApartmentWithOwner): string {
  if (a.map_url) return a.map_url;
  const q = encodeURIComponent([a.address, a.city].filter(Boolean).join(", "));
  return Platform.OS === "ios" ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function isPast(day: string | null): boolean {
  if (!day) return true;
  return new Date(`${day}T00:00:00`).getTime() <= Date.now();
}

/** Two to a row, the last one alone at half width: the panels keep one size (as on a roommate post). */
function PanelGrid({ items }: { items: { icon: IconName; label: string; value: string }[] }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map((item) => (
        <AuroraPanel key={item.label} style={{ width: "48.5%", gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Icon name={item.icon} size={13} color={colors.auroraInk} />
            <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{item.value}</Text>
        </AuroraPanel>
      ))}
    </View>
  );
}

/**
 * An apartment's own page, in the roommate post's Aurora look: the media, the title and rent, where it is, then About,
 * the property's details, when it is available, its amenities and where to find it, with the poster and every way to
 * reach them (a message, a call), and the likes and comments under it all.
 */
export default function ApartmentScreen() {
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const router = useRouter();
  const { data: a, loading } = useQuery(() => getApartment(supabase, id), [id]);
  const colors = useColors();
  const detailStyles = useDetailStyles();
  if (loading) return <Loading />;
  if (!a) return <EmptyState icon="home-outline" title="This listing is no longer available" />;

  const rent = formatPrice(a.price_per_month, a.currency);
  const media = listingMedia(a.images, a.image_meta, a.videos);
  const hasVideo = media.some((m) => m.type === "video");
  const availableNow = isPast(a.available_from);
  const label = businessLabel(a.business, a.sponsored);
  const details: { icon: IconName; label: string; value: string }[] = [
    { icon: "cash-outline", label: "Rent", value: `${rent} / month` },
    { icon: "bed-outline", label: "Bedrooms", value: a.bedrooms === 0 ? "Studio" : String(a.bedrooms) },
    { icon: "water-outline", label: "Bathrooms", value: String(a.bathrooms) },
    { icon: "cube-outline", label: "Furnished", value: a.furnished ? "Yes" : "No" },
    { icon: "flash-outline", label: "Utilities", value: a.utilities_included ? "Included" : "Not included" },
    { icon: "paw-outline", label: "Pets", value: a.pets_allowed ? "Allowed" : "Not allowed" },
  ];
  const availability: { icon: IconName; label: string; value: string }[] = [
    { icon: "calendar-outline", label: "Move in", value: a.available_from ? (availableNow ? "Now" : formatDate(a.available_from)) : "Flexible" },
    { icon: "time-outline", label: "Lease", value: a.lease_months ? `${a.lease_months} months` : "Flexible" },
    { icon: "checkmark-circle-outline", label: "Status", value: a.status === "active" ? "Available" : a.status === "rented" ? "Rented" : "No longer listed" },
    { icon: "sparkles-outline", label: "Listed", value: formatDate(a.created_at) },
  ];

  return (
    <ListingDetail
      targetType="apartment"
      targetId={a.id}
      title={a.title}
      lead={`${rent} / month`}
      media={media}
      poster={{ ...listingPoster(a.owner, a.business), badge: label, businessId: a.business?.id ?? null }}
      createdAt={a.created_at}
      focusComments={comment === "1"}
      aurora
      facts={
        <>
          <Fact accent icon="location-outline" label={a.city || a.address} />
          {a.distance_km !== null ? <Fact accent icon="navigate-outline" label={`${formatDistance(a.distance_km)} to campus`} /> : null}
          {a.university?.name ? <Fact accent icon="school-outline" label={a.university.name} /> : null}
        </>
      }
      contact={
        a.contact_phone ? (
          <Button title={`Call ${a.contact_phone}`} variant="secondary" size="compact" icon="call-outline" onPress={() => void Linking.openURL(`tel:${a.contact_phone!.replace(/[^\d+]/g, "")}`)} />
        ) : undefined
      }
      ownerActions={
        <Button
          title="Delete listing"
          variant="danger"
          onPress={() =>
            alertWithHaptic("warning", "Delete this listing?", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => deleteApartment(supabase, a.id).then(() => router.back()).catch((e) => Alert.alert("Could not delete", e.message)) },
            ])
          }
        />
      }
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {a.status === "active" ? <AuroraPill icon="calendar-outline" label={availableNow ? "Available now" : `Available ${formatDate(a.available_from)}`} /> : null}
        {hasVideo ? <AuroraPill icon="videocam-outline" label="Video tour" /> : null}
        {a.furnished ? <AuroraPill icon="cube-outline" label="Furnished" /> : null}
        {a.utilities_included ? <AuroraPill icon="flash-outline" label="Utilities included" /> : null}
        {a.pets_allowed ? <AuroraPill icon="paw-outline" label="Pets OK" /> : null}
        {/* A status that wants attention keeps its own colour. */}
        {a.status !== "active" ? <Badge label={a.status === "rented" ? "Rented" : "No longer listed"} tone="amber" /> : null}
      </View>

      {a.description?.trim() ? (
        <>
          <AuroraHeading>About this place</AuroraHeading>
          <Text style={detailStyles.body}>{a.description.trim()}</Text>
        </>
      ) : null}

      <AuroraHeading>Property details</AuroraHeading>
      <PanelGrid items={details} />

      <AuroraHeading>Availability</AuroraHeading>
      <PanelGrid items={availability} />

      {a.amenities.length > 0 ? (
        <>
          <AuroraHeading>Amenities</AuroraHeading>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {a.amenities.map((am) => (
              <AuroraPill key={am} icon={AMENITY_ICONS[am] ?? "checkmark-outline"} label={labelFor(AMENITIES, am)} />
            ))}
          </View>
        </>
      ) : null}

      <AuroraHeading>Location</AuroraHeading>
      <AuroraPanel style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Icon name="location-outline" size={16} color={colors.auroraInk} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{a.address}</Text>
            {a.city ? <Text style={{ fontSize: 13, color: colors.muted }}>{a.city}</Text> : null}
            {a.distance_km !== null || a.university?.name ? (
              <Text style={{ fontSize: 13, color: colors.muted }}>{[a.distance_km !== null ? `${formatDistance(a.distance_km)} to campus` : null, a.university?.name].filter(Boolean).join(" · ")}</Text>
            ) : null}
          </View>
        </View>
        <Button title="Open in Maps" variant="secondary" size="compact" icon="map-outline" onPress={() => void Linking.openURL(mapsUrl(a))} />
      </AuroraPanel>
    </ListingDetail>
  );
}
