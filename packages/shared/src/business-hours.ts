// A business's opening hours (businesses.hours, migration 57): a time zone, opening and closing times for each weekday,
// and special hours on given dates (holidays, events) that replace the week's for that date. The website and the app
// show students whether the business is open now from these, in the business's own time zone, whatever the viewer's.

export type HoursRange = {
  /** "HH:MM", 24-hour, local to the business. */
  open: string;
  /** "HH:MM", or "24:00" for midnight at the end of the day. A close at or before the open is after midnight. */
  close: string;
};
export type HoursDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type SpecialHours = {
  /** "YYYY-MM-DD", in the business's time zone. */
  date: string;
  /** What the day is ("Thanksgiving"); null for none. */
  label: string | null;
  /** Closed all day; otherwise `hours` replaces the week's for this date. */
  closed: boolean;
  hours: HoursRange[];
};
export type BusinessHours = { timezone: string; week: Record<HoursDay, HoursRange[]>; special: SpecialHours[] };

/** Monday first, as the profile lists them. */
export const HOURS_DAYS: readonly HoursDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const HOURS_DAY_LABELS: Record<HoursDay, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};
/** Sunday first, as Date#getUTCDay counts. */
const BY_WEEKDAY: readonly HoursDay[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SHORT_DAYS: Record<HoursDay, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The time zones a business can keep its hours in: UniBuzz's campuses are in the United States (the database's list). */
export const HOURS_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Phoenix", label: "Arizona Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
] as const;
export const HOURS_TIMEZONE_VALUES = HOURS_TIMEZONES.map((t) => t.value) as unknown as readonly [string, ...string[]];
/** Texas State's, the launch campus. */
export const DEFAULT_HOURS_TIMEZONE = "America/Chicago";
/** Ranges a day may have, special dates a business may keep (the database's limits). */
export const MAX_HOURS_RANGES = 3;
export const MAX_SPECIAL_HOURS = 60;

export const OPEN_CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CLOSE_CLOCK = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
export const HOURS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Monday to Friday 9 to 5, closed at weekends: where the portal's editor starts. */
export function defaultBusinessHours(timezone: string = DEFAULT_HOURS_TIMEZONE): BusinessHours {
  const nine = [{ open: "09:00", close: "17:00" }];
  return { timezone, week: { mon: nine, tue: nine, wed: nine, thu: nine, fri: nine, sat: [], sun: [] }, special: [] };
}

/** Whether a "YYYY-MM-DD" names a real day. */
export function isHoursDate(date: string): boolean {
  if (!HOURS_DATE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function rangesOf(raw: unknown): HoursRange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is HoursRange => typeof r === "object" && r !== null && OPEN_CLOCK.test(String((r as HoursRange).open)) && CLOSE_CLOCK.test(String((r as HoursRange).close)))
    .filter((r) => r.open !== r.close)
    .slice(0, MAX_HOURS_RANGES)
    .map((r) => ({ open: r.open, close: r.close }));
}

/**
 * The hours as stored (businesses.hours), read defensively: null when the business has none (or the database has no
 * such column yet); a range or date that does not parse is left out rather than shown wrong.
 */
export function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as { timezone?: unknown; week?: unknown; special?: unknown };
  if (typeof r.timezone !== "string" || !(HOURS_TIMEZONE_VALUES as readonly string[]).includes(r.timezone)) return null;
  if (typeof r.week !== "object" || r.week === null) return null;
  const week = Object.fromEntries(HOURS_DAYS.map((d) => [d, rangesOf((r.week as Record<string, unknown>)[d])])) as Record<HoursDay, HoursRange[]>;
  const special = (Array.isArray(r.special) ? r.special : [])
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && typeof s.date === "string" && isHoursDate(s.date))
    .map((s) => ({
      date: s.date as string,
      label: typeof s.label === "string" && s.label.trim() ? s.label.trim().slice(0, 40) : null,
      closed: s.closed === true,
      hours: s.closed === true ? [] : rangesOf(s.hours),
    }))
    .filter((s) => s.closed || s.hours.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { timezone: r.timezone, week, special };
}

