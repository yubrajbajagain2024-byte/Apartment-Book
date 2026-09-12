import { useEffect, useState } from "react";
import { Alert, ScrollView, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { deleteMyAccount, listUniversities, updateProfile } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Button, Card, Chip, Field } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { pickPhotos, uploadPickedPhoto } from "@/lib/photos";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function SettingsScreen() {
  const { user, profile, loading: sessionLoading, refreshProfile, signOut } = useSession();
  const router = useRouter();
  const { data: universities } = useQuery(() => listUniversities(supabase), []);
  const [fullName, setFullName] = useState("");
  const [program, setProgram] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name);
    setProgram(profile.program ?? "");
    setBio(profile.bio ?? "");
    setAvatarUrl(profile.avatar_url);
    setUniversityId(profile.university_id);
    setNotify(profile.notify_nearby_listings);
    setActive(profile.show_active_status);
  }, [profile]);
  useEffect(() => {
    if (!sessionLoading && !user) router.replace("/(auth)/login");
  }, [sessionLoading, user, router]);

  async function save() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      await updateProfile(supabase, user.id, { fullName: fullName.trim(), program: program.trim() || null, bio: bio.trim() || null, avatarUrl, universityId, graduationYear: profile?.graduation_year ?? null, notifyNearbyListings: notify, showActiveStatus: active });
      await refreshProfile();
      setMessage("Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function changeAvatar() {
    if (!user) return;
    const [asset] = await pickPhotos(1).catch(() => []);
    if (!asset) return;
    const meta = await uploadPickedPhoto(asset, "avatars", user.id).catch((e: Error) => {
      Alert.alert("Photo", e.message);
      return null;
    });
    if (meta) setAvatarUrl(meta.url);
  }
  function deleteAccount() {
    Alert.alert("Delete your account?", "Your profile, posts, messages and saved items will be permanently deleted. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete account",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMyAccount(supabase);
            await signOut();
            router.dismissTo("/(tabs)");
          } catch (e) {
            Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again later");
          }
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Card style={{ alignItems: "center" }}>
        <Avatar name={fullName} url={avatarUrl} size="xl" />
        <Button title="Change photo" variant="secondary" icon="image-outline" onPress={() => void changeAvatar()} />
      </Card>
      <Card>
        <Field label="Full name" value={fullName} onChangeText={setFullName} />
        <Field label="Program" value={program} onChangeText={setProgram} placeholder="Computer Science" />
        <Field label="Bio" value={bio} onChangeText={setBio} multiline placeholder="A line or two about you" />
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>University</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(universities ?? []).slice(0, 12).map((u) => (
            <Chip key={u.id} label={u.name} active={universityId === u.id} onPress={() => setUniversityId(u.id)} />
          ))}
        </View>
      </Card>
      <Card>
        <ToggleRow label="Notify me about new places within 2 miles of campus" value={notify} onChange={setNotify} />
        <ToggleRow label="Show when I'm active (green dot and “Active now” in chats)" value={active} onChange={setActive} />
      </Card>
      {message ? <Text style={{ color: message === "Saved." ? colors.green : colors.red }}>{message}</Text> : null}
      <Button title="Save changes" onPress={() => void save()} loading={busy} />
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Danger zone</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Deleting your account removes your profile, posts, messages and saved items for good.</Text>
        <Button title="Delete my account" variant="danger" icon="trash-outline" onPress={deleteAccount} />
      </Card>
    </ScrollView>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text style={{ flex: 1, color: colors.text }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.brand }} accessibilityLabel={label} />
    </View>
  );
}
