import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { AMENITIES, apartmentSchema, createApartment, type ListingVideo, type PhotoMeta } from "@apartment-book/shared";
import { CheckRow, FormSection } from "@/components/form";
import { MediaPicker } from "@/components/photo-picker";
import { Button, Chip, Field } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function CreateApartmentScreen() {
  const { user, profile } = useSession();
  const router = useRouter();
  const [video, setVideo] = useState<ListingVideo | null>(null);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [f, setF] = useState({ title: "", description: "", pricePerMonth: "", address: "", city: "", bedrooms: "1", bathrooms: "1", furnished: false, utilitiesIncluded: false, petsAllowed: false, availableFrom: "", leaseMonths: "", amenities: [] as string[], contactPhone: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  if (!user) return null;

  async function submit() {
    const parsed = apartmentSchema.safeParse({
      ...f,
      currency: "USD",
      universityId: profile?.university_id ?? undefined,
      availableFrom: f.availableFrom || undefined,
      leaseMonths: f.leaseMonths || undefined,
      city: f.city || undefined,
      contactPhone: f.contactPhone || undefined,
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
      const created = await createApartment(supabase, user!.id, parsed.data);
      Alert.alert(video ? "Posted with a video tour 🎉" : "Posted!", video ? "Listings with a tour rank higher and get more messages." : "Tip: add a video tour later to rank higher.");
      router.replace({ pathname: "/apartments/[id]", params: { id: created.id } });
    } catch (e) {
      Alert.alert("Could not post", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <FormSection title="Video tour and photos">
        <MediaPicker kind="apartments" userId={user.id} photos={photos} onPhotos={setPhotos} video={video} onVideo={setVideo} videoFirst />
      </FormSection>
      <FormSection title="The basics">
        <Field label="Title" value={f.title} onChangeText={(v) => set("title", v)} placeholder="Sunny 2-bed near Sewell Park" error={errors.title} />
        <Field label="Monthly rent (USD)" value={f.pricePerMonth} onChangeText={(v) => set("pricePerMonth", v)} keyboardType="decimal-pad" placeholder="1150" error={errors.pricePerMonth} />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Bedrooms (0 = studio)" value={f.bedrooms} onChangeText={(v) => set("bedrooms", v)} keyboardType="number-pad" error={errors.bedrooms} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Bathrooms" value={f.bathrooms} onChangeText={(v) => set("bathrooms", v)} keyboardType="decimal-pad" error={errors.bathrooms} />
          </View>
        </View>
        <Field label="Address" value={f.address} onChangeText={(v) => set("address", v)} placeholder="123 N LBJ Dr" error={errors.address} />
        <Field label="City" value={f.city} onChangeText={(v) => set("city", v)} placeholder="San Marcos" />
        <Field label="Description" value={f.description} onChangeText={(v) => set("description", v)} multiline placeholder="What makes this place great? Who are you looking for?" error={errors.description} />
      </FormSection>
      <FormSection title="Details">
        <CheckRow label="Furnished" value={f.furnished} onChange={(v) => set("furnished", v)} />
        <CheckRow label="Utilities included" value={f.utilitiesIncluded} onChange={(v) => set("utilitiesIncluded", v)} />
        <CheckRow label="Pets allowed" value={f.petsAllowed} onChange={(v) => set("petsAllowed", v)} />
        <Field label="Available from (YYYY-MM-DD)" value={f.availableFrom} onChangeText={(v) => set("availableFrom", v)} placeholder="2027-01-05" error={errors.availableFrom} />
        <Field label="Lease length (months)" value={f.leaseMonths} onChangeText={(v) => set("leaseMonths", v)} keyboardType="number-pad" placeholder="12" />
        <Field label="Contact phone (optional)" value={f.contactPhone} onChangeText={(v) => set("contactPhone", v)} keyboardType="phone-pad" />
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>Amenities</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {AMENITIES.map((a) => (
            <Chip key={a.value} label={a.label} active={f.amenities.includes(a.value)} onPress={() => set("amenities", f.amenities.includes(a.value) ? f.amenities.filter((x) => x !== a.value) : [...f.amenities, a.value])} />
          ))}
        </View>
      </FormSection>
      <Button title="Post listing" onPress={() => void submit()} loading={busy} />
    </ScrollView>
  );
}
