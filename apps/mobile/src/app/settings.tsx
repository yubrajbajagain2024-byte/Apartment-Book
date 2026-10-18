import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { deleteMyAccount, isProfileVisibility, listUniversities, normalizeUsername, PROFILE_VISIBILITY_COLUMNS, setShowActiveStatus, updateProfile, USERNAME_RULES, usernameProblem, type ProfileSection, type ProfileVisibility, type ProfileWithUniversity } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { VisibilityPicker } from "@/components/profile/visibility-row";
import { Button, Chip, Eyebrow, Field } from "@/components/ui";
import { errorText, useQuery } from "@/lib/hooks";
import { THEME_PREFERENCES } from "@/lib/palette";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space, type } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import { useChangeAvatar } from "@/lib/use-change-avatar";

/** The database's defaults, for a profile read before these settings existed. */
const DEFAULT_VISIBILITY: Record<ProfileSection, ProfileVisibility> = { classes: "friends", saved: "private", liked: "public" };
const SECTIONS: ProfileSection[] = ["classes", "saved", "liked"];
/** The line under System Default in the Theme card (the app is iPhone-only on iOS). */
const SYSTEM_THEME_HINT = Platform.OS === "ios" ? "Follows your iPhone's appearance" : "Follows your phone's appearance";

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
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
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
  // The profile as it is now, not as it was when the app opened: a choice made since on the website shows here.
  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
    }, [refreshProfile]),
  );

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
        username: handleChanged ? handle : undefined,
        classesVisibility: changed("classes"),
        savedVisibility: changed("saved"),
        likedVisibility: changed("liked"),
      });
      // Only when the switch was flipped, and through the one call that may show it again (migration 22).
      if (active !== profile.show_active_status) await setShowActiveStatus(supabase, active);
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
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.photo}>
        <Avatar name={fullName} url={avatarUrl} size="xl" />
        <Button title="Change photo" variant="secondary" size="sm" icon="image-outline" onPress={() => void changeAvatar()} loading={avatar.busy} />
      </View>
      <View style={styles.group}>
        <Field label="Full name" value={fullName} onChangeText={setFullName} />
        <View style={{ gap: 6 }}>
          <Eyebrow style={styles.label}>Username</Eyebrow>
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
              keyboardAppearance={isDark ? "dark" : "light"}
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
        <View style={{ gap: 6 }}>
          <Eyebrow style={styles.label}>University</Eyebrow>
          <View style={styles.chips}>
            {(universities ?? []).slice(0, 12).map((u) => (
              <Chip key={u.id} label={u.name} active={universityId === u.id} onPress={() => setUniversityId(u.id)} />
            ))}
          </View>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionLabel} accessibilityRole="header">
          Privacy
        </Text>
        <View style={styles.group}>
          {SECTIONS.map((section) => (
            <VisibilityPicker key={section} section={section} value={visibility[section]} onChange={(v) => setVisibility((prev) => ({ ...prev, [section]: v }))} />
          ))}
        </View>
      </View>
      <View style={[styles.group, styles.rows]}>
        <ToggleRow label="Notify me about new places within 2 miles of campus" value={notify} onChange={setNotify} />
        <ToggleRow
          label="Show your activity status"
          hint="Others see when you're active, and people you've messaged see when you were last active. Turn it off and you won't see theirs, and messages to you show Seen but not Delivered."
          value={active}
          onChange={setActive}
          divider
        />
      </View>
      {message ? <Text style={[styles.message, { color: message === "Saved." ? colors.successText : colors.red }]}>{message}</Text> : null}
      <Button title="Save changes" onPress={() => void save()} loading={busy} />
      <ThemeCard />
      <View style={styles.section}>
        <Text style={styles.sectionLabel} accessibilityRole="header">
          Danger zone
        </Text>
        <View style={styles.group}>
          <Text style={styles.body}>Deleting your account removes your profile, posts, messages and saved items for good.</Text>
          <Button title="Delete my account" variant="danger" icon="trash-outline" onPress={deleteAccount} />
        </View>
      </View>
    </ScrollView>
  );
}

/** Settings → Theme: Light, Dark or System Default. A tap repaints the app at once and is remembered, so it needs no Save. */
function ThemeCard() {
  const styles = useStyles();
  const { colors, preference, setPreference } = useAppTheme();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel} accessibilityRole="header">
        Theme
      </Text>
      <View style={[styles.group, styles.rows]} accessibilityRole="radiogroup">
        {THEME_PREFERENCES.map((option, i) => {
          const checked = option.value === preference;
          const hint = option.value === "system" ? SYSTEM_THEME_HINT : undefined;
          return (
            <Pressable
              key={option.value}
              onPress={() => setPreference(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={option.label}
              accessibilityHint={hint}
              style={({ pressed }) => [styles.themeRow, i > 0 && styles.themeDivider, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.themeLabel}>{option.label}</Text>
                {hint ? <Text style={styles.hint}>{hint}</Text> : null}
              </View>
              {checked ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A setting that is on or off, with an optional line under it saying what it does. */
function ToggleRow({ label, hint, value, onChange, divider = false }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; divider?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.toggleRow, divider && styles.rowDivider]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.brand }} accessibilityLabel={label} accessibilityHint={hint} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  photo: { alignItems: "center", gap: space.md, paddingVertical: space.sm },
  // A section: its eyebrow, then the group of rows under it.
  section: { gap: space.sm },
  sectionLabel: { ...type.eyebrow, color: colors.muted, marginLeft: space.xs },
  // Groups are hairline outlines on the card surface, no shadow: nothing here floats.
  group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: space.lg, gap: space.lg },
  // A group of rows draws its own hairlines between them instead of a gap.
  rows: { paddingVertical: space.xs, gap: 0 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  rowLabel: { ...type.bodySmall, color: colors.text },
  label: { marginLeft: 2 },
  // The same soft fill and hairline as a Field, with the "@" fixed at the start.
  handleBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingLeft: 14 },
  at: { fontSize: 16, lineHeight: 20, color: colors.muted, fontWeight: "600" },
  handleInput: { flex: 1, paddingLeft: 2, paddingRight: 14, paddingVertical: 13, fontSize: 16, lineHeight: 20, color: colors.text },
  hint: { ...type.footnote, color: colors.muted, marginLeft: 2 },
  error: { ...type.footnote, color: colors.red, marginLeft: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  body: { ...type.caption, color: colors.muted },
  message: { ...type.caption, fontSize: 14, marginLeft: space.xs },
  themeRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 48, paddingVertical: space.sm },
  themeDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  themeLabel: { ...type.body, color: colors.text },
}));
