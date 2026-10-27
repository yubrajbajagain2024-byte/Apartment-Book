import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GENDER_PREFERENCES,
  ITEM_CATEGORIES,
  ITEM_CONDITIONS,
  budgetLabel,
  createItem,
  createRoommatePost,
  formatDate,
  labelFor,
  type FeedMedia,
  type ListingVideo,
  type PhotoMeta,
} from "@apartment-book/shared";
import { AuroraHeading, AuroraPanel, AuroraPill } from "@/components/aurora";
import { Avatar } from "@/components/avatar";
import { DraftsButton } from "@/components/compose/drafts-button";
import { StepProgress } from "@/components/compose/listing-steps";
import { AUDIENCE_ICONS, audienceSentence } from "@/components/compose/publish-sheets";
import { Icon, type IconName } from "@/components/icon";
import { Fact } from "@/components/listing-detail";
import { categoryIcon } from "@/components/marketplace/item-text";
import { PhotoCarousel } from "@/components/photo-carousel";
import { Button } from "@/components/ui";
import { deleteDraft, saveDraft } from "@/lib/compose-drafts";
import { dropUploads, ensureUpload, useUploads, withCover } from "@/lib/compose-media";
import { useCloseCompose } from "@/lib/compose-nav";
import { compose, isListing, useCompose } from "@/lib/compose-store";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { LISTING_WORDS, listingAudienceOf, parseListing } from "@/lib/listing-compose";
import { markMyAnonymousListing } from "@/lib/listing-poster";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { listingPlace, useListingPrivacyAvailable, useListingUploads, useVerifiedCampus } from "@/lib/use-listing-compose";
import { textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/**
 * The last step: the listing as it will look on its own page (its pictures, title and price or budget, the facts,
 * the description and the preferences, and who posted it, "Anonymous" when it is), with who can see it, then Drafts
 * and Post. Each part has Edit, back to its step. Post waits for any upload still going (the bar counts it), checks the
 * whole listing once more and opens it once it is up.
 */
export default function ListingPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useAppTheme();
  const { user, profile } = useSession();
  const s = useCompose();
  const uploads = useUploads();
  const closeCompose = useCloseCompose();
  const mode = isListing(s.mode) ? s.mode : "item";
  const words = LISTING_WORDS[mode];
  const f = s.listing;
  const { campusId, campus } = useVerifiedCampus();
  const privacyOk = useListingPrivacyAvailable();
  const [busy, setBusy] = useState<"post" | "draft" | null>(null);
  const audience = listingAudienceOf(s, campusId);
  const opts = { campusId, profileUniversityId: profile?.university_id ?? null };
  useListingUploads(s);

  const media = useMemo<FeedMedia[]>(
    () =>
      s.media.map((m) =>
        m.kind === "video"
          ? { type: "video", playbackUrl: m.uri, poster: m.thumbUri, width: m.width, height: m.height, durationSeconds: m.duration }
          : { type: "photo", url: m.uri, width: m.width, height: m.height, blur: null },
      ),
    [s.media],
  );
  const statuses = s.media.map((m) => uploads[m.id]);
  const progress = statuses.length === 0 ? 1 : statuses.reduce((sum, u) => sum + (u ? (u.phase === "done" ? 1 : u.phase === "processing" ? 0.95 : u.progress * 0.9) : 0), 0) / statuses.length;

  const lead =
    mode === "roommate"
      ? (() => {
          const b = budgetLabel({ budget_min: f.budgetMin ? Number(f.budgetMin) : null, budget_max: f.budgetMax ? Number(f.budgetMax) : null, currency: "USD" });
          return b ? `${b} / month` : null;
        })()
      : f.price === "0"
        ? "Free"
        : f.price
          ? `$${f.price}`
          : null;

  const editDetails = () => router.dismissTo("/compose/listing" as never);
  const editForm = () => router.back();

  async function saveAsDraft() {
    if (!user || busy) return;
    setBusy("draft");
    try {
      await saveDraft(user.id, compose.get());
      hapticSuccess();
      dropUploads();
      compose.start(s.mode);
      closeCompose();
    } catch (e) {
      alertWithHaptic("error", "Couldn't save the draft", e instanceof Error ? e.message : "Please try again.");
      setBusy(null);
    }
  }

  async function post() {
    if (!user || busy) return;
    const now = compose.get();
    // Before the database keeps anonymity and audiences, a listing is never quietly posted under a name or to everyone.
    if (privacyOk === false && (now.anonymous || listingAudienceOf(now, campusId) !== "global")) {
      Alert.alert("Not available yet", "Posting anonymously and choosing who sees a listing arrive with the next update. You can post it now under your name, for everyone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Post under my name",
          onPress: () => {
            compose.update({ anonymous: false, audience: "global" });
            void post();
          },
        },
      ]);
      return;
    }
    setBusy("post");
    try {
      const done = await Promise.all(now.media.map((m) => ensureUpload(m, user.id, listingPlace(now))));
      const photos: PhotoMeta[] = [];
      let video: ListingVideo | null = null;
      done.forEach((d, i) => {
        if (d.kind === "photo") photos.push(d.photo);
        else video = withCover(d.video, now.media[i].coverTime);
      });
      const parsed = parseListing(now, { ...opts, photos, video });
      if (!parsed.ok) {
        alertWithHaptic("error", "Almost there", parsed.first);
        setBusy(null);
        return;
      }
      const created = parsed.mode === "roommate" ? await createRoommatePost(supabase, user.id, parsed.data) : await createItem(supabase, user.id, parsed.data);
      hapticSuccess();
      if (now.anonymous) markMyAnonymousListing(user.id, mode, created.id);
      if (now.draftId) void deleteDraft(user.id, now.draftId);
      dropUploads();
      compose.start(now.mode);
      closeCompose();
      router.push({ pathname: mode === "roommate" ? "/roommates/[id]" : "/marketplace/[id]", params: { id: created.id } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      // A database without migration 43 (marketplace video) has no place for an item's video yet.
      if (/'videos' column/.test(message)) alertWithHaptic("error", "Videos are not on yet", "Videos on Marketplace items arrive with the next update. Remove the video to post with your photos now.");
      else alertWithHaptic("error", `Couldn't post your ${words.noun}`, message || "Please try again.");
      setBusy(null);
    }
  }

  const prefs: { icon: IconName; label: string; value: string }[] = [
    { icon: "person-outline", label: "Roommate gender", value: labelFor(GENDER_PREFERENCES, f.genderPreference) },
    { icon: "moon-outline", label: "Sleep schedule", value: f.sleepSchedule || "Not specified" },
    { icon: "sparkles-outline", label: "Cleanliness", value: f.cleanliness || "Not specified" },
    { icon: "flame-outline", label: "Smoking", value: f.smokingOk ? "Okay" : "No smoking" },
    { icon: "paw-outline", label: "Pets", value: f.petsOk ? "Okay" : "No pets" },
  ];
  const postLabel = busy === "post" ? (progress < 1 ? `Posting ${Math.round(progress * 100)}%` : "Posting…") : "Post";
  const name = profile?.full_name?.trim() || "You";

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Preview" }} />
      <StepProgress step={4} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {media.length > 0 ? (
          <View style={styles.frame}>
            <PhotoCarousel media={media} aspect={4 / 5} videoLabel={null} />
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.headRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{s.title.trim()}</Text>
              {lead ? <Text style={styles.lead}>{lead}</Text> : null}
            </View>
            <Edit label="Edit details" onPress={editDetails} />
          </View>
          <View style={styles.facts}>
            {mode === "roommate" ? (
              <>
                {f.location.trim() ? <Fact accent icon="location-outline" label={f.location.trim()} /> : null}
                {f.moveInDate ? <Fact accent icon="calendar-outline" label={`Move in ${formatDate(f.moveInDate)}`} /> : null}
                {campus ? <Fact accent icon="school-outline" label={campus} /> : null}
              </>
            ) : (
              <>
                {f.pickupLocation.trim() ? <Fact accent icon="location-outline" label={f.pickupLocation.trim()} /> : null}
                {f.category ? <Fact accent icon={categoryIcon(f.category)} label={labelFor(ITEM_CATEGORIES, f.category)} /> : null}
              </>
            )}
          </View>
          <View style={styles.pills}>
            {mode === "roommate" ? (
              <AuroraPill icon={f.postType === "has_room" ? "home-outline" : "search-outline"} label={f.postType === "has_room" ? "Has a room to share" : "Looking for a room"} />
            ) : (
              <AuroraPill icon="sparkles-outline" label={labelFor(ITEM_CONDITIONS, f.condition)} />
            )}
          </View>
          <AuroraHeading>About</AuroraHeading>
          <Text style={styles.body}>{s.caption.trim()}</Text>
          {mode === "roommate" ? (
            <>
              <View style={styles.headRow}>
                <View style={{ flex: 1 }}>
                  <AuroraHeading>Preferences</AuroraHeading>
                </View>
                <Edit label="Edit listing" onPress={editForm} />
              </View>
              <View style={styles.prefs}>
                {prefs.map((p) => (
                  <AuroraPanel key={p.label} style={{ width: "48.5%", gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Icon name={p.icon} size={13} color={colors.auroraInk} />
                      <Text style={styles.prefLabel} numberOfLines={1}>
                        {p.label}
                      </Text>
                    </View>
                    <Text style={styles.prefValue}>{p.value}</Text>
                  </AuroraPanel>
                ))}
              </View>
            </>
          ) : (
            <View style={styles.editRow}>
              <Edit label="Edit price, category and pickup" onPress={editForm} />
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.poster}>
            <Avatar name={name} url={s.anonymous ? null : (profile?.avatar_url ?? null)} size="md" online={false} anonymous={s.anonymous} />
            <View style={{ flex: 1 }}>
              <Text style={styles.posterName}>{s.anonymous ? "Anonymous" : name}</Text>
              <Text style={styles.posterHint}>{s.anonymous ? "This is all anyone will see of you. Only you'll know it's yours." : "Posted under your name, with your profile."}</Text>
            </View>
          </View>
          <View style={styles.reach}>
            <Icon name={AUDIENCE_ICONS[audience].icon} sf={AUDIENCE_ICONS[audience].sf} size={18} color={colors.muted} />
            <Text style={styles.reachText}>{audienceSentence(audience, words.noun, campus, 0).replace("can view", "can see")}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <DraftsButton busy={busy === "draft"} disabled={busy !== null} onPress={() => void saveAsDraft()} />
        <View style={{ flex: 1 }}>
          <Button title={postLabel} icon={busy === "post" ? undefined : "arrow-up-circle"} size="large" disabled={busy !== null} onPress={() => void post()} />
        </View>
      </View>
    </View>
  );
}

function Edit({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.edit, pressed && { opacity: 0.6 }]}>
      <Text style={styles.editText}>Edit</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  frame: { marginHorizontal: 16, marginTop: 4, borderRadius: 18, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.skeleton },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { ...textStyle.title2, color: colors.text },
  lead: { fontSize: 17, fontWeight: "700", color: colors.brand, marginTop: 2 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingVertical: 2 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  prefs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  prefLabel: { fontSize: 12, color: colors.muted },
  prefValue: { fontSize: 15, fontWeight: "600", color: colors.text },
  editRow: { flexDirection: "row", justifyContent: "flex-end" },
  edit: { paddingHorizontal: 12, height: 30, borderRadius: 15, justifyContent: "center", backgroundColor: colors.input },
  editText: { fontSize: 14, fontWeight: "600", color: colors.brand },
  poster: { flexDirection: "row", alignItems: "center", gap: 12 },
  posterName: { fontSize: 16, fontWeight: "700", color: colors.text },
  posterHint: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 1 },
  reach: { flexDirection: "row", alignItems: "center", gap: 10 },
  reachText: { flex: 1, fontSize: 14, color: colors.muted },
  bar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg },
}));