/** Minutes since midnight of an "HH:MM" ("24:00" is 1440). */
export function minutesOfClock(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/** "9 AM", "9:30 AM", "12 PM", "12 AM" (midnight, also for "24:00"). */
export function formatHoursClock(clock: string): string {
  const total = minutesOfClock(clock) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

/** "9 AM – 5 PM", "9 AM – 1 PM, 2 PM – 6 PM", "Open 24 hours" or "Closed". */
export function formatHoursRanges(ranges: HoursRange[]): string {
  if (ranges.length === 0) return "Closed";
  if (ranges.length === 1 && ranges[0].open === "00:00" && ranges[0].close === "24:00") return "Open 24 hours";
  return ranges.map((r) => `${formatHoursClock(r.open)} – ${formatHoursClock(r.close)}`).join(", ");
}

/** The date and time it is now where the business is, or null when this device cannot tell (no time-zone data). */
export function localTimeIn(timeZone: string, now: Date): { date: string; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
    return isHoursDate(date) && Number.isFinite(minutes) ? { date, minutes } : null;
  } catch {
    return null;
  }
}

/** The "YYYY-MM-DD" `days` after `date` (before, when negative). */
export function addHoursDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Which weekday a "YYYY-MM-DD" is. */
export function hoursDayOf(date: string): HoursDay {
  const [y, m, d] = date.split("-").map(Number);
  return BY_WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "Thu, Nov 26". */
export function formatHoursDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${SHORT_DAYS[hoursDayOf(date)]}, ${MONTHS[m - 1]} ${d}`;
}

/** The special hours for a date, if it has any. */
export function specialHoursOn(hours: BusinessHours, date: string): SpecialHours | null {
  return hours.special.find((s) => s.date === date) ?? null;
}

/** A date's hours: its special hours when it has them, the week's otherwise. */
export function hoursOn(hours: BusinessHours, date: string): HoursRange[] {
  const special = specialHoursOn(hours, date);
  if (special) return special.closed ? [] : special.hours;
  return hours.week[hoursDayOf(date)];
}

export type HoursStatus = {
  /** Green, amber or red, as students read it at a glance. */
  tone: "open" | "soon" | "closed";
  /** "Open", "Open 24 hours", "Closes soon", "Closed" or "Opens soon". */
  label: string;
  /** "Closes 9 PM", "Opens tomorrow 9 AM", "9 PM" (after a "soon"), or null when there is nothing to add. */
  detail: string | null;
  /** The business's weekday and date now, for marking today in the list. */
  today: HoursDay;
  date: string;
  /** Today's special hours, by name ("Thanksgiving", or "Special hours" when unnamed); null on an ordinary day. */
  special: string | null;
};

/**
 * Whether the business is open at `now`, in its own time zone: with the special hours of the dates they cover, ranges
 * that run past midnight (yesterday's late night counts this morning), back-to-back ranges joined (an open 24 hours
 * that runs into the next day does not "close at midnight"), "soon" within the hour, and when it next opens or closes.
 * Null when the business has no hours or the device cannot work out the time there.
 */
export function businessHoursStatus(hours: BusinessHours | null, now: Date): HoursStatus | null {
  if (!hours) return null;
  const local = localTimeIn(hours.timezone, now);
  if (!local) return null;
  // Every open stretch from yesterday to a week ahead, in minutes from the start of today, joined where they touch.
  const spans: [number, number][] = [];
  for (let day = -1; day <= 7; day++) {
    for (const r of hoursOn(hours, addHoursDays(local.date, day))) {
      const open = minutesOfClock(r.open);
      const close = minutesOfClock(r.close);
      spans.push([day * 1440 + open, day * 1440 + (close <= open ? close + 1440 : close)]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const s of spans) {
    const last = joined[joined.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else joined.push([s[0], s[1]]);
  }

  const minute = local.minutes;
  const today = hoursDayOf(local.date);
  const special = specialHoursOn(hours, local.date);
  const base = { today, date: local.date, special: special ? (special.label ?? "Special hours") : null };
  const at = (t: number, closing: boolean) => {
    const day = Math.floor(t / 1440);
    const of = t - day * 1440;
    const clock = formatHoursClock(`${String(Math.floor(of / 60)).padStart(2, "0")}:${String(of % 60).padStart(2, "0")}`);
    // Closing late at night belongs to the evening before: "Closes 2 AM", not "Closes tomorrow 2 AM".
    if (day === 0 || (closing && day === 1 && of <= 6 * 60)) return clock;
    if (day === 1) return `tomorrow ${clock}`;
    return `${SHORT_DAYS[hoursDayOf(addHoursDays(local.date, day))]} ${clock}`;
  };

  const current = joined.find(([start, end]) => start <= minute && minute < end);
  if (current) {
    if (current[0] <= 0 && current[1] >= 1440) return { ...base, tone: "open", label: "Open 24 hours", detail: current[1] < 2 * 1440 ? `Closes ${at(current[1], true)}` : null };
    if (current[1] - minute <= 60) return { ...base, tone: "soon", label: "Closes soon", detail: at(current[1], true) };
    return { ...base, tone: "open", label: "Open", detail: `Closes ${at(current[1], true)}` };
  }
  const next = joined.find(([start]) => start > minute);
  if (next && next[0] - minute <= 60) return { ...base, tone: "soon", label: "Opens soon", detail: at(next[0], false) };
  return { ...base, tone: "closed", label: "Closed", detail: next ? `Opens ${at(next[0], false)}` : null };
}

/** The week as the profile lists it, Monday first: each day's regular hours, today marked. */
export function hoursWeekRows(hours: BusinessHours, today: HoursDay | null): { day: HoursDay; label: string; text: string; today: boolean }[] {
  return HOURS_DAYS.map((d) => ({ day: d, label: HOURS_DAY_LABELS[d], text: formatHoursRanges(hours.week[d]), today: d === today }));
}

/** Special hours from today on, within `days` days, soonest first: "Thu, Nov 26 · Thanksgiving · Closed". */
export function upcomingSpecialHours(hours: BusinessHours, today: string, days = 60): { date: string; dateLabel: string; label: string | null; text: string }[] {
  const until = addHoursDays(today, days);
  return hours.special
    .filter((s) => s.date >= today && s.date < until)
    .map((s) => ({ date: s.date, dateLabel: formatHoursDate(s.date), label: s.label, text: s.closed ? "Closed" : formatHoursRanges(s.hours) }));
}

/** The hours to save: special dates before yesterday (in the business's time zone) dropped, the rest by date. */
export function pruneSpecialHours(hours: BusinessHours, now: Date): BusinessHours {
  const local = localTimeIn(hours.timezone, now);
  const from = local ? addHoursDays(local.date, -1) : null;
  return { ...hours, special: hours.special.filter((s) => !from || s.date >= from).sort((a, b) => a.date.localeCompare(b.date)) };
}
