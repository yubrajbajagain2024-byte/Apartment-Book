"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Plus, X } from "lucide-react";
import { classCodeProblem, classDetails, classSectionProblem, classSubjectProblem, CLASS_LOCATION_MAX, courseNumberProblem, expandMeetings, joinClassCode, locationProblem, MAX_CLASS_MEETINGS, meetingsProblem, mergeMeetingSlots, shiftClockTime, weekdayLabel, WEEKDAYS, type ClassMeeting, type MeetingSlot, type ProfileClass, type Weekday } from "@apartment-book/shared";
import { addClassAction, removeClassAction } from "@/lib/actions/profile-page";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export type ClassGroup = { term: string; current: boolean; classes: ProfileClass[] };

const CLASS_TITLE_MAX = 80;

/**
 * The Classes tab: classes grouped by semester, this one first. The owner adds them (subject and course number, kept as
 * the one code "CS 3358" the database stores, section, the days and times it meets, the room, an optional name,
 * semester) and removes them here; the page re-renders with the list from the database after each change. Once a class
 * is in, the form closes and a line beside "Add class" says so; the button brings it back. The section puts them in that
 * section's course chat (the database creates it for the first classmate and adds the rest; removing the class leaves it).
 */
export function ProfileClasses({ isOwner, groups, terms }: { isOwner: boolean; groups: ClassGroup[]; /** This semester first, then the next and the last one. */ terms: string[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState("");
  const [number, setNumber] = useState("");
  const [section, setSection] = useState("");
  const [meetings, setMeetings] = useState<ClassMeeting[]>([]);
  const [location, setLocation] = useState("");
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState(terms[0] ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  /** The word that a class went in, shown once the form has closed. */
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [, startRemoving] = useTransition();
  /** Classes removed here, hidden straight away rather than when the refreshed list arrives. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const subjectRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const visible = groups.map((g) => ({ ...g, classes: g.classes.filter((c) => !hidden.has(c.id)) })).filter((g) => g.classes.length > 0);
  const empty = visible.length === 0;

  function openForm() {
    setAdding(true);
    setFormError(null);
    setNotice(null);
    // The input exists after this render.
    requestAnimationFrame(() => subjectRef.current?.focus());
  }

  function closeForm() {
    setAdding(false);
    setFormError(null);
    setSubject("");
    setNumber("");
    setSection("");
    setMeetings([]);
    setLocation("");
    setTitle("");
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const subjectProblem = classSubjectProblem(subject);
    if (subjectProblem) {
      setFormError(subjectProblem);
      subjectRef.current?.focus();
      return;
    }
    const numberProblem = courseNumberProblem(number);
    if (numberProblem) {
      setFormError(numberProblem);
      numberRef.current?.focus();
      return;
    }
    // Both halves fine on their own, the whole still has to pass as the database checks it (its length, say).
    const code = joinClassCode(subject, number);
    const codeProblem = classCodeProblem(code);
    if (codeProblem) {
      setFormError(codeProblem);
      subjectRef.current?.focus();
      return;
    }
    const sectionProblem = classSectionProblem(section);
    if (sectionProblem) {
      setFormError(sectionProblem);
      sectionRef.current?.focus();
      return;
    }
    const otherProblem = meetingsProblem(meetings) ?? locationProblem(location);
    if (otherProblem) {
      setFormError(otherProblem);
      return;
    }
    setFormError(null);
    startSaving(async () => {
      const result = await addClassAction({ term, code, title, section, meetings, location });
      if (result.error) {
        setFormError(result.error);
        return;
      }
      // In: the form closes, the word of it shows beside Add class, and the list comes back from the database.
      closeForm();
      setNotice(`${code} added to ${term}.`);
      router.refresh();
    });
  }

  function remove(item: ProfileClass) {
    setListError(null);
    setNotice(null);
    setHidden((h) => new Set(h).add(item.id));
    // The button pressed is about to disappear: keep the focus in the tab.
    (addButtonRef.current ?? subjectRef.current)?.focus();
    startRemoving(async () => {
      const result = await removeClassAction(item.id);
      if (result.error) {
        setHidden((h) => {
          const next = new Set(h);
          next.delete(item.id);
          return next;
        });
        setListError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4" data-testid="profile-classes">
      {isOwner ? (
        adding ? (
          <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl bg-gray-50 p-3.5 ring-1 ring-gray-100" aria-label="Add a class" data-testid="profile-class-form">
            <div className="grid gap-3 sm:grid-cols-[6rem_7rem_6rem_1fr_1fr]">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
                Subject
                <input
                  ref={subjectRef}
                  name="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="CS"
                  maxLength={8}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  title="The letters of the class code, like CS or MATH"
                  aria-invalid={formError ? true : undefined}
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm uppercase text-gray-900 placeholder:normal-case placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
                Course number
                <input
                  ref={numberRef}
                  name="number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="3358"
                  maxLength={8}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  title="The number of the class code, like 3358"
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm uppercase text-gray-900 placeholder:normal-case placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
                Section
                <input
                  ref={sectionRef}
                  name="section"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  placeholder="001"
                  maxLength={10}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  title="Classmates in the same section share a group chat"
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm uppercase text-gray-900 placeholder:normal-case placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
                Location (optional)
                <input
                  name="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Derrick Hall 240"
                  maxLength={CLASS_LOCATION_MAX}
                  autoComplete="off"
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
                Class name (optional)
                <input
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Data Structures"
                  maxLength={CLASS_TITLE_MAX}
                  autoComplete="off"
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </label>
            </div>
            <MeetingsEditor meetings={meetings} onChange={setMeetings} />
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-gray-800">Semester</legend>
              <div className="flex flex-wrap gap-2">
                {terms.map((t, i) => (
                  <label
                    key={t}
                    className={cn(
                      "inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[13px] font-semibold ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                      term === t ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-800 ring-gray-300 hover:bg-gray-100",
                    )}
                  >
                    <input type="radio" name="term" value={t} checked={term === t} onChange={() => setTerm(t)} className="sr-only" />
                    {t}
                    {i === 0 ? <span className={cn("ml-1 font-normal", term === t ? "text-white/80" : "text-gray-500")}>· This semester</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
            {formError ? (
              <p role="alert" className="text-sm text-red-600">
                {formError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-gray-700 hover:bg-gray-200">
                Done
              </button>
              <button type="submit" aria-disabled={saving || undefined} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 aria-disabled:opacity-60">
                {saving ? <Spinner className="h-4 w-4" /> : null}
                Add
              </button>
            </div>
          </form>
        ) : (
          <div className={cn("flex items-center gap-3", empty && "flex-col py-6 text-center")}>
            {notice ? (
              <p role="status" className="text-sm text-green-700" data-testid="profile-class-added">
                {notice}
              </p>
            ) : null}
            {empty ? (
              <>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                  <GraduationCap className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Add your classes</p>
                  <p className="mt-0.5 text-sm text-gray-500">Show classmates which classes you are taking this semester.</p>
                </div>
              </>
            ) : null}
            <button
              ref={addButtonRef}
              type="button"
              onClick={openForm}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-100 px-3.5 text-sm font-semibold text-gray-900 hover:bg-gray-200", !empty && "ml-auto")}
              data-testid="profile-add-class"
            >
              <Plus className="h-4 w-4" /> Add class
            </button>
          </div>
        )
      ) : null}

      {listError ? (
        <p role="alert" className="text-sm text-red-600">
          {listError}
        </p>
      ) : null}

      {empty ? (
        isOwner ? null : (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700">
              <GraduationCap className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-gray-900">No classes listed</p>
          </div>
        )
      ) : (
        visible.map((group) => (
          <section key={group.term} aria-label={group.term} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              {group.term}
              {group.current ? <span className="font-normal text-gray-500"> · This semester</span> : null}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {group.classes.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5 ring-1 ring-gray-100" data-testid="profile-class">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 ring-1 ring-gray-200">
                    <GraduationCap className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-gray-900">{item.code}</span>
                    {item.title ? <span className="block truncate text-xs text-gray-500">{item.title}</span> : null}
                    {classDetails(item) ? <span className="block truncate text-xs text-gray-500">{classDetails(item)}</span> : null}
                  </span>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      aria-label={`Remove ${item.code}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/**
 * When the class meets, one day at a time: toggle the days of the week, and each day picked gets a row with its start and
 * end (a new day starts with the time of the day before it, so MWF 10:00–10:50 takes one change). The "+" on a day's row
 * adds a second time that day (a lecture and a lab, say) and the cross removes it. Days that share a time are stored as
 * one meeting. A class may meet on no days at all.
 */
function MeetingsEditor({ meetings, onChange }: { meetings: ClassMeeting[]; onChange: (next: ClassMeeting[]) => void }) {
  const slots = expandMeetings(meetings);
  const chosen = new Set(slots.map((s) => s.day));
  const commit = (next: MeetingSlot[]) => onChange(mergeMeetingSlots(next));
  const order = (day: Weekday) => WEEKDAYS.findIndex((d) => d.value === day);
  const shortDay = (day: Weekday) => WEEKDAYS.find((d) => d.value === day)?.short ?? day;

  function toggleDay(day: Weekday) {
    if (chosen.has(day)) return commit(slots.filter((s) => s.day !== day));
    const before = [...slots].reverse().find((s) => order(s.day) < order(day)) ?? slots[0];
    commit([...slots, { day, start: before?.start ?? "09:00", end: before?.end ?? "09:50" }]);
  }
  function update(index: number, patch: Partial<MeetingSlot>) {
    commit(slots.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function addTime(day: Weekday) {
    const last = [...slots].reverse().find((s) => s.day === day);
    const start = last ? last.end : "13:00";
    commit([...slots, { day, start, end: shiftClockTime(start, 50) }]);
  }

  const timeClass = "h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-gray-800">Meeting days and times (optional)</legend>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days the class meets">
        {WEEKDAYS.map((d) => {
          const on = chosen.has(d.value);
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => toggleDay(d.value)}
              aria-pressed={on}
              aria-label={d.label}
              className={cn("h-9 min-w-9 rounded-full px-2.5 text-xs font-bold ring-1 transition-colors", on ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-gray-600 ring-gray-300 hover:bg-gray-100")}
            >
              {d.letter}
            </button>
          );
        })}
      </div>
      {slots.length === 0 ? (
        <p className="text-xs text-gray-500">Pick the days the class meets to set its times.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {slots.map((s, index) => {
            const first = index === 0 || slots[index - 1]?.day !== s.day;
            const label = weekdayLabel(s.day);
            return (
              <li key={`${s.day}-${index}`} className="grid grid-cols-[3rem_1fr_auto_1fr_2rem] items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-gray-200" data-testid="profile-class-meeting">
                <span className="text-sm font-semibold text-gray-800">{first ? shortDay(s.day) : ""}</span>
                <input type="time" aria-label={`${label} starts`} value={s.start} onChange={(e) => update(index, { start: e.target.value })} step={300} required className={timeClass} />
                <span className="text-gray-400">–</span>
                <input type="time" aria-label={`${label} ends`} value={s.end} onChange={(e) => update(index, { end: e.target.value })} step={300} required className={timeClass} />
                {first ? (
                  slots.length < MAX_CLASS_MEETINGS ? (
                    <button type="button" onClick={() => addTime(s.day)} aria-label={`Add another time on ${label}`} className="flex h-8 w-8 items-center justify-center rounded-full text-brand-600 hover:bg-brand-50">
                      <Plus className="h-4 w-4" />
                    </button>
                  ) : (
                    <span />
                  )
                ) : (
                  <button type="button" onClick={() => commit(slots.filter((_, i) => i !== index))} aria-label={`Remove this time on ${label}`} className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
