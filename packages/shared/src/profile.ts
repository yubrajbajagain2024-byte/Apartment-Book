import type { FeedMedia, FeedPostWithAuthor, FollowListView, ProfileClass, ProfileSection, ProfileTile, ProfileVisibility } from "./types/models";

// -----------------------------------------------------------------------------
// Who can see Classes, Saved, Liked and Listings
// -----------------------------------------------------------------------------
export const PROFILE_VISIBILITIES: ProfileVisibility[] = ["public", "friends", "private"];
export const PROFILE_VISIBILITY_OPTIONS: { value: ProfileVisibility; label: string; description: string }[] = [
  { value: "public", label: "Everyone", description: "Anyone on UniBuzz" },
  { value: "friends", label: "Friends", description: "People you follow who follow you back" },
  { value: "private", label: "Only me", description: "Nobody else can see it" },
];
export const PROFILE_SECTIONS: ProfileSection[] = ["classes", "saved", "liked", "listings"];
/** What each tab holds, in the words of the settings and the lock messages. */
export const PROFILE_SECTION_NOUNS: Record<ProfileSection, string> = { classes: "classes", saved: "saved posts", liked: "liked posts", listings: "listings" };
/** The profile column behind each setting. */
export const PROFILE_VISIBILITY_COLUMNS = { classes: "classes_visibility", saved: "saved_visibility", liked: "liked_visibility", listings: "listings_visibility" } as const;
/**
 * What a new profile gets, and what a row without the setting reads as (a database before the migration that added it):
 * Classes for friends; Saved, Liked and Listings for nobody but the owner (migration 37).
 */
export const PROFILE_DEFAULT_VISIBILITY: Record<ProfileSection, ProfileVisibility> = { classes: "friends", saved: "private", liked: "private", listings: "private" };
/** What nobody but the owner may open: the answer while access is unknown, or from a database without a setting. */
export const NO_SECTION_ACCESS: Record<ProfileSection, boolean> = { classes: false, saved: false, liked: false, listings: false };
/** The owner opens every tab of their own profile. */
export const OWNER_SECTION_ACCESS: Record<ProfileSection, boolean> = { classes: true, saved: true, liked: true, listings: true };

export function isProfileVisibility(value: unknown): value is ProfileVisibility {
  return value === "public" || value === "friends" || value === "private";
}

/** Who can see one of the tabs, read from a profile row: its column, or the default when the row has none. */
export function sectionVisibilityOf(profile: Partial<Record<(typeof PROFILE_VISIBILITY_COLUMNS)[ProfileSection], unknown>> | null | undefined, section: ProfileSection): ProfileVisibility {
  const value = profile?.[PROFILE_VISIBILITY_COLUMNS[section]];
  return isProfileVisibility(value) ? value : PROFILE_DEFAULT_VISIBILITY[section];
}

export function visibilityLabel(value: ProfileVisibility): string {
  return PROFILE_VISIBILITY_OPTIONS.find((o) => o.value === value)?.label ?? "Only me";
}

/** The owner's own line above a tab: "Only you can see your saved posts". */
export function ownSectionNote(section: ProfileSection, value: ProfileVisibility): string {
  const noun = PROFILE_SECTION_NOUNS[section];
  if (value === "public") return `Everyone can see your ${noun}`;
  if (value === "friends") return `Your friends can see your ${noun}`;
  return `Only you can see your ${noun}`;
}

/** What a visitor reads on a tab they may not open: "Only Sunil can see their saved posts". */
export function lockedSectionMessage(section: ProfileSection, value: ProfileVisibility, firstName: string): string {
  const noun = PROFILE_SECTION_NOUNS[section];
  const name = firstName.trim() || "This person";
  if (value === "friends") return `Only ${name}'s friends can see their ${noun}`;
  return `Only ${name} can see their ${noun}`;
}

