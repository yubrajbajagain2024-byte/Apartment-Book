import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CLEANLINESS_LEVELS, GENDER_PREFERENCES, ITEM_CATEGORIES, ITEM_CONDITIONS, SLEEP_SCHEDULES } from "@apartment-book/shared";
import { DraftsButton } from "@/components/compose/drafts-button";
import { ChoiceChips, DateRow, FieldRow, Group, RowDivider, StepProgress, SwitchRow } from "@/components/compose/listing-steps";
import { Segmented } from "@/components/form";
import { categoryIcon } from "@/components/marketplace/item-text";
import { Button } from "@/components/ui";
import { saveDraft } from "@/lib/compose-drafts";
import { dropUploads } from "@/lib/compose-media";
import { useCloseCompose } from "@/lib/compose-nav";
import { compose, isListing, useCompose } from "@/lib/compose-store";
import { alertWithHaptic, hapticError, hapticSuccess } from "@/lib/haptics";
import { LISTING_WORDS, stepErrors, type ListingErrors } from "@/lib/listing-compose";
import { useSession } from "@/lib/session";
import { useListingUploads, useVerifiedCampus } from "@/lib/use-listing-compose";
import { makeStyles } from "@/lib/theme-provider";

const SLEEP = SLEEP_SCHEDULES.map((v) => ({ value: v, label: v }));
const CLEAN = CLEANLINESS_LEVELS.map((v) => ({ value: v, label: v }));
const POST_TYPES: { value: "needs_room" | "has_room"; label: string }[] = [
  { value: "needs_room", label: "I need a room" },
  { value: "has_room", label: "I have a room" },
];

/**
 * A listing's third step: everything else the listing asks, every field and rule of the old forms, grouped the way
 * iOS Settings groups its rows. A roommate post: what you are looking for, the budget, the move-in date (the system's
 * date picker) and the area, then who you would live with (gender, sleep, cleanliness, smoking, pets). An item: its
 * price (or free), category, condition and where to pick it up. Next checks these fields and shows each problem under
 * its group; the pictures keep uploading meanwhile.
 */
export default function ListingFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { user, profile } = useSession();
  const s = useCompose();
  const closeCompose = useCloseCompose();
  const mode = isListing(s.mode) ? s.mode : "item";
  const words = LISTING_WORDS[mode];
  const f = s.listing;
  const { campusId } = useVerifiedCampus();
  const [errors, setErrors] = useState<ListingErrors>({});
  const [busy, setBusy] = useState(false);
  const opts = { campusId, profileUniversityId: profile?.university_id ?? null };
  useListingUploads(s);

  // Once a problem is shown, it goes as soon as the field is right.
  useEffect(() => {
    if (Object.keys(errors).length > 0) setErrors(stepErrors(compose.get(), "form", opts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  function next() {
    const found = stepErrors(compose.get(), "form", opts);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      hapticError();
      return;
    }
    router.push("/compose/listing-preview" as never);
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

  const set = compose.updateListing;
  const digits = (v: string) => v.replace(/[^0-9]/g, "");
  const money = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: words.screen }} />
      <StepProgress step={3} />
      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={{ paddingBottom: 28 }}>
        {mode === "roommate" ? (
          <>
            <Group title="Looking for" error={errors.postType} bare>
              <Segmented options={POST_TYPES} value={f.postType} onChange={(postType) => set({ postType })} />
            </Group>
            <Group title="Budget and timing" error={errors.budgetMin ?? errors.budgetMax ?? errors.moveInDate} footer="Per month, in US dollars. Leave any of these empty if you're flexible.">
              <FieldRow label="From" prefix="$" value={f.budgetMin} onChangeText={(v) => set({ budgetMin: digits(v) })} keyboardType="number-pad" placeholder="400" error={Boolean(errors.budgetMin)} />
              <RowDivider />
              <FieldRow label="Up to" prefix="$" value={f.budgetMax} onChangeText={(v) => set({ budgetMax: digits(v) })} keyboardType="number-pad" placeholder="650" error={Boolean(errors.budgetMax)} />
              <RowDivider />
              <DateRow label="Move in" value={f.moveInDate} onChange={(moveInDate) => set({ moveInDate })} error={Boolean(errors.moveInDate)} />
              <RowDivider />
              <FieldRow label="Area" value={f.location} onChangeText={(location) => set({ location })} placeholder="Near campus, San Marcos" maxLength={160} error={Boolean(errors.location)} />
            </Group>
            <Group title="Roommate's gender" error={errors.genderPreference} bare>
              <Segmented options={GENDER_PREFERENCES.map((g) => ({ value: g.value, label: g.label }))} value={f.genderPreference} onChange={(genderPreference) => set({ genderPreference })} />
            </Group>
            <Group title="Sleep schedule" error={errors.sleepSchedule}>
              <ChoiceChips options={SLEEP} value={f.sleepSchedule} onChange={(sleepSchedule) => set({ sleepSchedule })} />
            </Group>
            <Group title="Cleanliness" error={errors.cleanliness}>
              <ChoiceChips options={CLEAN} value={f.cleanliness} onChange={(cleanliness) => set({ cleanliness })} />
            </Group>
            <Group title="House rules">
              <SwitchRow label="Smoking is okay" icon="flame-outline" sf="smoke" value={f.smokingOk} onChange={(smokingOk) => set({ smokingOk })} />
              <RowDivider />
              <SwitchRow label="Pets are okay" icon="paw-outline" sf="pawprint" value={f.petsOk} onChange={(petsOk) => set({ petsOk })} />
            </Group>
          </>
        ) : (
          <>
            <Group title="Price" error={errors.price} footer="Type 0 to give it away: it shows as Free.">
              <FieldRow label="Price" prefix="$" value={f.price} onChangeText={(v) => set({ price: money(v) })} keyboardType="decimal-pad" placeholder="80" error={Boolean(errors.price)} />
              <RowDivider />
              <SwitchRow label="It's free" icon="gift-outline" sf="gift" value={f.price === "0"} onChange={(free) => set({ price: free ? "0" : "" })} />
            </Group>
            <Group title="Category" error={errors.category}>
              <ChoiceChips options={ITEM_CATEGORIES} value={f.category} onChange={(category) => set({ category })} clearable={false} icons={(v) => categoryIcon(v)} />
            </Group>
            <Group title="Condition" error={errors.condition}>
              <ChoiceChips options={ITEM_CONDITIONS} value={f.condition} onChange={(condition) => condition && set({ condition })} clearable={false} />
            </Group>
            <Group title="Pickup" error={errors.pickupLocation}>
              <FieldRow label="Where" value={f.pickupLocation} onChangeText={(pickupLocation) => set({ pickupLocation })} placeholder="Near campus" maxLength={160} />
            </Group>
          </>
        )}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <DraftsButton busy={busy} disabled={busy} onPress={() => void saveAsDraft()} />
        <View style={{ flex: 1 }}>
          <Button title="Preview" size="large" disabled={busy} onPress={next} />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg },
}));
