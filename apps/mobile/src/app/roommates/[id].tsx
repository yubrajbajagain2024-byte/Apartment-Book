import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { budgetLabel, deleteRoommatePost, formatDate, formatDistance, GENDER_PREFERENCES, getRoommatePost, labelFor, listingMedia } from "@apartment-book/shared";
import { DetailSkeleton, Fact, FactGrid, ListingDetail, useDetailStyles } from "@/components/listing-detail";
import { Badge, Button, EmptyState, Tag } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";

export default function RoommateScreen() {
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const router = useRouter();
  const { data: p, loading } = useQuery(() => getRoommatePost(supabase, id), [id]);
  const detailStyles = useDetailStyles();
  if (loading) return <DetailSkeleton />;
  if (!p) return <EmptyState icon="people-outline" title="This post is no longer available" />;
  const budget = budgetLabel(p);
  const prefs = [
    ["Roommate gender", labelFor(GENDER_PREFERENCES, p.gender_preference)],
    ["Sleep schedule", p.sleep_schedule ?? "Not specified"],
    ["Cleanliness", p.cleanliness ?? "Not specified"],
    ["Smoking", p.smoking_ok ? "Okay" : "No smoking"],
    ["Pets", p.pets_ok ? "Okay" : "No pets"],
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
      focusComments={comment === "1"}
      // The facts as a spec sheet: an eyebrow over each value, two to a row in a hairline grid.
      facts={
        <>
          {p.location ? <Fact icon="location-outline" eyebrow="Location" label={p.location} /> : null}
          {p.move_in_date ? <Fact icon="calendar-outline" eyebrow="Timing" label={`Move in ${formatDate(p.move_in_date)}`} /> : null}
          {p.university?.name ? <Fact icon="school-outline" eyebrow="University" label={p.university.name} /> : null}
          {p.distance_km !== null ? <Fact icon="navigate-outline" eyebrow="Campus" label={`${formatDistance(p.distance_km)} to campus`} /> : null}
        </>
      }
      ownerActions={
        <Button
          title="Delete post"
          variant="danger"
          size="sm"
          onPress={() =>
            Alert.alert("Delete this post?", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => deleteRoommatePost(supabase, p.id).then(() => router.back()).catch((e) => Alert.alert("Could not delete", e.message)) },
            ])
          }
        />
      }
    >
      {/* The kind of post as an ink-edged capsule; only "No longer looking" keeps a tinted badge. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        <Tag label={p.post_type === "has_room" ? "Has a room to share" : "Looking for a room"} strong />
        {!p.is_active ? <Badge label="No longer looking" tone="amber" /> : null}
      </View>
      <Text style={detailStyles.h2}>About</Text>
      <Text style={detailStyles.body}>{p.description}</Text>
      <Text style={detailStyles.h2}>Preferences</Text>
      {/* The same hairline grid as the facts above, each preference's name over its value. */}
      <FactGrid>
        {prefs.map(([k, v]) => (
          <View key={k} style={{ gap: space.xxs }}>
            <Text style={detailStyles.cellLabel}>{k}</Text>
            <Text style={detailStyles.cellValue}>{v}</Text>
          </View>
        ))}
      </FactGrid>
    </ListingDetail>
  );
}