// -----------------------------------------------------------------------------
// The line under the name: "CS ’28 @ Texas State University"
// -----------------------------------------------------------------------------
/** Small words a major's short form leaves out: "Electrical and Computer Engineering" is ECE. */
const MAJOR_SMALL_WORDS = new Set(["a", "an", "and", "&", "for", "in", "of", "the", "with"]);
/** Majors whose usual short form is not just their initials (the name in lower case, as typed or with "Studies"). */
const MAJOR_SHORT_FORMS: Record<string, string> = {
  accounting: "Acct",
  anthropology: "Anthro",
  architecture: "Arch",
  astronomy: "Astro",
  biochemistry: "Biochem",
  biology: "Bio",
  chemistry: "Chem",
  communication: "Comm",
  communications: "Comm",
  economics: "Econ",
  education: "Edu",
  engineering: "Eng",
  finance: "Fin",
  geography: "Geog",
  geology: "Geo",
  journalism: "Journ",
  kinesiology: "Kin",
  linguistics: "Ling",
  management: "Mgmt",
  marketing: "Mktg",
  mathematics: "Math",
  neuroscience: "Neuro",
  philosophy: "Phil",
  "political science": "PoliSci",
  psychology: "Psych",
  sociology: "Soc",
  statistics: "Stats",
};
/**
 * A degree written before the major: "BS", "B.S. in", "MBA in", "Ph.D. in", "Bachelor of Science in", "Major in". A
 * spelled-out degree goes only before "in", so "Master of Business Administration" stays a major (MBA).
 */
const DEGREE_PREFIX = /^(?:(?:b|m)\.?\s?(?:s|a|f\.?a|b\.?a)\.?(?:\s+in)?|ph\.?\s?d\.?(?:\s+in)?|(?:bachelor|master)'?s?(?:\s+of\s+[a-z ]+?)?\s+in|(?:major|degree)\s+in)\s+/i;

/**
 * A major as it reads on a profile: "Computer Science" is CS, "Electrical and Computer Engineering" ECE, "Psychology"
 * Psych. What the person typed short already ("CS", "CompE", "Math") stays exactly as typed, and a one-word major with
 * no common short form stays whole ("Nursing"). Null when there is none.
 */
export function majorAbbreviation(program: string | null | undefined): string | null {
  const name = (program ?? "").replace(/\s+/g, " ").trim().replace(DEGREE_PREFIX, "").replace(/\s+major$/i, "").trim();
  if (!name) return null;
  const known = MAJOR_SHORT_FORMS[name.toLowerCase()];
  if (known) return known;
  const words = name.split(" ").filter((w) => !MAJOR_SMALL_WORDS.has(w.toLowerCase()));
  // One word: kept as typed ("CS", "CompE", "Nursing", "Pre-Med").
  if (words.length <= 1) return words[0] ?? name;
  // Several: their initials, as majors are usually shortened ("Computer Science" → "CS").
  return words.map((w) => w.charAt(0).toUpperCase()).join("");
}

/** "’28" from 2028: the class year as students write it. Null without a sensible year. */
export function classYear(year: number | null | undefined): string | null {
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1900 || year > 2999) return null;
  return `\u2019${String(year).slice(-2)}`;
}

/**
 * The line under a profile's name: major, class year and university, "CS ’28 @ Texas State University". Whatever is
 * missing drops out ("CS @ Texas State University", "Class of ’28 @ Texas State University", "CS ’28"); null with none.
 */
export function profileStudyLine(profile: { program?: string | null; graduation_year?: number | null; university?: { name: string } | null }): string | null {
  const major = majorAbbreviation(profile.program);
  const year = classYear(profile.graduation_year);
  const study = major ? [major, year].filter(Boolean).join(" ") : year ? `Class of ${year}` : "";
  const school = profile.university?.name?.trim() || "";
  if (study && school) return `${study} @ ${school}`;
  return study || school || null;
}

// -----------------------------------------------------------------------------
// Followers and Following
// -----------------------------------------------------------------------------
/**
 * What the Followers and Following counts open. Only the owner sees who follows them and whom they follow; anyone
 * else signed in gets one list, the friends they have in common with the owner, behind both counts; signed out there
 * is no list. The database holds the same line, so this only picks the screen.
 */
