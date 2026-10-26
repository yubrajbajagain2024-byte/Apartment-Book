import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Platform, Pressable, Text, TextInput, View, type TextInputInstance, type ViewInstance } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import {
  addProfileClass,
  classCodeProblem,
  classDetails,
  classSectionProblem,
  classSubjectProblem,
  CLASS_LOCATION_MAX,
  courseNumberProblem,
  expandMeetings,
  formatClockTime,
  groupClassesByTerm,
  joinClassCode,
  locationProblem,
  MAX_CLASS_MEETINGS,
  meetingsProblem,
  mergeMeetingSlots,
  parseClassMeetings,
  pickableTerms,
  removeProfileClass,
  shiftClockTime,
  splitClassCode,
  updateProfileClass,
  weekdayLabel,
  WEEKDAYS,
  type ClassMeeting,
  type MeetingSlot,
  type ProfileClass,
  type Weekday,
} from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { Button } from "@/components/ui";
import { hapticTap, alertWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

type UpdateClasses = (fn: (classes: ProfileClass[]) => ProfileClass[]) => void;
/** What the form is open for: a new class, or one of yours being changed. */
type FormMode = { kind: "add" } | { kind: "edit"; initial: ProfileClass };

/**
 * The Classes tab, the one place a profile shows its classes: grouped by semester, this one first ("Fall 2026 · This
 * semester"). The owner adds a class with its subject and course number ("CS" and "3358", kept as the one code "CS 3358"
 * the database checks), its section, the days and times it meets, the room and an optional name, and the semester. A
 * hold on one of their class cards offers Edit (the same form, filled in) and Delete, which asks first; there is no
 * other way to change or remove one. Once a class is in or changed, the form closes and a line under "Add class" says so
 * (and where the section's chat is); the button brings the form back. The section puts them in that section's course
 * chat (the database creates it for the first classmate and adds the rest; changing the section moves them over, and
 * deleting the class leaves it), which is why it is asked for.
 */
export function ClassesSection({ own, userId, classes, onChange, onOpenForm }: { own: boolean; userId: string; classes: ProfileClass[]; onChange: UpdateClasses; onOpenForm?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const showSheet = useActionSheet();
  const groups = useMemo(() => groupClassesByTerm(classes), [classes]);
  const [form, setForm] = useState<FormMode | null>(null);
  /** The word that a class went in or changed, under the Add class button for a while once the form has closed. */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  // Close, Save and Delete take away the button, form or card that had focus: once the list has redrawn, the screen
  // reader moves to "Add class" (not there while the form is open).
  const addButton = useRef<ViewInstance>(null);
  const [focusAdd, setFocusAdd] = useState(0);
  useEffect(() => {
    const node = addButton.current;
    if (focusAdd > 0 && node && typeof AccessibilityInfo.sendAccessibilityEvent === "function") AccessibilityInfo.sendAccessibilityEvent(node, "focus");
  }, [focusAdd]);

  function openForm(mode: FormMode) {
    setNotice(null);
    setForm(mode);
    onOpenForm?.();
  }
  function closeForm() {
    setForm(null);
    setFocusAdd((n) => n + 1);
  }

  async function remove(c: ProfileClass) {
    hapticTap();
    setNotice(null);
    onChange((list) => list.filter((x) => x.id !== c.id));
    setFocusAdd((n) => n + 1);
    try {
      await removeProfileClass(supabase, c.id);
    } catch (e) {
      onChange((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
      alertWithHaptic("error", `Could not delete ${c.code}`, errorText(e));
    }
  }

  /** A hold on one of your class cards: Edit, or Delete after a word of warning (it leaves the section's chat as well). */
  function cardMenu(c: ProfileClass) {
    hapticTap();
    showSheet(
      [
        { label: "Edit class", icon: "create-outline", onPress: () => openForm({ kind: "edit", initial: c }) },
        {
          label: "Delete class",
          icon: "trash-outline",
          destructive: true,
          onPress: () =>
            alertWithHaptic("warning", `Delete ${c.code}?`, c.course_group_id ? `It comes off your ${c.term} classes, and you leave its section's chat.` : `It comes off your ${c.term} classes.`, [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => void remove(c) },
            ]),
        },
      ],
      c.title ? `${c.code} · ${c.title}` : c.code,
    );
  }

  return (
    <View style={styles.section}>
      {own && form ? (
        <AddClassForm
          key={form.kind === "edit" ? form.initial.id : "add"}
          userId={userId}
          initial={form.kind === "edit" ? form.initial : null}
          classes={classes}
          onSaved={(c, note) => {
            onChange((list) => (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]));
            setForm(null);
            setNotice(note);
            AccessibilityInfo.announceForAccessibility(note);
            setFocusAdd((n) => n + 1);
          }}
          onClose={closeForm}
        />
      ) : null}
      {own && !form ? <Button ref={addButton} title="Add class" variant="secondary" icon="add" onPress={() => openForm({ kind: "add" })} /> : null}
      {own && !form && notice ? <Text style={styles.added}>{notice}</Text> : null}
      {groups.length === 0 ? (
        own ? (
          form ? null : <Text style={styles.empty}>Add the classes you're taking so classmates can find you.</Text>
        ) : (
          <View style={styles.emptyBox}>
            <Icon name="school-outline" size={28} color={colors.faint} />
            <Text style={styles.emptyTitle}>No classes listed</Text>
          </View>
        )
      ) : (
        groups.map((g) => (
          <View key={g.term} style={styles.group}>
            <Text style={styles.term} accessibilityRole="header">
              {g.current ? `${g.term} · This semester` : g.term}
            </Text>
            {g.classes.map((c) => {
              const details = classDetails(c);
              return (
                <Pressable
                  key={c.id}
                  disabled={!own}
                  onLongPress={own ? () => cardMenu(c) : undefined}
                  delayLongPress={350}
                  accessibilityRole={own ? "button" : undefined}
                  accessibilityLabel={own ? [c.code, c.title, details].filter(Boolean).join(", ") : undefined}
                  accessibilityHint={own ? "Hold for Edit and Delete" : undefined}
                  accessibilityActions={own ? [{ name: "longpress", label: "Edit or delete" }] : undefined}
                  onAccessibilityAction={own ? (e) => e.nativeEvent.actionName === "longpress" && cardMenu(c) : undefined}
                  style={({ pressed }) => [styles.classRow, own && pressed && styles.classRowPressed]}
                >
                  <View style={styles.codeBadge}>
                    <Icon name="book-outline" size={16} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={styles.code}>{c.code}</Text>
                    {c.title ? (
                      <Text style={styles.title} numberOfLines={2}>
                        {c.title}
                      </Text>
                    ) : null}
                    {details ? (
                      <Text style={styles.details} numberOfLines={2}>
                        {details}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))
      )}
    </View>
  );
}

/**
 * Subject and course number (kept as the one class code the database stores, "CS 3358") and section, the days and times
 * it meets, the room, an optional class name and the semester (this one picked), then Add; or, for a class being changed
 * (`initial`), the same boxes filled in and Save. Once the class is in or changed, the form hands the word of it to the
 * section (`onSaved`), which closes the form; the Add class button brings it back. `classes` are the rest of the list, so
 * a code already on that semester is caught before the database says the same.
 */
function AddClassForm({ userId, initial, classes, onSaved, onClose }: { userId: string; initial: ProfileClass | null; classes: ProfileClass[]; onSaved: (c: ProfileClass, note: string) => void; onClose: () => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  // A class from a semester no longer offered keeps its own chip while it is being changed.
  const terms = useMemo(() => {
    const offered = pickableTerms();
    return initial && !offered.includes(initial.term) ? [...offered, initial.term] : offered;
  }, [initial]);
  const [subject, setSubject] = useState(() => (initial ? splitClassCode(initial.code).subject : ""));
  const [number, setNumber] = useState(() => (initial ? splitClassCode(initial.code).number : ""));
  const [section, setSection] = useState(initial?.section ?? "");
  const [meetings, setMeetings] = useState<ClassMeeting[]>(() => (initial ? parseClassMeetings(initial.meetings) : []));
  const [location, setLocation] = useState(initial?.location ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [term, setTerm] = useState(initial?.term ?? terms[0]);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const numberInput = useRef<TextInputInstance>(null);
  const sectionInput = useRef<TextInputInstance>(null);
  const locationInput = useRef<TextInputInstance>(null);
  const titleInput = useRef<TextInputInstance>(null);

  async function save() {
    if (busy) return;
    const code = joinClassCode(subject, number);
    const subjectProblem = classSubjectProblem(subject);
    const numberProblem = courseNumberProblem(number);
    // Both halves fine on their own, the whole still has to pass as the database checks it (its length, say).
    const codeProblem = subjectProblem || numberProblem ? null : classCodeProblem(code);
    const sectionProblem = classSectionProblem(section);
    const meetingProblem = meetingsProblem(meetings);
    const roomProblem = locationProblem(location);
    setSubjectError(subjectProblem ?? codeProblem);
    setNumberError(numberProblem ?? codeProblem);
    setSectionError(sectionProblem);
    setMeetingsError(meetingProblem);
    setLocationError(roomProblem);
    setError(null);
    if (subjectProblem || numberProblem || codeProblem || sectionProblem || meetingProblem || roomProblem) return;
    if (classes.some((x) => x.id !== initial?.id && x.term === term && x.code === code)) {
      setError(`${code} is already on your ${term} classes.`);
      return;
    }
    setBusy(true);
    try {
      const fields = { term, code, section, meetings, location: location.trim() || null, title: title.trim() || null };
      const saved = initial ? await updateProfileClass(supabase, initial.id, fields) : await addProfileClass(supabase, userId, fields);
      hapticTap();
      const movedChat = saved.course_group_id && saved.course_group_id !== initial?.course_group_id;
      onSaved(
        saved,
        initial
          ? movedChat
            ? `${saved.code}-${saved.section} updated. Your new section's chat is in Messages.`
            : `${saved.code} updated.`
          : movedChat
            ? `${saved.code}-${saved.section} added to ${saved.term}. Your section's chat is in Messages.`
            : `${saved.code} added to ${saved.term}.`,
      );
    } catch (e) {
      setError(errorText(e, initial ? "Could not save the class. Try again." : "Could not add the class. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.formHead}>
        <Text style={styles.formTitle}>{initial ? "Edit class" : "Add a class"}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={styles.formClose}>
          <Icon name="close" size={18} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.pair}>
        <View style={{ flex: 2, gap: 6 }}>
          <Text style={styles.label}>Subject</Text>
          <TextInput
            value={subject}
            onChangeText={(v) => {
              setSubject(v);
              if (subjectError) setSubjectError(null);
            }}
            placeholder="CS"
            placeholderTextColor={colors.faint}
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Subject"
            accessibilityHint="The letters of the class code, like CS or MATH"
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => numberInput.current?.focus()}
            style={[styles.input, subjectError ? { borderColor: colors.red } : null]}
          />
        </View>
        <View style={{ flex: 3, gap: 6 }}>
          <Text style={styles.label}>Course number</Text>
          <TextInput
            ref={numberInput}
            value={number}
            onChangeText={(v) => {
              setNumber(v);
              if (numberError) setNumberError(null);
            }}
            placeholder="3358"
            placeholderTextColor={colors.faint}
            keyboardAppearance={isDark ? "dark" : "light"}
            keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
            accessibilityLabel="Course number"
            accessibilityHint="The number of the class code, like 3358"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => sectionInput.current?.focus()}
            style={[styles.input, numberError ? { borderColor: colors.red } : null]}
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
      {subjectError || numberError || sectionError ? <Text style={styles.error}>{subjectError ?? numberError ?? sectionError}</Text> : null}
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={initial ? "Save" : "Add"} icon={initial ? "checkmark" : "add"} onPress={() => void save()} loading={busy} />
    </View>
  );
}

/**
 * When the class meets, one day at a time: tap the days of the week, and each day picked gets a row with its start and
 * end (a new day starts with the time of the day before it, so MWF 10:00–10:50 takes one change). Each time opens the
 * phone's time picker (a wheel under the row on iOS, the system dialog on Android). The "+" on a day's row adds a second
 * time that day (a lecture and a lab, say) and the cross removes it. Days that share a time are stored as one meeting.
 * A class may meet on no days at all.
 */
function MeetingsEditor({ meetings, onChange, error }: { meetings: ClassMeeting[]; onChange: (next: ClassMeeting[]) => void; error: string | null }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const slots = useMemo(() => expandMeetings(meetings), [meetings]);
  const chosenDays = useMemo(() => new Set(slots.map((s) => s.day)), [slots]);
  /** Which time is being picked: the row and its start or end. */
  const [picking, setPicking] = useState<{ index: number; field: "start" | "end" } | null>(null);
  const commit = (next: MeetingSlot[]) => onChange(mergeMeetingSlots(next));
  const order = (day: Weekday) => WEEKDAYS.findIndex((d) => d.value === day);

  function toggleDay(day: Weekday) {
    hapticTap();
    setPicking(null);
    if (chosenDays.has(day)) return commit(slots.filter((s) => s.day !== day));
    // The new day takes the time of the nearest day before it (or the first day there is), so MWF takes one change.
    const before = [...slots].reverse().find((s) => order(s.day) < order(day)) ?? slots[0];
    commit([...slots, { day, start: before?.start ?? "09:00", end: before?.end ?? "09:50" }]);
  }
  function updateSlot(index: number, patch: Partial<MeetingSlot>) {
    commit(slots.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function addTime(day: Weekday) {
    setPicking(null);
    const last = [...slots].reverse().find((s) => s.day === day);
    const start = last ? last.end : "13:00";
    commit([...slots, { day, start, end: shiftClockTime(start, 50) }]);
  }
  function removeSlot(index: number) {
    setPicking(null);
    commit(slots.filter((_, i) => i !== index));
  }
  function onPicked(e: DateTimePickerEvent, date?: Date) {
    // Android closes its dialog itself and reports a dismissal as well as a choice; iOS keeps its wheel up until the field is tapped again.
    if (Platform.OS === "android") setPicking(null);
    if (e.type !== "set" || !date || !picking) return;
    updateSlot(picking.index, { [picking.field]: toClock(date) });
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>Meeting days and times (optional)</Text>
      <View style={styles.days} accessibilityRole="tablist" accessibilityLabel="Days the class meets">
        {WEEKDAYS.map((d) => {
          const on = chosenDays.has(d.value);
          return (
            <Pressable key={d.value} onPress={() => toggleDay(d.value)} accessibilityRole="checkbox" accessibilityLabel={d.label} accessibilityState={{ checked: on }} style={[styles.day, on && styles.dayOn]}>
              <Text style={[styles.dayText, on && styles.dayTextOn]}>{d.letter}</Text>
            </Pressable>
          );
        })}
      </View>
      {slots.length === 0 ? <Text style={styles.hint}>Pick the days the class meets to set its times.</Text> : null}
      {slots.map((s, index) => {
        const first = index === 0 || slots[index - 1]?.day !== s.day;
        const label = weekdayLabel(s.day);
        const short = WEEKDAYS.find((d) => d.value === s.day)?.short ?? label;
        return (
          <View key={`${s.day}-${index}`} style={[styles.slot, !first && styles.slotExtra]}>
            <View style={styles.slotRow}>
              <Text style={styles.slotDay} accessibilityLabel={first ? label : `${label}, another time`}>
                {first ? short : ""}
              </Text>
              {(["start", "end"] as const).map((field, fi) => {
                const active = picking?.index === index && picking.field === field;
                return (
                  <View key={field} style={styles.slotTimeWrap}>
                    {fi === 1 ? <Text style={styles.slotDash}>–</Text> : null}
                    <Pressable
                      onPress={() => setPicking(active ? null : { index, field })}
                      accessibilityRole="button"
                      accessibilityLabel={`${label} ${field === "start" ? "starts" : "ends"} ${formatClockTime(s[field])}`}
                      accessibilityHint="Opens the time picker"
                      accessibilityState={{ expanded: active }}
                      style={[styles.time, active && styles.timeOn]}
                    >
                      <Text style={[styles.timeValue, active && { color: colors.brand }]}>{formatClockTime(s[field])}</Text>
                    </Pressable>
                  </View>
                );
              })}
              {first ? (
                slots.length < MAX_CLASS_MEETINGS ? (
                  <Pressable onPress={() => addTime(s.day)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Add another time on ${label}`} style={({ pressed }) => [styles.slotAction, pressed && { opacity: 0.6 }]}>
                    <Icon name="add-circle-outline" size={20} color={colors.brand} />
                  </Pressable>
                ) : (
                  <View style={styles.slotAction} />
                )
              ) : (
                <Pressable onPress={() => removeSlot(index)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove this time on ${label}`} style={({ pressed }) => [styles.slotAction, pressed && { opacity: 0.6 }]}>
                  <Icon name="close-circle-outline" size={20} color={colors.muted} />
                </Pressable>
              )}
            </View>
            {picking?.index === index ? (
              <DateTimePicker value={fromClock(s[picking.field])} mode="time" minuteInterval={5} display={Platform.OS === "ios" ? "spinner" : "default"} onChange={onPicked} themeVariant={isDark ? "dark" : "light"} style={styles.picker} />
            ) : null}
          </View>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  classRowPressed: { opacity: 0.7 },
  codeBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  code: { fontSize: 15, fontWeight: "700", color: colors.text },
  title: { fontSize: 13, color: colors.muted },
  details: { fontSize: 12, color: colors.faint },
  form: { gap: space.md, padding: space.md, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  formHead: { flexDirection: "row", alignItems: "center" },
  formTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  formClose: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderCurve: "continuous", paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  pair: { flexDirection: "row", gap: space.sm },
  error: { color: colors.red, fontSize: 12 },
  added: { color: colors.successText, fontSize: 13 },
  terms: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  termChip: { paddingHorizontal: 12, height: 34, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  termChipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  termText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  // The days of the week to tap, then one row per day picked: its name, start – end, and + (another time) or × (drop it).
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  dayOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  dayText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  dayTextOn: { color: colors.onBrand },
  hint: { fontSize: 13, color: colors.faint },
  slot: { gap: 6, padding: 8, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.input },
  // A second time on the same day sits tight under the first, without a day name of its own.
  slotExtra: { marginTop: -2 },
  slotRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  slotDay: { width: 40, fontSize: 13, fontWeight: "700", color: colors.text },
  slotTimeWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  slotDash: { fontSize: 14, color: colors.muted },
  time: { flex: 1, height: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  timeOn: { borderColor: colors.brand },
  timeValue: { fontSize: 14, fontWeight: "700", color: colors.text },
  slotAction: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  picker: { alignSelf: "stretch", height: 180 },
}));
