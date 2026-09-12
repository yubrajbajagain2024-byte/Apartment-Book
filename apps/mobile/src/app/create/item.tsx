import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { createItem, ITEM_CATEGORIES, ITEM_CONDITIONS, itemSchema, type PhotoMeta } from "@apartment-book/shared";
import { FormSection, Segmented } from "@/components/form";
import { MediaPicker } from "@/components/photo-picker";
import { Button, Chip, Field } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function CreateItemScreen() {
  const { user, profile } = useSession();
  const router = useRouter();
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [f, setF] = useState({ title: "", description: "", price: "", category: "", condition: "good" as "new" | "like_new" | "good" | "fair" | "poor", pickupLocation: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  if (!user) return null;

  async function submit() {
    const parsed = itemSchema.safeParse({ ...f, currency: "USD", universityId: profile?.university_id ?? undefined, pickupLocation: f.pickupLocation || undefined, images: photos.map((p) => p.url), imageMeta: photos.map((p) => JSON.stringify(p)) });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path[0])] ??= issue.message;
      setErrors(e);
      Alert.alert("Almost there", Object.values(e)[0]);
      return;
    }
    setBusy(true);
    try {
      const created = await createItem(supabase, user!.id, parsed.data);
      router.replace({ pathname: "/marketplace/[id]", params: { id: created.id } });
    } catch (e) {
      Alert.alert("Could not post", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <FormSection title="Photos">
        <MediaPicker kind="items" userId={user.id} photos={photos} onPhotos={setPhotos} />
      </FormSection>
      <FormSection title="What are you selling?">
        <Field label="Title" value={f.title} onChangeText={(v) => set("title", v)} placeholder="Queen mattress, 1 year old" error={errors.title} />
        <Field label="Price (USD, 0 = free)" value={f.price} onChangeText={(v) => set("price", v)} keyboardType="decimal-pad" placeholder="80" error={errors.price} />
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>Category</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ITEM_CATEGORIES.map((c) => (
            <Chip key={c.value} label={c.label} active={f.category === c.value} onPress={() => set("category", c.value)} />
          ))}
        </View>
        {errors.category ? <Text style={{ color: colors.red, fontSize: 12 }}>{errors.category}</Text> : null}
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>Condition</Text>
        <Segmented options={ITEM_CONDITIONS.map((c) => ({ value: c.value, label: c.label }))} value={f.condition} onChange={(v) => set("condition", v)} />
        <Field label="Description" value={f.description} onChangeText={(v) => set("description", v)} multiline placeholder="Size, brand, any wear, why you're selling" error={errors.description} />
        <Field label="Pickup location" value={f.pickupLocation} onChangeText={(v) => set("pickupLocation", v)} placeholder="Near campus" />
      </FormSection>
      <Button title="Post item" onPress={() => void submit()} loading={busy} />
    </ScrollView>
  );
}