export function followListView(viewerId: string | null | undefined, ownerId: string): FollowListView {
  if (!viewerId) return "signed-out";
  return viewerId === ownerId ? "own" : "mutual";
}

export const MUTUAL_FRIENDS_TITLE = "Mutual friends";
export const MUTUAL_FRIENDS_LOGIN_PROMPT = "Log in to see mutual friends";

/** The line over the mutual friends: "Only Sunil can see their followers and following". */
export function privateFollowListsNote(firstName: string): string {
  const name = firstName.trim();
  return name ? `Only ${name} can see their followers and following` : "Followers and following are private";
}

/** The empty mutual friends list: "You and Sunil have no friends in common yet". */
export function noMutualFriendsMessage(firstName: string): string {
  const name = firstName.trim();
  return name ? `You and ${name} have no friends in common yet` : "No friends in common yet";
}

// -----------------------------------------------------------------------------
// Semesters
// -----------------------------------------------------------------------------
const SEASONS = ["Spring", "Summer", "Fall"] as const;
const TERM = /^(Spring|Summer|Fall|Winter) (\d{4})$/;

/** January to May is Spring, June and July Summer, August to December Fall. */
export function currentTerm(date: Date = new Date()): string {
  const month = date.getMonth();
  const season = month <= 4 ? "Spring" : month <= 6 ? "Summer" : "Fall";
  return `${season} ${date.getFullYear()}`;
}

/** Sorts terms in time order: Spring 2026 < Summer 2026 < Fall 2026 < Winter 2026 < Spring 2027. */
export function termSortKey(term: string): number {
  const m = TERM.exec(term);
  if (!m) return 0;
  const order = m[1] === "Spring" ? 1 : m[1] === "Summer" ? 2 : m[1] === "Fall" ? 3 : 4;
  return Number(m[2]) * 10 + order;
}

/** The term `delta` steps away (Winter is skipped: it is a short session, not a semester). */
export function shiftTerm(term: string, delta: number): string {
  const m = TERM.exec(term);
  if (!m) return term;
  let index = Math.max(0, SEASONS.indexOf(m[1] as (typeof SEASONS)[number]));
  let year = Number(m[2]);
  for (let step = 0; step < Math.abs(delta); step++) {
    index += delta > 0 ? 1 : -1;
    if (index > 2) {
      index = 0;
      year += 1;
    } else if (index < 0) {
      index = 2;
      year -= 1;
    }
  }
  return `${SEASONS[index]} ${year}`;
}

/** The terms someone usually picks from: this one first, then the next and the previous one. */
export function pickableTerms(date: Date = new Date()): string[] {
  const now = currentTerm(date);
  return [now, shiftTerm(now, 1), shiftTerm(now, -1)];
}

