import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { Stack, useNavigation, useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LISTING_AUDIENCES, type PostAudience } from "@apartment-book/shared";
import { CoverPicker } from "@/components/compose/cover-picker";
import { DraftsButton } from "@/components/compose/drafts-button";
import { GallerySheet } from "@/components/compose/gallery-sheet";
import { IdentitySheet, MediaRow, StepProgress } from "@/components/compose/listing-steps";
import { AUDIENCE_ICONS, AudienceSheet, SettingRow, audienceSentence } from "@/components/compose/publish-sheets";
import { useActionSheet } from "@/components/action-sheet";
import { Button } from "@/components/ui";
import { saveDraft } from "@/lib/compose-drafts";
import { dropUploads, ensureUpload, useUploads } from "@/lib/compose-media";
import { useCloseCompose } from "@/lib/compose-nav";
import { compose, isListing, roomFor, useCompose, type ComposeMedia } from "@/lib/compose-store";
import { alertWithHaptic, hapticError, hapticSuccess } from "@/lib/haptics";
import { LISTING_WORDS, listingAudienceOf, stepErrors, type ListingErrors } from "@/lib/listing-compose";
import { useSession } from "@/lib/session";
import { listingPlace, useListingPrivacyAvailable, useListingUploads, useVerifiedCampus } from "@/lib/use-listing-compose";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const TITLE_MAX = 120;
const ABOUT_MAX = 4000;
type Open = "audience" | "identity" | "gallery" | null;

/**
 * A listing's second step, after the camera (or Skip), laid out as a post's publish screen is: its pictures in a row (+
 * for more, tap to edit), the title in bold and the description under it, then who can see it (the poster's campus,
 * everyone, or friends) and who it is posted as (their name, or Anonymous, explained where it is chosen), over Drafts
 * and Next. The pictures start uploading here, each to where it belongs (an anonymous listing's to the folder with no
 * names in it). Next checks the title and the description with the listing rules, field by field, under the field.
 */
