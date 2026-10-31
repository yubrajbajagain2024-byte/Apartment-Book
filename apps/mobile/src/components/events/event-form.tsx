import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { createEvent, EVENT_CATEGORIES, eventFormSchema, listMyOrganizations, updateEvent, type EventCategory, type EventSummary, type PhotoMeta } from "@apartment-book/shared";
import { CheckRow, FormSection, Segmented } from "@/components/form";
import { Icon } from "@/components/icon";
import { MediaPicker } from "@/components/photo-picker";
import { Button, Chip, EmptyState, Field, Loading } from "@/components/ui";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { errorText, useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { categoryIcon } from "./event-glyphs";

/** The next full hour, an hour from now: where a new event's start lands before the person touches it. */
function nextHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** The date of one picker and the time of the other, kept together in one Date. */
function merge(base: Date, picked: Date, mode: "date" | "time"): Date {
  const d = new Date(base);
  if (mode === "date") d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  else d.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return d;
}

/**
 * One "Starts" or "Ends" row: on iOS the system's compact date and time pickers inline, on Android two buttons that open
 * the system dialogs (see profile/classes-section.tsx for the same split). All day hides the time.
 */
function WhenRow({ label, value, onChange, allDay, minimumDate, onClear }: { label: string; value: Date; onChange: (d: Date) => void; allDay: boolean; minimumDate?: Date; onClear?: () => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const openAndroid = (mode: "date" | "time") =>
    DateTimePickerAndroid.open({
      value,
      mode,
      is24Hour: false,
      minimumDate: mode === "date" ? minimumDate : undefined,
      onChange: (e, d) => {
        if (e.type === "set" && d) onChange(merge(value, d, mode));
      },
    });
  return (
    <View style={styles.whenRow}>
      <Text style={styles.whenLabel}>{label}</Text>
      <View style={styles.whenPickers}>
        {Platform.OS === "ios" ? (
          <>
            <DateTimePicker value={value} mode="date" display="compact" minimumDate={minimumDate} onChange={(_e, d) => d && onChange(merge(value, d, "date"))} themeVariant={isDark ? "dark" : "light"} accentColor={colors.brand} accessibilityLabel={`${label} date`} />
            {!allDay ? <DateTimePicker value={value} mode="time" display="compact" minuteInterval={5} onChange={(_e, d) => d && onChange(merge(value, d, "time"))} themeVariant={isDark ? "dark" : "light"} accentColor={colors.brand} accessibilityLabel={`${label} time`} /> : null}
          </>
        ) : (
          <>
            <Pressable onPress={() => openAndroid("date")} accessibilityRole="button" accessibilityLabel={`${label} date`} style={({ pressed }) => [styles.androidPick, pressed && { opacity: 0.6 }]}>
              <Text style={styles.androidPickText}>{value.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</Text>
            </Pressable>
            {!allDay ? (
              <Pressable onPress={() => openAndroid("time")} accessibilityRole="button" accessibilityLabel={`${label} time`} style={({ pressed }) => [styles.androidPick, pressed && { opacity: 0.6 }]}>
                <Text style={styles.androidPickText}>{value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</Text>
              </Pressable>
            ) : null}
          </>
        )}
        {onClear ? (
          <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove the ${label.toLowerCase()} time`}>
            <Icon name="close-circle" size={20} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The form behind "Create event" and "Edit event": which organization (the person's own, pending until staff verify
 * it), the title and words, when (start, an optional end, or all day), where, the category, one picture, the
 * registration link. The database stamps the campus, the author, the source and the status; this checks the input with
 * eventFormSchema and shows the first problem. An all-day event starts at the phone's midnight of its day and ends the
 * morning after its last day (iCalendar's way, which the sync shares).
 */
export function EventForm({ event, initialOrganizationId }: { event?: EventSummary; initialOrganizationId?: string }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const router = useRouter();
  const { user } = useSession();
  const mine = useQuery(() => (user ? listMyOrganizations(supabase, user.id) : Promise.resolve([])), [user?.id]);
  const [organizationId, setOrganizationId] = useState<string | null>(event?.organization_id ?? initialOrganizationId ?? null);
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startsAt, setStartsAt] = useState<Date>(() => (event ? new Date(event.starts_at) : nextHour()));
  const [endsAt, setEndsAt] = useState<Date | null>(() => (event?.ends_at ? new Date(event.all_day ? Date.parse(event.ends_at) - 86400_000 : event.ends_at) : null));
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [location, setLocation] = useState(event?.location ?? "");
  const [category, setCategory] = useState<EventCategory>(event?.category ?? "social");
  const [existingImage, setExistingImage] = useState<string | null>(event?.image_url ?? null);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [registrationUrl, setRegistrationUrl] = useState(event?.registration_url ?? "");
  const [cancelled, setCancelled] = useState(event?.status === "cancelled");
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  if (mine.loading && !mine.data) return <Loading />;
  const organizations = mine.data ?? [];
  if (organizations.length === 0) {
    return (
      <EmptyState
        icon="people-outline"
        title="Events come from organizations"
        body="Clubs, student organizations and university departments publish events once staff have verified them. Create yours, or ask an owner to add you."
        action={<Button title="Create an organization" icon="add" onPress={() => router.replace("/organizations/new" as never)} />}
      />
    );
  }
  const chosen = organizations.find((o) => o.id === organizationId) ?? (organizations.length === 1 ? organizations[0] : undefined);
  const imageUrl = photos[0]?.url ?? existingImage ?? "";

  async function submit() {
    if (!chosen) return Alert.alert("Almost there", "Pick the organization this event is for.");
    const start = new Date(startsAt);
    let end: Date | null = endsAt ? new Date(endsAt) : null;
    if (allDay) {
      start.setHours(0, 0, 0, 0);
      if (end) {
        end.setHours(0, 0, 0, 0);
        end = new Date(end.getTime() + 86400_000);
      }
    }
    const parsed = eventFormSchema.safeParse({
      organizationId: chosen.id,
      title,
      description,
      startsAt: start.toISOString(),
      endsAt: end ? end.toISOString() : "",
      allDay,
      location,
      category,
      imageUrl,
      registrationUrl,
      cancelled,
    });
    if (!parsed.success) {
      Alert.alert("Almost there", parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    setBusy(true);
    try {
      if (event) {
        await updateEvent(supabase, event.id, parsed.data);
        hapticSuccess();
        router.back();
      } else {
        const created = await createEvent(supabase, parsed.data);
        hapticSuccess();
        router.replace({ pathname: "/events/[id]", params: { id: created.id } } as never);
      }
    } catch (e) {
      alertWithHaptic("error", event ? "Could not save" : "Could not publish", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <FormSection title="Organization">
        {organizations.length <= 3 ? (
          <Segmented options={organizations.map((o) => ({ value: o.id, label: o.name }))} value={chosen?.id} onChange={setOrganizationId} />
        ) : (
          <View style={{ gap: space.xs }}>
            {organizations.map((o) => (
              <Pressable key={o.id} onPress={() => setOrganizationId(o.id)} accessibilityRole="radio" accessibilityState={{ checked: chosen?.id === o.id }} style={({ pressed }) => [styles.orgRow, chosen?.id === o.id && styles.orgRowOn, pressed && { opacity: 0.7 }]}>
                <Text style={[styles.orgRowText, chosen?.id === o.id && { color: colors.brand }]} numberOfLines={1}>
                  {o.name}
                </Text>
                {chosen?.id === o.id ? <Icon name="checkmark-circle" size={20} color={colors.brand} /> : null}
              </Pressable>
            ))}
          </View>
        )}
        {chosen && !chosen.verified ? (
          <View style={styles.notice}>
            <Icon name="time-outline" size={16} color={colors.warningText} />
            <Text style={styles.noticeText}>Visible to your members until staff verify {chosen.name}.</Text>
          </View>
        ) : null}
      </FormSection>
      <FormSection title="What">
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Robot Races" maxLength={160} />
        <Field label="Details" value={description} onChangeText={setDescription} placeholder="What happens, who it is for, what to bring." multiline maxLength={5000} />
        <View style={{ gap: space.xs }}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.chips}>
            {EVENT_CATEGORIES.map((c) => (
              <Chip key={c.value} label={c.label} icon={categoryIcon(c.value).name} active={category === c.value} onPress={() => setCategory(c.value)} />
            ))}
          </View>
        </View>
      </FormSection>
      <FormSection title="When">
        <CheckRow label="All day" value={allDay} onChange={setAllDay} />
        <WhenRow label="Starts" value={startsAt} onChange={setStartsAt} allDay={allDay} />
        {endsAt ? <WhenRow label="Ends" value={endsAt} onChange={setEndsAt} allDay={allDay} minimumDate={startsAt} onClear={() => setEndsAt(null)} /> : <Button title="Add an end time" variant="ghost" size="compact" icon="add" onPress={() => setEndsAt(new Date(startsAt.getTime() + 2 * 3600_000))} style={{ alignSelf: "flex-start" }} />}
      </FormSection>
      <FormSection title="Where">
        <Field label="Place" value={location} onChangeText={setLocation} placeholder="LBJ Student Center, Room 3-14.1" maxLength={200} />
      </FormSection>
      <FormSection title="Picture and link">
        {existingImage && photos.length === 0 ? (
          <View style={styles.existing}>
            <Image source={{ uri: existingImage }} style={styles.existingImage} contentFit="cover" />
            <Button title="Remove picture" variant="secondary" size="compact" onPress={() => setExistingImage(null)} />
          </View>
        ) : (
          <MediaPicker kind="events" userId={user.id} photos={photos} onPhotos={(p) => setPhotos(p.slice(-1))} plain maxPhotos={1} />
        )}
        <Field label="Registration or event link" value={registrationUrl} onChangeText={setRegistrationUrl} placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url" hint="Where people sign up or read more. Optional." />
      </FormSection>
      {event ? (
        <FormSection title="Status">
          <CheckRow label="Cancelled" value={cancelled} onChange={setCancelled} />
        </FormSection>
      ) : null}
      <Button title={event ? "Save changes" : "Publish"} size="large" loading={busy} onPress={() => void submit()} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  label: { ...textStyle.footnote, fontWeight: "600", color: colors.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  orgRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.input },
  orgRowOn: { backgroundColor: colors.brandSoft },
  orgRowText: { ...textStyle.subheadline, fontWeight: "600", color: colors.text, flex: 1 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.warningSoft },
  noticeText: { ...textStyle.footnote, color: colors.warningText, flex: 1 },
  whenRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36 },
  whenLabel: { ...textStyle.subheadline, fontWeight: "600", color: colors.text, width: 56 },
  whenPickers: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.sm, flexWrap: "wrap" },
  androidPick: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.input },
  androidPickText: { ...textStyle.subheadline, fontWeight: "600", color: colors.text },
  existing: { gap: space.sm, alignItems: "flex-start" },
  existingImage: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.skeleton, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
}));
