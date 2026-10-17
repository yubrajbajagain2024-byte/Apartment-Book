import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Platform, Pressable, Text, TextInput, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import {
  addProfileClass,
  classCodeProblem,
  classDetails,
  classSectionProblem,
  CLASS_LOCATION_MAX,
  formatClockTime,
  groupClassesByTerm,
  locationProblem,
  MAX_CLASS_MEETINGS,
  meetingsProblem,
  pickableTerms,
  removeProfileClass,
  sortWeekdays,
  WEEKDAYS,
  type ClassMeeting,
  type ProfileClass,
  type Weekday,
} from "@apartment-book/shared";
import { Button } from "@/components/ui";
import { hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";

type UpdateClasses = (fn: (classes: ProfileClass[]) => ProfileClass[]) => void;

/**
 * The Classes tab, the one place a profile shows its classes: grouped by semester, this one first ("Fall 2026 · This
 * semester"). The owner adds a class with a code ("CS 3358", checked as it would be by the database), its section, the
 * days and times it meets, the room and an optional name, and the semester, and removes one with the cross beside it.
 * The section puts them in that section's course chat (the database creates it for the first classmate and adds the
 * rest; removing the class leaves it), which is why it is asked for.
 */
export function ClassesSection({ own, userId, classes, onChange, onOpenForm }: { own: boolean; userId: string; classes: ProfileClass[]; onChange: UpdateClasses; onOpenForm?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const groups = useMemo(() => groupClassesByTerm(classes), [classes]);
  const [adding, setAdding] = useState(false);
  // Close and Remove take away the button that had focus: once the list has redrawn, the screen reader moves to "Add class"
  // (not there while the form is open).
  const addButton = useRef<View>(null);
  const [focusAdd, setFocusAdd] = useState(0);
  useEffect(() => {
    const node = addButton.current;
    if (focusAdd > 0 && node && typeof AccessibilityInfo.sendAccessibilityEvent === "function") AccessibilityInfo.sendAccessibilityEvent(node, "focus");
  }, [focusAdd]);

  async function remove(c: ProfileClass) {
    hapticTap();
    onChange((list) => list.filter((x) => x.id !== c.id));
    setFocusAdd((n) => n + 1);
    try {
      await removeProfileClass(supabase, c.id);
    } catch (e) {
      onChange((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
      Alert.alert(`Could not remove ${c.code}`, errorText(e));
    }
  }

  return (
    <View style={styles.section}>
      {own && adding ? (
        <AddClassForm
          userId={userId}
          onAdded={(c) => onChange((list) => [...list, c])}
          onClose={() => {
            setAdding(false);
            setFocusAdd((n) => n + 1);
          }}
        />
      ) : null}
      {own && !adding ? (
        <Button
          ref={addButton}
          title="Add class"
          variant="secondary"
          icon="add"
          onPress={() => {
            setAdding(true);
            onOpenForm?.();
          }}
        />
      ) : null}
      {groups.length === 0 ? (
        own ? (
          adding ? null : <Text style={styles.empty}>Add the classes you're taking so classmates can find you.</Text>
        ) : (
          <View style={styles.emptyBox}>
            <Ionicons name="school-outline" size={28} color={colors.faint} />
            <Text style={styles.emptyTitle}>No classes listed</Text>
          </View>
        )
      ) : (
        groups.map((g) => (
          <View key={g.term} style={styles.group}>
            <Text style={styles.term} accessibilityRole="header">
              {g.current ? `${g.term} · This semester` : g.term}
            </Text>
            {g.classes.map((c) => (
              <View key={c.id} style={styles.classRow}>
                <View style={styles.codeBadge}>
                  <Ionicons name="book-outline" size={16} color={colors.brand} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.code}>{c.code}</Text>
                  {c.title ? (
                    <Text style={styles.title} numberOfLines={2}>
                      {c.title}
                    </Text>
                  ) : null}
                  {classDetails(c) ? (
                    <Text style={styles.details} numberOfLines={2}>
                      {classDetails(c)}
                    </Text>
                  ) : null}
                </View>
                {own ? (
                  <Pressable onPress={() => void remove(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${c.code}`} style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}>
                    <Ionicons name="close-circle" size={22} color={colors.faint} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

/** A fresh meeting time: no days yet, a morning hour. */
const NEW_MEETING: ClassMeeting = { days: [], start: "09:00", end: "09:50" };

/**
 * Class code and section, the times it meets (days of the week with a start and an end each, a few of them for a lecture
 * and a lab, say), the room, an optional class name and the semester (this one picked), then Add. Stays open after a
 * class is added, for the next one.
 */
function AddClassForm({ userId, onAdded, onClose }: { userId: string; onAdded: (c: ProfileClass) => void; onClose: () => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const terms = useMemo(() => pickableTerms(), []);
  const [code, setCode] = useState("");
  const [section, setSection] = useState("");
  const [meetings, setMeetings] = useState<ClassMeeting[]>([]);
  const [location, setLocation] = useState("");
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState(terms[0]);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const sectionInput = useRef<TextInput>(null);
  const locationInput = useRef<TextInput>(null);
  const titleInput = useRef<TextInput>(null);

  async function add() {
    if (busy) return;
    const codeProblem = classCodeProblem(code);
    const sectionProblem = classSectionProblem(section);
    const meetingProblem = meetingsProblem(meetings);
    const roomProblem = locationProblem(location);
    setCodeError(codeProblem);
    setSectionError(sectionProblem);
    setMeetingsError(meetingProblem);
    setLocationError(roomProblem);
    setError(null);
    setAdded(null);
    if (codeProblem || sectionProblem || meetingProblem || roomProblem) return;
    setBusy(true);
    try {
      const created = await addProfileClass(supabase, userId, { term, code, section, meetings, location: location.trim() || null, title: title.trim() || null });
      hapticTap();
      onAdded(created);
      setCode("");
      setSection("");
      setMeetings([]);
      setLocation("");
      setTitle("");
      setAdded(created.course_group_id ? `${created.code}-${created.section} added to ${created.term}. Your section's chat is in Messages.` : `${created.code} added to ${created.term}.`);
    } catch (e) {
      setError(errorText(e, "Could not add the class. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.formHead}>
        <Text style={styles.formTitle}>Add a class</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={styles.formClose}>
          <Ionicons name="close" size={18} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.pair}>
        <View style={{ flex: 3, gap: 6 }}>
          <Text style={styles.label}>Class code</Text>
          <TextInput
            value={code}
            onChangeText={(v) => {
              setCode(v);
              if (codeError) setCodeError(null);
            }}
            placeholder="CS 3358"
            placeholderTextColor={colors.faint}
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Class code"
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => sectionInput.current?.focus()}
            style={[styles.input, codeError ? { borderColor: colors.red } : null]}
          />
        </View>
        <View style={{ flex: 2, gap: 6 }}>
          <Text style={styles.label}>Section</Text>
          <TextInput
            ref={sectionInput}
            value={section}
            onChangeText={(v) => {
              setSection(v);
              if (sectionError) setSectionError(null);
            }}
            placeholder="001"
            placeholderTextColor={colors.faint}
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Section"
            accessibilityHint="Classmates in the same section share a group chat"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={10}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => locationInput.current?.focus()}
            style={[styles.input, sectionError ? { borderColor: colors.red } : null]}
          />
        </View>
      </View>
      {codeError || sectionError ? <Text style={styles.error}>{codeError ?? sectionError}</Text> : null}
      <MeetingsEditor
        meetings={meetings}
        onChange={(next) => {
          setMeetings(next);
          if (meetingsError) setMeetingsError(null);
        }}
        error={meetingsError}
      />
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Location (optional)</Text>
        <TextInput
          ref={locationInput}
          value={location}
          onChangeText={(v) => {
            setLocation(v);
            if (locationError) setLocationError(null);
          }}
          placeholder="Derrick Hall 240"
          placeholderTextColor={colors.faint}
          keyboardAppearance={isDark ? "dark" : "light"}
          accessibilityLabel="Location (optional)"
          autoCapitalize="words"
          maxLength={CLASS_LOCATION_MAX}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => titleInput.current?.focus()}
          style={[styles.input, locationError ? { borderColor: colors.red } : null]}
        />
        {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Class name (optional)</Text>
        <TextInput ref={titleInput} value={title} onChangeText={setTitle} placeholder="Data Structures" placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} accessibilityLabel="Class name (optional)" maxLength={80} autoCapitalize="words" returnKeyType="done" style={styles.input} />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Semester</Text>
        <View style={styles.terms} accessibilityRole="radiogroup" accessibilityLabel="Semester">
          {terms.map((t, i) => {
            const selected = t === term;
            return (
              <Pressable key={t} onPress={() => setTerm(t)} accessibilityRole="radio" accessibilityLabel={i === 0 ? `${t}, this semester` : t} accessibilityState={{ checked: selected }} style={[styles.termChip, selected && styles.termChipOn]}>
                <Text style={[styles.termText, selected && { color: colors.brand }]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : added ? <Text style={styles.added}>{added}</Text> : null}
      <Button title="Add" icon="add" onPress={() => void add()} loading={busy} />
    </View>
  );
}

/**
 * When the class meets: a card per meeting time with the days of the week to tap on and a start and an end time, each
 * opening the phone's time picker (a wheel under the row on iOS, the system dialog on Android). "Add meeting time" adds
 * another, up to MAX_CLASS_MEETINGS (a lecture and a lab, say); the cross on a card removes it. A class may have none.
 */
function MeetingsEditor({ meetings, onChange, error }: { meetings: ClassMeeting[]; onChange: (next: ClassMeeting[]) => void; error: string | null }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  /** Which time is being picked: the card and its start or end. */
  const [picking, setPicking] = useState<{ index: number; field: "start" | "end" } | null>(null);

  function update(index: number, patch: Partial<ClassMeeting>) {
    onChange(meetings.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }
  function toggleDay(index: number, day: Weekday) {
    const m = meetings[index];
    if (!m) return;
    hapticTap();
    update(index, { days: sortWeekdays(m.days.includes(day) ? m.days.filter((d) => d !== day) : [...m.days, day]) });
  }
  function removeMeeting(index: number) {
    setPicking(null);
    onChange(meetings.filter((_, i) => i !== index));
  }
  function onPicked(e: DateTimePickerEvent, date?: Date) {
    // Android closes its dialog itself and reports a dismissal as well as a choice; iOS keeps its wheel up until the field is tapped again.
    if (Platform.OS === "android") setPicking(null);
    if (e.type !== "set" || !date || !picking) return;
    update(picking.index, { [picking.field]: toClock(date) });
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>Meeting times (optional)</Text>
      {meetings.map((m, index) => (
        <View key={index} style={styles.meeting}>
          <View style={styles.meetingHead}>
            <View style={styles.days} accessibilityRole="tablist" accessibilityLabel={`Days of meeting time ${index + 1}`}>
              {WEEKDAYS.map((d) => {
                const on = m.days.includes(d.value);
                return (
                  <Pressable key={d.value} onPress={() => toggleDay(index, d.value)} accessibilityRole="checkbox" accessibilityLabel={d.label} accessibilityState={{ checked: on }} style={[styles.day, on && styles.dayOn]}>
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{d.letter}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => removeMeeting(index)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove meeting time ${index + 1}`} style={({ pressed }) => [styles.meetingRemove, pressed && { opacity: 0.6 }]}>
              <Ionicons name="close" size={16} color={colors.muted} />
            </Pressable>
          </View>
          <View style={styles.times}>
            {(["start", "end"] as const).map((field) => {
              const active = picking?.index === index && picking.field === field;
              return (
                <Pressable
                  key={field}
                  onPress={() => setPicking(active ? null : { index, field })}
                  accessibilityRole="button"
                  accessibilityLabel={`${field === "start" ? "Starts" : "Ends"} ${formatClockTime(m[field])}`}
                  accessibilityHint="Opens the time picker"
                  accessibilityState={{ expanded: active }}
                  style={[styles.time, active && styles.timeOn]}
                >
                  <Text style={styles.timeLabel}>{field === "start" ? "Starts" : "Ends"}</Text>
                  <Text style={[styles.timeValue, active && { color: colors.brand }]}>{formatClockTime(m[field])}</Text>
                  <Ionicons name={active ? "chevron-up" : "chevron-down"} size={14} color={colors.muted} />
                </Pressable>
              );
            })}
          </View>
          {picking?.index === index ? (
            <DateTimePicker
              value={fromClock(m[picking.field])}
              mode="time"
              minuteInterval={5}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={onPicked}
              themeVariant={isDark ? "dark" : "light"}
              style={styles.picker}
            />
          ) : null}
        </View>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {meetings.length < MAX_CLASS_MEETINGS ? (
        <Pressable
          onPress={() => {
            onChange([...meetings, NEW_MEETING]);
            setPicking(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={meetings.length === 0 ? "Add meeting time" : "Add another meeting time"}
          style={({ pressed }) => [styles.addMeeting, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.brand} />
          <Text style={styles.addMeetingText}>{meetings.length === 0 ? "Add meeting time" : "Add another meeting time"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "HH:MM" as a Date (today, for the picker) and back. */
function fromClock(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}
function toClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const useStyles = makeStyles((colors) => ({
  section: { padding: space.lg, gap: space.lg },
  empty: { fontSize: 14, color: colors.muted, textAlign: "center" },
  emptyBox: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  group: { gap: 2 },
  term: { fontSize: 14, fontWeight: "700", color: colors.muted, marginBottom: 4 },
  classRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8 },
  codeBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  code: { fontSize: 15, fontWeight: "700", color: colors.text },
  title: { fontSize: 13, color: colors.muted },
  details: { fontSize: 12, color: colors.faint },
  remove: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  form: { gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  formHead: { flexDirection: "row", alignItems: "center" },
  formTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  formClose: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  pair: { flexDirection: "row", gap: space.sm },
  error: { color: colors.red, fontSize: 12 },
  added: { color: colors.successText, fontSize: 13 },
  terms: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  termChip: { paddingHorizontal: 12, height: 34, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  termChipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  termText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  // One meeting time: the days, then the two times, then the wheel while one of them is being picked.
  meeting: { gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.input },
  meetingHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  days: { flex: 1, flexDirection: "row", justifyContent: "space-between" },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  dayOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  dayText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  dayTextOn: { color: colors.onBrand },
  meetingRemove: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  times: { flexDirection: "row", gap: space.sm },
  time: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, height: 42, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  timeOn: { borderColor: colors.brand },
  timeLabel: { fontSize: 12, fontWeight: "600", color: colors.muted },
  timeValue: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text, textAlign: "right" },
  picker: { alignSelf: "stretch", height: 180 },
  addMeeting: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  addMeetingText: { fontSize: 14, fontWeight: "600", color: colors.brand },
}));
