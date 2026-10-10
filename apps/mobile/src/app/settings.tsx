import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { deleteMyAccount, isProfileVisibility, listUniversities, normalizeUsername, PROFILE_VISIBILITY_COLUMNS, updateProfile, USERNAME_RULES, usernameProblem, type ProfileSection, type ProfileVisibility, type ProfileWithUniversity } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { VisibilityPicker } from "@/components/profile/visibility-row";
import { Button, Card, Chip, Field } from "@/components/ui";
import { errorText, useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { useChangeAvatar } from "@/lib/use-change-avatar";

/** The database's defaults, for a profile read before these settings existed. */
const DEFAULT_VISIBILITY: Record<ProfileSection, ProfileVisibility> = { classes: "friends", saved: "private", liked: "public" };
const SECTIONS: ProfileSection[] = ["classes", "saved", "liked"];

function storedUsername(profile: ProfileWithUniversity): string {
  const name: unknown = profile.username;
  return typeof name === "string" ? name : "";
}

function storedVisibility(profile: ProfileWithUniversity, section: ProfileSection): ProfileVisibility {
  const value: unknown = profile[PROFILE_VISIBILITY_COLUMNS[section]];
  return isProfileVisibility(value) ? value : DEFAULT_VISIBILITY[section];
}

export default function SettingsScreen() {
  const { user, profile, loading: sessionLoading, refreshProfile, signOut } = useSession();
  const router = useRouter();
  const { data: universities } = useQuery(() => listUniversities(supabase), []);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Record<ProfileSection, ProfileVisibility>>(DEFAULT_VISIBILITY);
  const [program, setProgram] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const avatar = useChangeAvatar();

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name);
    setUsername(storedUsername(profile));
    setUsernameError(null);
    setVisibility({ classes: storedVisibility(profile, "classes"), saved: storedVisibility(profile, "saved"), liked: storedVisibility(profile, "liked") });
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
    if (!user || !profile) return;
    // The username and the privacy choices go to the server only when they changed, so the rest saves on its own.
    const handle = normalizeUsername(username);
    const handleChanged = handle !== storedUsername(profile);
    const problem = handleChanged ? usernameProblem(handle) : null;
    setUsernameError(problem);
    setMessage(problem ? "Check your username above." : null);
    if (problem) return;
    const changed = (section: ProfileSection) => (visibility[section] !== storedVisibility(profile, section) ? visibility[section] : undefined);
    setBusy(true);
    try {
      await updateProfile(supabase, user.id, {
        fullName: fullName.trim(),
        program: program.trim() || null,
        bio: bio.trim() || null,
        avatarUrl,
        universityId,
        graduationYear: profile.graduation_year ?? null,
        notifyNearbyListings: notify,
        showActiveStatus: active,
        username: handleChanged ? handle : undefined,
        classesVisibility: changed("classes"),
        savedVisibility: changed("saved"),
        likedVisibility: changed("liked"),
      });
      await refreshProfile();
      setMessage("Saved.");
    } catch (e) {
      const text = errorText(e, "Could not save");
      // "That username is taken. Try another one." belongs under the field as well as here.
      if (handleChanged && /username/i.test(text)) setUsernameError(text);
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }
  async function changeAvatar() {
    const url = await avatar.change();
    if (url) setAvatarUrl(url);
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
        <Button title="Change photo" variant="secondary" icon="image-outline" onPress={() => void changeAvatar()} loading={avatar.busy} />
      </Card>
      <Card>
        <Field label="Full name" value={fullName} onChangeText={setFullName} />
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Username</Text>
          <View style={[styles.handleBox, usernameError ? { borderColor: colors.red } : null]}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={username}
              onChangeText={(v) => {
                setUsername(v.replace(/^@+/, ""));
                if (usernameError) setUsernameError(null);
              }}
              placeholder="yourname"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Username"
              accessibilityHint={USERNAME_RULES}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              maxLength={30}
              style={styles.handleInput}
            />
          </View>
          {usernameError ? <Text style={styles.error}>{usernameError}</Text> : <Text style={styles.hint}>{USERNAME_RULES}</Text>}
        </View>
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
        <Text style={styles.cardTitle} accessibilityRole="header">
          Privacy
        </Text>
        {SECTIONS.map((section) => (
          <VisibilityPicker key={section} section={section} value={visibility[section]} onChange={(v) => setVisibility((prev) => ({ ...prev, [section]: v }))} />
        ))}
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

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  handleBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingLeft: 12 },
  at: { fontSize: 16, color: colors.muted, fontWeight: "600" },
  handleInput: { flex: 1, paddingLeft: 2, paddingRight: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  hint: { color: colors.muted, fontSize: 12 },
  error: { color: colors.red, fontSize: 12 },
  cardTitle: { fontWeight: "700", color: colors.text, fontSize: 16 },
});
