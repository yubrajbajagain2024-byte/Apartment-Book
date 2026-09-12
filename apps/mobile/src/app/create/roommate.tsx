import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { CLEANLINESS_LEVELS, createRoommatePost, GENDER_PREFERENCES, roommatePostSchema, SLEEP_SCHEDULES, type ListingVideo, type PhotoMeta } from "@apartment-book/shared";
import { CheckRow, FormSection, Segmented } from "@/components/form";
import { MediaPicker } from "@/components/photo-picker";
import { Button, Chip, Field } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function CreateRoommateScreen() {
  const { user, profile } = useSession();
  const router = useRouter();
  const [video, setVideo] = useState<ListingVideo | null>(null);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [f, setF] = useState({ postType: "needs_room" as "has_room" | "needs_room", title: "", description: "", budgetMin: "", budgetMax: "", moveInDate: "", location: "", genderPreference: "any" as "any" | "male" | "female" | "nonbinary", smokingOk: false, petsOk: false, sleepSchedule: "", cleanliness: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  if (!user) return null;

  async function submit() {
    const parsed = roommatePostSchema.safeParse({
      ...f,
      currency: "USD",
      universityId: profile?.university_id ?? undefined,
      budgetMin: f.budgetMin || undefined,
      budgetMax: f.budgetMax || undefined,
      moveInDate: f.moveInDate || undefined,
      location: f.location || undefined,
      images: photos.map((p) => p.url),
      imageMeta: photos.map((p) => JSON.stringify(p)),
      videos: video ? [JSON.stringify(video)] : [],
    });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path[0])] ??= issue.message;
      setErrors(e);
      Alert.alert("Almost there", Object.values(e)[0]);
      return;
    }
    setBusy(true);
    try {
      const created = await createRoommatePost(supabase, user!.id, parsed.data);
      router.replace({ pathname: "/roommates/[id]", params: { id: created.id } });
    } catch (e) {
      Alert.alert("Could not post", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <FormSection title="What are you looking for?">
        <Segmented options={[{ value: "needs_room", label: "I need a room" }, { value: "has_room", label: "I have a room" }]} value={f.postType} onChange={(v) => set("postType", v)} />
        <Field label="Title" value={f.title} onChangeText={(v) => set("title", v)} placeholder="Quiet CS student looking for a room from January" error={errors.title} />
        <Field label="About you and what you want" value={f.description} onChangeText={(v) => set("description", v)} multiline placeholder="Schedule, habits, what matters to you in a roommate…" error={errors.description} />
      </FormSection>
      <FormSection title={f.postType === "has_room" ? "Show the room" : "Photos (optional)"}>
        <MediaPicker kind="roommates" userId={user.id} photos={photos} onPhotos={setPhotos} video={video} onVideo={setVideo} videoFirst={f.postType === "has_room"} />
      </FormSection>
      <FormSection title="Budget and timing">
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Budget min ($/mo)" value={f.budgetMin} onChangeText={(v) => set("budgetMin", v)} keyboardType="number-pad" placeholder="400" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Budget max ($/mo)" value={f.budgetMax} onChangeText={(v) => set("budgetMax", v)} keyboardType="number-pad" placeholder="650" error={errors.budgetMax} />
          </View>
        </View>
        <Field label="Move-in date (YYYY-MM-DD)" value={f.moveInDate} onChangeText={(v) => set("moveInDate", v)} placeholder="2027-01-05" error={errors.moveInDate} />
        <Field label="Area or neighbourhood" value={f.location} onChangeText={(v) => set("location", v)} placeholder="Near campus, San Marcos" />
      </FormSection>
      <FormSection title="Preferences">
        <Segmented options={GENDER_PREFERENCES.map((g) => ({ value: g.value, label: g.label }))} value={f.genderPreference} onChange={(v) => set("genderPreference", v)} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {SLEEP_SCHEDULES.map((s) => (
            <Chip key={s} label={s} active={f.sleepSchedule === s} onPress={() => set("sleepSchedule", f.sleepSchedule === s ? "" : s)} />
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CLEANLINESS_LEVELS.map((c) => (
            <Chip key={c} label={c} active={f.cleanliness === c} onPress={() => set("cleanliness", f.cleanliness === c ? "" : c)} />
          ))}
        </View>
        <CheckRow label="Smoking is okay" value={f.smokingOk} onChange={(v) => set("smokingOk", v)} />
        <CheckRow label="Pets are okay" value={f.petsOk} onChange={(v) => set("petsOk", v)} />
      </FormSection>
      <Button title="Post" onPress={() => void submit()} loading={busy} />
    </ScrollView>
  );
}
