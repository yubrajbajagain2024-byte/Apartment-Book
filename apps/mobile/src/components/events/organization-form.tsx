import { useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { createOrganization, ORGANIZATION_KINDS, organizationFormSchema, updateOrganization, type Organization, type OrganizationKind, type PhotoMeta } from "@apartment-book/shared";
import { FormSection, Segmented } from "@/components/form";
import { MediaPicker } from "@/components/photo-picker";
import { Button, Field } from "@/components/ui";
import { alertWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

/**
 * The form behind "New organization" and "Edit organization": the name (one of a name per campus), what kind it is, a
 * few words, the website and a picture. The database puts a new one on the person's campus, unverified, with them as
 * its owner; staff verify it in the console before its events show to the campus.
 */
export function OrganizationForm({ organization, onDone }: { organization?: Organization; onDone: (saved: Organization) => void }) {
  const styles = useStyles();
  const { user } = useSession();
  const [name, setName] = useState(organization?.name ?? "");
  const [kind, setKind] = useState<OrganizationKind>((organization?.kind as OrganizationKind | undefined) ?? "club");
  const [description, setDescription] = useState(organization?.description ?? "");
  const [website, setWebsite] = useState(organization?.website ?? "");
  const [existingImage, setExistingImage] = useState<string | null>(organization?.avatar_url ?? null);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function submit() {
    const parsed = organizationFormSchema.safeParse({ name, kind, description, website, avatarUrl: photos[0]?.url ?? existingImage ?? "" });
    if (!parsed.success) {
      Alert.alert("Almost there", parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    setBusy(true);
    try {
      const saved = organization ? await updateOrganization(supabase, organization.id, parsed.data) : await createOrganization(supabase, parsed.data);
      onDone(saved);
    } catch (e) {
      alertWithHaptic("error", organization ? "Could not save" : "Could not create", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <FormSection title="About">
        <Field label="Name" value={name} onChangeText={setName} placeholder="Robotics Club" maxLength={80} />
        <Segmented options={ORGANIZATION_KINDS.map((k) => ({ value: k.value, label: k.label.replace("University ", "").replace("Student ", "") }))} value={kind} onChange={setKind} />
        <Field label="A few words" value={description} onChangeText={setDescription} placeholder="Who you are, what you do, when you meet." multiline maxLength={1000} />
        <Field label="Website" value={website} onChangeText={setWebsite} placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url" hint="Optional. Shown on your page." />
      </FormSection>
      <FormSection title="Picture">
        {existingImage && photos.length === 0 ? (
          <View style={styles.existing}>
            <Image source={{ uri: existingImage }} style={styles.existingImage} contentFit="cover" />
            <Button title="Remove picture" variant="secondary" size="compact" onPress={() => setExistingImage(null)} />
          </View>
        ) : (
          <MediaPicker kind="organizations" userId={user.id} photos={photos} onPhotos={(p) => setPhotos(p.slice(-1))} plain maxPhotos={1} />
        )}
      </FormSection>
      <Button title={organization ? "Save changes" : "Create organization"} size="large" loading={busy} onPress={() => void submit()} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  existing: { flexDirection: "row", alignItems: "center", gap: space.md },
  existingImage: { width: 72, height: 72, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.skeleton, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
}));
