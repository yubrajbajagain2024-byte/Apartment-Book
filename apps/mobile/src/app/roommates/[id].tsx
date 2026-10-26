import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { budgetLabel, deleteRoommatePost, formatDate, formatDistance, GENDER_PREFERENCES, getRoommatePost, labelFor, listingMedia } from "@apartment-book/shared";
import { AuroraHeading, AuroraPanel, AuroraPill } from "@/components/aurora";
import type { IconName } from "@/components/icon";
import { Icon } from "@/components/icon";
import { Fact, ListingDetail, useDetailStyles } from "@/components/listing-detail";
import { Badge, Button, EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme-provider";
import { alertWithHaptic } from "@/lib/haptics";

export default function RoommateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: p, loading } = useQuery(() => getRoommatePost(supabase, id), [id]);
  const colors = useColors();
  const detailStyles = useDetailStyles();
  if (loading) return <Loading />;
  if (!p) return <EmptyState icon="people-outline" title="This post is no longer available" />;
  const budget = budgetLabel(p);
  const prefs: { icon: IconName; label: string; value: string }[] = [
    { icon: "person-outline", label: "Roommate gender", value: labelFor(GENDER_PREFERENCES, p.gender_preference) },
    { icon: "moon-outline", label: "Sleep schedule", value: p.sleep_schedule ?? "Not specified" },
    { icon: "sparkles-outline", label: "Cleanliness", value: p.cleanliness ?? "Not specified" },
    { icon: "flame-outline", label: "Smoking", value: p.smoking_ok ? "Okay" : "No smoking" },
    { icon: "paw-outline", label: "Pets", value: p.pets_ok ? "Okay" : "No pets" },
  ];
  return (
    <ListingDetail
      targetType="roommate"
      targetId={p.id}
      title={p.title}
      lead={budget ? `${budget} / month` : undefined}
      media={listingMedia(p.images, p.image_meta, p.videos)}
      poster={{ id: p.author.id, name: p.author.full_name, avatarUrl: p.author.avatar_url }}
      createdAt={p.created_at}
      aurora
      facts={
        <>
          {p.location ? <Fact accent icon="location-outline" label={p.location} /> : null}
          {p.move_in_date ? <Fact accent icon="calendar-outline" label={`Move in ${formatDate(p.move_in_date)}`} /> : null}
          {p.university?.name ? <Fact accent icon="school-outline" label={p.university.name} /> : null}
          {p.distance_km !== null ? <Fact accent icon="navigate-outline" label={`${formatDistance(p.distance_km)} to campus`} /> : null}
        </>
      }
      ownerActions={
        <Button
          title="Delete post"
          variant="danger"
          onPress={() =>
            alertWithHaptic("warning", "Delete this post?", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => deleteRoommatePost(supabase, p.id).then(() => router.back()).catch((e) => Alert.alert("Could not delete", e.message)) },
            ])
          }
        />
      }
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <AuroraPill icon={p.post_type === "has_room" ? "home-outline" : "search-outline"} label={p.post_type === "has_room" ? "Has a room to share" : "Looking for a room"} />
        {/* A status that wants attention keeps its own colour. */}
        {!p.is_active ? <Badge label="No longer looking" tone="amber" /> : null}
      </View>
      <AuroraHeading>About</AuroraHeading>
      <Text style={detailStyles.body}>{p.description}</Text>
      <AuroraHeading>Preferences</AuroraHeading>
      {/* Two to a row, the last one alone at half width: the cards keep one size. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {prefs.map((pref) => (
          <AuroraPanel key={pref.label} style={{ width: "48.5%", gap: 3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon name={pref.icon} size={13} color={colors.auroraInk} />
              <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
                {pref.label}
              </Text>
            </View>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{pref.value}</Text>
          </AuroraPanel>
        ))}
      </View>
    </ListingDetail>
  );
}
