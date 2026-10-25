import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  deleteMyAccount,
  listUniversities,
  normalizeUsername,
  PROFILE_DEFAULT_VISIBILITY,
  PROFILE_SECTIONS,
  profileStudyLine,
  sectionVisibilityOf,
  setShowActiveStatus,
  updateProfile,
  USERNAME_RULES,
  usernameProblem,
  type ProfileSection,
  type ProfileVisibility,
  type ProfileWithUniversity,
} from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { VisibilityPicker } from "@/components/profile/visibility-row";
import { Button, Card, Chip, Field } from "@/components/ui";
import { errorText, useQuery } from "@/lib/hooks";
import { DEFAULT_THEME_PREFERENCE, THEME_PREFERENCES } from "@/lib/palette";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import { useChangeAvatar } from "@/lib/use-change-avatar";
import { hapticSelect, alertWithHaptic } from "@/lib/haptics";
import { Icon } from "@/components/icon";

/** The years the database takes for a graduation year (as the website's form does). */
const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;
/** The line under System Default in the Theme card (the app is iPhone-only on iOS). */
const SYSTEM_THEME_HINT = Platform.OS === "ios" ? "Follows your iPhone's appearance" : "Follows your phone's appearance";

function storedUsername(profile: ProfileWithUniversity): string {
  const name: unknown = profile.username;
  return typeof name === "string" ? name : "";
}

function storedVisibility(profile: ProfileWithUniversity, section: ProfileSection): ProfileVisibility {
  return sectionVisibilityOf(profile, section);
}

function storedVisibilities(profile: ProfileWithUniversity): Record<ProfileSection, ProfileVisibility> {
  return Object.fromEntries(PROFILE_SECTIONS.map((section) => [section, storedVisibility(profile, section)])) as Record<ProfileSection, ProfileVisibility>;
}

/** The year typed, as the database takes it: null for none, NaN for something it would refuse. */
function parseYear(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const year = Number(t);
  return Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR ? year : Number.NaN;
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
  const [visibility, setVisibility] = useState<Record<ProfileSection, ProfileVisibility>>(PROFILE_DEFAULT_VISIBILITY);
  const [program, setProgram] = useState("");
  const [year, setYear] = useState("");
  const [yearError, setYearError] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const avatar = useChangeAvatar();
  // The line under your name as these fields would make it: "CS ’28 @ Texas State University".
  const chosenUniversity = (universities ?? []).find((u) => u.id === universityId) ?? (universityId && profile?.university?.id === universityId ? profile.university : null);
  const typedYear = parseYear(year);
  const studyPreview = profileStudyLine({ program, graduation_year: Number.isNaN(typedYear) ? null : typedYear, university: chosenUniversity });

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name);
    setUsername(storedUsername(profile));
    setUsernameError(null);
    setVisibility(storedVisibilities(profile));
    setProgram(profile.program ?? "");
    setYear(profile.graduation_year ? String(profile.graduation_year) : "");
    setYearError(null);
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
    const graduationYear = parseYear(year);
    const badYear = Number.isNaN(graduationYear) ? `Enter a year from ${FIRST_YEAR} to ${LAST_YEAR}, like 2028.` : null;
    setYearError(badYear);
    setMessage(problem ? "Check your username above." : badYear ? "Check your graduation year above." : null);
    if (problem || badYear) return;
    const changed = (section: ProfileSection) => (visibility[section] !== storedVisibility(profile, section) ? visibility[section] : undefined);
    setBusy(true);
    try {
      await updateProfile(supabase, user.id, {
        fullName: fullName.trim(),
        program: program.trim() || null,
        bio: bio.trim() || null,
        avatarUrl,
        universityId,
        graduationYear,
        notifyNearbyListings: notify,
        username: handleChanged ? handle : undefined,
        classesVisibility: changed("classes"),
        savedVisibility: changed("saved"),
        likedVisibility: changed("liked"),
        listingsVisibility: changed("listings"),
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
    alertWithHaptic("warning", "Delete your account?", "Your profile, posts, messages and saved items will be permanently deleted. This cannot be undone.", [
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
        <View style={styles.studyRow}>
          <View style={{ flex: 1.4 }}>
            <Field label="Major" value={program} onChangeText={setProgram} placeholder="Computer Science" autoCapitalize="words" />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Graduation year"
              value={year}
              onChangeText={(v) => {
                setYear(v.replace(/\D/g, "").slice(0, 4));
                if (yearError) setYearError(null);
              }}
              placeholder="2028"
              keyboardType="number-pad"
              maxLength={4}
              error={yearError}
            />
          </View>
        </View>
        <Text style={styles.hint}>{studyPreview ? `On your profile: ${studyPreview}` : "Your major, class year and university show under your name, like CS ’28 @ Texas State University."}</Text>
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
        <Text style={styles.hint}>Saved, Liked and Listings start as Only me. A tab others may not see doesn't show on your profile for them at all; you always see every tab.</Text>
        {PROFILE_SECTIONS.map((section) => (
          <VisibilityPicker key={section} section={section} value={visibility[section]} onChange={(v) => setVisibility((prev) => ({ ...prev, [section]: v }))} />
        ))}
      </Card>
      <Card>
        <ToggleRow label="Notify me about new places within 2 miles of campus" value={notify} onChange={setNotify} />
        <ToggleRow
          label="Show your activity status"
          hint="Others see when you're active, and people you've messaged see when you were last active. Turn it off and you won't see theirs, and messages to you show Seen but not Delivered."
          value={active}
          onChange={setActive}
        />
      </Card>
      {message ? <Text style={{ color: message === "Saved." ? colors.successText : colors.red }}>{message}</Text> : null}
      <Button title="Save changes" size="large" onPress={() => void save()} loading={busy} />
      <ThemeCard />
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Danger zone</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Deleting your account removes your profile, posts, messages and saved items for good.</Text>
        <Button title="Delete my account" variant="danger" icon="trash-outline" onPress={deleteAccount} />
      </Card>
    </ScrollView>
  );
}

/**
 * Settings → Theme: Light, Dark (the default, marked so) or System Default. A tap repaints the app at once and is
 * remembered, so it needs no Save.
 */
function ThemeCard() {
  const styles = useStyles();
  const { colors, preference, setPreference } = useAppTheme();
  return (
    <Card>
      <Text style={styles.cardTitle} accessibilityRole="header">
        Theme
      </Text>
      <View accessibilityRole="radiogroup">
        {THEME_PREFERENCES.map((option, i) => {
          const checked = option.value === preference;
          const hint = option.value === "system" ? SYSTEM_THEME_HINT : option.value === DEFAULT_THEME_PREFERENCE ? "The default" : undefined;
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
              {checked ? <Icon name="checkmark" size={22} color={colors.brand} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

/** A setting that is on or off, with an optional line under it saying what it does. */
function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text }}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          hapticSelect();
          onChange(next);
        }}
        trackColor={{ true: colors.brand }}
        accessibilityLabel={label}
        accessibilityHint={hint}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  studyRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  handleBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderCurve: "continuous", paddingLeft: 12 },
  at: { fontSize: 16, color: colors.muted, fontWeight: "600" },
  handleInput: { flex: 1, paddingLeft: 2, paddingRight: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  hint: { color: colors.muted, fontSize: 12 },
  error: { color: colors.red, fontSize: 12 },
  cardTitle: { fontWeight: "700", color: colors.text, fontSize: 16 },
  themeRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 8 },
  themeDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  themeLabel: { fontSize: 16, color: colors.text },
}));