export default function ListingDetailsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const { user, profile } = useSession();
  const s = useCompose();
  const uploads = useUploads();
  const show = useActionSheet();
  const closeCompose = useCloseCompose();
  const mode = isListing(s.mode) ? s.mode : "item";
  const words = LISTING_WORDS[mode];
  const { campusId, campus } = useVerifiedCampus();
  const privacyOk = useListingPrivacyAvailable();
  const [open, setOpen] = useState<Open>(null);
  const [cover, setCover] = useState<ComposeMedia | null>(null);
  const [errors, setErrors] = useState<ListingErrors>({});
  const [busy, setBusy] = useState(false);
  const about = useRef<TextInputInstance>(null);
  const audience = listingAudienceOf(s, campusId);
  const room = roomFor(s);
  const opts = { campusId, profileUniversityId: profile?.university_id ?? null };
  useListingUploads(s);

  // On a database that cannot keep them yet, a listing is what listings always were: under its poster's name, for
  // everyone. Said once, under the two rows, rather than pretending otherwise.
  const unavailable = privacyOk === false;
  useEffect(() => {
    if (unavailable && (s.audience !== "global" || s.anonymous)) compose.update({ audience: "global", anonymous: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unavailable]);

  // Once a problem is shown, it goes as soon as the field is right.
  useEffect(() => {
    if (Object.keys(errors).length > 0) setErrors(stepErrors(compose.get(), "details", opts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.title, s.caption, audience]);

  function next() {
    const found = stepErrors(compose.get(), "details", opts);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      hapticError();
      return;
    }
    router.push("/compose/listing-form" as never);
  }

  function addMore() {
    show(
      [
        { label: "Take a photo or video", icon: "camera-outline", onPress: () => router.dismissTo("/compose") },
        { label: "Choose from library", icon: "images-outline", onPress: () => setOpen("gallery") },
      ],
      `Add to your ${words.noun}`,
    );
  }

  function openItem(m: ComposeMedia) {
    if (m.kind === "video") return setCover(m);
    // Photos are edited in the editor: one step back, or (skipped, opened from a draft) in this screen's place.
    const below = navigation.getState()?.routes.at(-2)?.name;
    if (below === "edit") router.back();
    else router.replace("/compose/edit");
  }

  async function saveAsDraft() {
    if (!user || busy) return;
    setBusy(true);
    try {
      await saveDraft(user.id, compose.get());
      hapticSuccess();
      dropUploads();
      compose.start(s.mode);
      closeCompose();
    } catch (e) {
      alertWithHaptic("error", "Couldn't save the draft", e instanceof Error ? e.message : "Please try again.");
      setBusy(false);
    }
  }

  const identityTitle = s.anonymous ? "Posting anonymously" : `Posting as ${profile?.full_name?.trim() || "you"}`;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: words.screen }} />
      <StepProgress step={2} />
      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={{ paddingBottom: 24 }}>
        <MediaRow
          media={s.media}
          uploads={uploads}
          canAdd={room.photos + room.videos > 0}
          onOpen={openItem}
          onAdd={addMore}
          onRetry={(m) => user && void ensureUpload(m, user.id, listingPlace(s)).catch(() => {})}
          emptyHint={mode === "roommate" ? (s.listing.postType === "has_room" ? "Show the room: a short video works best." : "Optional, but posts with photos get more messages.") : "Listings with photos sell faster."}
        />

        <View style={styles.words}>
          <TextInput
            value={s.title}
            onChangeText={(title) => compose.update({ title })}
            placeholder={words.titleHint}
            placeholderTextColor={colors.faint}
            maxLength={TITLE_MAX}
            returnKeyType="next"
            onSubmitEditing={() => about.current?.focus()}
            submitBehavior="submit"
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Title"
            style={styles.title}
          />
          {errors.title ? <Problem text={errors.title} /> : null}
          <View style={[styles.rule, errors.title ? { backgroundColor: colors.red } : null]} />
          <TextInput
            ref={about}
            value={s.caption}
            onChangeText={(caption) => compose.update({ caption })}
            placeholder={words.aboutHint}
            placeholderTextColor={colors.faint}
            multiline
            maxLength={ABOUT_MAX}
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel={words.aboutLabel}
            style={styles.about}
          />
          <View style={styles.underAbout}>
            {errors.description ? <Problem text={errors.description} /> : <View />}
            {s.caption.length > ABOUT_MAX * 0.8 ? <Text style={styles.count}>{ABOUT_MAX - s.caption.length}</Text> : null}
          </View>
        </View>

        <View style={styles.divider} />

        <SettingRow
          icon={AUDIENCE_ICONS[audience].icon}
          sf={AUDIENCE_ICONS[audience].sf}
          title={audienceSentence(audience, words.noun, campus, 0).replace("can view", "can see")}
          disabled={unavailable}
          onPress={() => setOpen("audience")}
        />
        {errors.audience ? <Problem text={errors.audience} inset /> : null}
        <SettingRow icon={s.anonymous ? "eye-off-outline" : "person-circle-outline"} sf={s.anonymous ? "theatermasks" : "person.crop.circle"} title={identityTitle} disabled={unavailable} onPress={() => setOpen("identity")} />
        {unavailable ? <Text style={styles.note}>Choosing who sees it and posting anonymously arrive with the next update. For now, listings are for everyone, under your name.</Text> : null}
        {s.anonymous ? (
          <Animated.Text entering={FadeIn.duration(180)} style={styles.note}>
            Your name stays off this {words.noun}. People who message you won't see who you are unless you show them, one chat at a time.
          </Animated.Text>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <DraftsButton busy={busy} disabled={busy} onPress={() => void saveAsDraft()} />
        <View style={{ flex: 1 }}>
          <Button title="Next" size="large" disabled={busy} onPress={next} />
        </View>
      </View>

      <AudienceSheet
        visible={open === "audience"}
        value={audience}
        noun={words.noun}
        campus={campus}
        people={0}
        options={LISTING_AUDIENCES}
        note={s.anonymous ? "Whoever can see it can message you, anonymously to them." : "Whoever can see it can message you and share it with people who can see it too."}
        onClose={() => setOpen(null)}
        onChange={(next: PostAudience) => compose.update({ audience: next })}
      />
      <IdentitySheet visible={open === "identity"} anonymous={s.anonymous} name={profile?.full_name ?? ""} avatarUrl={profile?.avatar_url ?? null} noun={words.noun} onClose={() => setOpen(null)} onChange={(anonymous) => compose.update({ anonymous })} />
      <GallerySheet
        visible={open === "gallery"}
        mode={s.mode}
        room={room}
        onClose={() => setOpen(null)}
        onPicked={(items) => {
          compose.add(items);
          setOpen(null);
        }}
      />
      {cover ? (
        <CoverPicker
          item={cover}
          onCancel={() => setCover(null)}
          onDone={(nextItem) => {
            compose.replace(cover.id, nextItem);
            setCover(null);
          }}
        />
      ) : null}
    </View>
  );
}

function Problem({ text, inset = false }: { text: string; inset?: boolean }) {
  const styles = useStyles();
  return (
    <Animated.Text entering={FadeIn.duration(160)} style={[styles.problem, inset && { paddingHorizontal: 16 }]} accessibilityLiveRegion="polite">
      {text}
    </Animated.Text>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  words: { paddingHorizontal: 16, paddingTop: 12 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, paddingVertical: 10 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  about: { minHeight: 132, fontSize: 16, lineHeight: 22, color: colors.text, paddingTop: 12, paddingBottom: 8, textAlignVertical: "top" },
  underAbout: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 12, minHeight: 20 },
  count: { fontSize: 13, color: colors.muted, fontVariant: ["tabular-nums"] },
  problem: { fontSize: 13, lineHeight: 18, color: colors.red, paddingBottom: 6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginBottom: 4 },
  note: { fontSize: 13, lineHeight: 18, color: colors.muted, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10 },
  bar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg },
}));