/** Classes grouped by term: the current term first, then the rest newest first; classes in the order they were added. */
export function groupClassesByTerm(classes: ProfileClass[], date: Date = new Date()): { term: string; current: boolean; classes: ProfileClass[] }[] {
  const now = currentTerm(date);
  const groups = new Map<string, ProfileClass[]>();
  for (const c of classes) groups.set(c.term, [...(groups.get(c.term) ?? []), c]);
  return [...groups.entries()]
    .map(([term, list]) => ({ term, current: term === now, classes: [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
    .sort((a, b) => (a.current === b.current ? termSortKey(b.term) - termSortKey(a.term) : a.current ? -1 : 1));
}

/** "cs3358 " becomes "CS 3358", the way the database stores it. */
export function normalizeClassCode(input: string): string {
  return input.trim().replace(/\s+/g, " ").toUpperCase().replace(/^([A-Z&]+)(\d)/, "$1 $2");
}

/** Why a class code would be refused, or null. Mirrors the database check. */
export function classCodeProblem(input: string): string | null {
  const code = normalizeClassCode(input);
  if (code.length < 2 || code.length > 16) return "Class codes are 2 to 16 characters, like CS 3358.";
  if (!/^[A-Z0-9][A-Z0-9 .&-]*[A-Z0-9]$/.test(code)) return "Use letters and numbers, like CS 3358.";
  return null;
}

/** The subject half of a class code: " cs " becomes "CS". */
export function normalizeClassSubject(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

/** The course number half of a class code: " 1315l " becomes "1315L". */
export function normalizeCourseNumber(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

/** Why a subject would be refused, or null: letters (an & between them is fine), up to 8 of them. */
export function classSubjectProblem(input: string): string | null {
  const subject = normalizeClassSubject(input);
  if (!subject) return "Enter the subject, like CS or MATH.";
  if (subject.length > 8 || !/^[A-Z][A-Z&]*$/.test(subject)) return "Subjects are letters, like CS or MATH.";
  return null;
}

/** Why a course number would be refused, or null: digits first, a letter or two after them allowed, up to 8 characters. */
export function courseNumberProblem(input: string): string | null {
  const number = normalizeCourseNumber(input);
  if (!number) return "Enter the course number, like 3358.";
  if (number.length > 8 || !/^[0-9][A-Z0-9.-]*$/.test(number)) return "Course numbers start with digits, like 3358 or 1315L.";
  return null;
}

/** A subject and a course number as the one class code the database stores: "cs" and "3358" become "CS 3358". */
export function joinClassCode(subject: string, number: string): string {
  return normalizeClassCode(`${normalizeClassSubject(subject)} ${normalizeCourseNumber(number)}`);
}

/** A stored class code back in its two halves, for the edit form: "CS 3358" is CS and 3358 (so is "cs3358"). */
export function splitClassCode(code: string): { subject: string; number: string } {
  const whole = normalizeClassCode(code);
  const at = whole.indexOf(" ");
  if (at > 0) return { subject: whole.slice(0, at), number: whole.slice(at + 1).replace(/\s+/g, "") };
  const m = /^([A-Z&]*)(.*)$/.exec(whole);
  return { subject: m?.[1] ?? whole, number: m?.[2] ?? "" };
}

/** " 001 " or "a" becomes "001" or "A", the way the database stores a section. */
export function normalizeClassSection(input: string): string {
  return input.trim().toUpperCase();
}

/** Why a section would be refused, or null. Mirrors the database check. */
export function classSectionProblem(input: string): string | null {
  const section = normalizeClassSection(input);
  if (section.length < 1 || section.length > 10) return "Sections are 1 to 10 characters, like 001 or A.";
  if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(section)) return "Use letters and numbers for the section, like 001.";
  return null;
}

// -----------------------------------------------------------------------------
// When and where a class meets
// -----------------------------------------------------------------------------
export const WEEKDAYS = [
  { value: "mon", label: "Monday", short: "Mon", letter: "M" },
  { value: "tue", label: "Tuesday", short: "Tue", letter: "T" },
  { value: "wed", label: "Wednesday", short: "Wed", letter: "W" },
  { value: "thu", label: "Thursday", short: "Thu", letter: "Th" },
  { value: "fri", label: "Friday", short: "Fri", letter: "F" },
  { value: "sat", label: "Saturday", short: "Sat", letter: "Sa" },
  { value: "sun", label: "Sunday", short: "Sun", letter: "Su" },
] as const;
export type Weekday = (typeof WEEKDAYS)[number]["value"];
const WEEKDAY_VALUES: readonly string[] = WEEKDAYS.map((d) => d.value);

/** One time a class meets: on these days, from `start` to `end` ("HH:MM", 24-hour). A class can have a few (lecture and lab, say). */
export type ClassMeeting = { days: Weekday[]; start: string; end: string };
export const MAX_CLASS_MEETINGS = 8;
export const CLASS_LOCATION_MAX = 80;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === "string" && WEEKDAY_VALUES.includes(value);
}

/** The meetings a class row carries (its `meetings` column is JSON): anything malformed is left out. */
export function parseClassMeetings(json: unknown): ClassMeeting[] {
  if (!Array.isArray(json)) return [];
  const meetings: ClassMeeting[] = [];
  for (const m of json) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const { days, start, end } = m as { days?: unknown; start?: unknown; end?: unknown };
    if (!Array.isArray(days) || typeof start !== "string" || typeof end !== "string") continue;
    meetings.push({ days: sortWeekdays(days.filter(isWeekday)), start, end });
  }
  return meetings;
}

/** Monday first, each day once. */
export function sortWeekdays(days: Weekday[]): Weekday[] {
  return WEEKDAYS.map((d) => d.value).filter((d) => days.includes(d));
}

/** One day's start and end: how the form edits a class's times, one row per day (a day may have two, a lecture and a lab). */
export type MeetingSlot = { day: Weekday; start: string; end: string };

function dayIndex(day: Weekday): number {
  return WEEKDAY_VALUES.indexOf(day);
}
export function weekdayLabel(day: Weekday): string {
  return WEEKDAYS.find((d) => d.value === day)?.label ?? day;
}

/** A class's meeting times one day at a time, Monday first and the earliest first within a day. */
export function expandMeetings(meetings: ClassMeeting[]): MeetingSlot[] {
  const slots: MeetingSlot[] = [];
  for (const m of meetings) for (const day of m.days) slots.push({ day, start: m.start, end: m.end });
  return slots.sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/** Days that meet at the same time folded into one meeting ("MWF 10:00–10:50"), earliest day first: how a class is stored. */
export function mergeMeetingSlots(slots: MeetingSlot[]): ClassMeeting[] {
  const byTime = new Map<string, ClassMeeting>();
  for (const s of [...slots].sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || a.start.localeCompare(b.start))) {
    const key = `${s.start}-${s.end}`;
    const m = byTime.get(key);
    if (!m) byTime.set(key, { days: [s.day], start: s.start, end: s.end });
    else if (!m.days.includes(s.day)) m.days.push(s.day);
  }
  return [...byTime.values()].map((m) => ({ ...m, days: sortWeekdays(m.days) })).sort((a, b) => dayIndex(a.days[0]!) - dayIndex(b.days[0]!) || a.start.localeCompare(b.start));
}

/** "10:00" plus 50 minutes is "10:50"; never past "23:55". */
export function shiftClockTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.max(0, Math.min(23 * 60 + 55, (h || 0) * 60 + (m || 0) + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Why a class's meeting times would be refused, or null. Mirrors the database check (class_meetings_ok), and also
 * refuses two times on one day that overlap.
 */
export function meetingsProblem(meetings: ClassMeeting[]): string | null {
  if (meetings.length > MAX_CLASS_MEETINGS) return `A class can have up to ${MAX_CLASS_MEETINGS} meeting times.`;
  for (const m of meetings) {
    if (m.days.length === 0 || m.days.some((d) => !isWeekday(d))) return "Pick at least one day for each meeting time.";
    const when = sortWeekdays(m.days).map(weekdayLabel).join(", ");
    if (!HHMM.test(m.start) || !HHMM.test(m.end)) return `${when}: set a start and an end time.`;
    if (m.start >= m.end) return `${when}: the end time has to be after the start time.`;
  }
  const slots = expandMeetings(meetings);
  for (let i = 1; i < slots.length; i++) {
    const a = slots[i - 1]!;
    const b = slots[i]!;
    if (a.day === b.day && b.start < a.end) return `${weekdayLabel(a.day)}: two of its times overlap.`;
  }
  return null;
}

/** Why a classroom location would be refused, or null. */
export function locationProblem(input: string): string | null {
  return input.trim().length > CLASS_LOCATION_MAX ? `Locations are at most ${CLASS_LOCATION_MAX} characters, like Derrick Hall 240.` : null;
}

/** "13:05" reads "1:05 PM"; "00:30" reads "12:30 AM". */
export function formatClockTime(hhmm: string): string {
  const m = HHMM.exec(hhmm);
  if (!m) return hhmm;
  const hours = Number(hhmm.slice(0, 2));
  const minutes = hhmm.slice(3, 5);
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** "MWF", "TTh", "Sa": the days of a meeting in their usual shorthand, Monday first. */
export function weekdayLetters(days: Weekday[]): string {
  return sortWeekdays(days)
    .map((d) => WEEKDAYS.find((w) => w.value === d)?.letter ?? "")
    .join("");
}

/** "MWF 10:00–10:50 AM", or "TTh 11:00 AM–12:20 PM" when the two times fall on different sides of noon. */
export function formatClassMeeting(m: ClassMeeting): string {
  const start = formatClockTime(m.start);
  const end = formatClockTime(m.end);
  const sameHalf = start.slice(-2) === end.slice(-2);
  const times = sameHalf ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`;
  return `${weekdayLetters(m.days)} ${times}`.trim();
}

/** All of a class's meeting times in one line: "MWF 10:00–10:50 AM · T 2:00–3:15 PM". */
export function formatClassMeetings(meetings: ClassMeeting[]): string {
  return meetings.map(formatClassMeeting).join(" · ");
}

/** The line under a class on a profile: "Section 001 · MWF 10:00–10:50 AM · Derrick Hall 240", or "" with none of them. */
export function classDetails(c: { section: string | null; meetings: unknown; location: string | null }): string {
  return [c.section ? `Section ${c.section}` : null, formatClassMeetings(parseClassMeetings(c.meetings)) || null, c.location].filter(Boolean).join(" · ");
}

/** What a course chat is called, the way the database names it: "CS 3358-001 · Fall 2026". */
export function courseChatName(code: string, section: string, term: string): string {
  return `${code}-${section} · ${term}`;
}

// -----------------------------------------------------------------------------
// Usernames
// -----------------------------------------------------------------------------
export const USERNAME_RULES = "3 to 30 characters: letters, numbers, dots and underscores, starting and ending with a letter or number.";

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

/** Why a username would be refused, or null. Mirrors the database check (taken names are only known there). */
export function usernameProblem(input: string): string | null {
  const name = normalizeUsername(input);
  if (!/^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/.test(name) || /[._]{2}/.test(name)) return `Usernames are ${USERNAME_RULES}`;
  return null;
}

// -----------------------------------------------------------------------------
// Grid tiles
// -----------------------------------------------------------------------------
const LISTING_BASES = { apartment: "/apartments", roommate: "/roommates", item: "/marketplace" } as const;

function firstImage(media: FeedMedia[]): { url: string | null; isVideo: boolean } {
  const first = media[0];
  if (!first) return { url: null, isVideo: false };
  return first.type === "photo" ? { url: first.url, isVideo: false } : { url: first.poster ?? null, isVideo: true };
}

/** A post or reel as a grid square. Pass the media the app already builds for it (listingMedia). */
export function tileFromFeedPost(post: Pick<FeedPostWithAuthor, "id" | "kind" | "body" | "pinned_at">, media: FeedMedia[], views: number | null = null): ProfileTile {
  const reel = post.kind === "reel";
  const { url, isVideo } = firstImage(media);
  const text = post.body?.trim() ? post.body.trim() : null;
  return {
    key: `post:${post.id}`,
    type: reel ? "reel" : "post",
    id: post.id,
    href: `/posts/${post.id}`,
    imageUrl: url,
    text,
    isVideo: reel || isVideo,
    multiPhoto: media.length > 1,
    pinned: Boolean(post.pinned_at),
    views,
  };
}

/** An apartment, roommate post or marketplace item as a square of a profile grid (Listings, Saved, Liked). */
export function tileFromListing(type: keyof typeof LISTING_BASES, row: { id: string; title: string }, media: FeedMedia[]): ProfileTile {
  const { url, isVideo } = firstImage(media);
  return {
    key: `${type}:${row.id}`,
    type,
    id: row.id,
    href: `${LISTING_BASES[type]}/${row.id}`,
    imageUrl: url,
    text: row.title?.trim() || null,
    isVideo,
    multiPhoto: media.length > 1,
    pinned: false,
    views: null,
  };
}

/** Pinned first (the most recently pinned on top), then newest. */
export function sortPinnedFirst<T extends { pinned_at: string | null; created_at: string }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => {
    if (a.pinned_at && b.pinned_at) return b.pinned_at.localeCompare(a.pinned_at);
    if (a.pinned_at || b.pinned_at) return a.pinned_at ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}
