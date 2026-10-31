/**
 * Wall-clock time in a named time zone, without a date library: a campus publishes "7 pm" in its own zone (see
 * universities.timezone, migration 61), the database keeps instants, and the app shows the campus's clock wherever the
 * reader is. Everything here runs on Node, the browser and Hermes, which all ship Intl with time zones.
 */

/** A moment on a wall clock: the calendar fields, no zone. */
export type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A formatter per zone, kept: making one is the slow part of Intl. Throws RangeError for a zone Intl does not know. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Whether Intl knows this zone ("America/Chicago" yes, "Central Standard Time" no). */
export function isTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall clock of a zone at an instant, with the day of the week (0 Sunday … 6 Saturday). */
export function wallTimeOf(utcMs: number, timeZone: string): WallTime & { weekday: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl says "24" for midnight under some ICU builds with hourCycle h23 absent; h23 is asked for, but guard anyway.
  const hour = Number(get("hour")) % 24;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), hour, minute: Number(get("minute")), second: Number(get("second")), weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))) };
}

/** The zone's offset from UTC at an instant, in milliseconds (Chicago in winter: -6 h). */
function offsetAt(utcMs: number, timeZone: string): number {
  const w = wallTimeOf(utcMs, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - utcMs;
}

/**
 * The instant a wall-clock time names in a zone. Across a daylight-saving change the first guess is refined once; a
 * time that does not exist (the skipped hour) lands an hour later, one that happens twice takes the first.
 */
export function wallTimeToUtc(w: WallTime, timeZone: string): number {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const first = offsetAt(guess, timeZone);
  let utc = guess - first;
  const second = offsetAt(utc, timeZone);
  if (second !== first) utc = guess - second;
  return utc;
}

/** Midnight at the start of the day that holds the instant, in the zone. */
export function startOfDay(utcMs: number, timeZone: string): number {
  const w = wallTimeOf(utcMs, timeZone);
  return wallTimeToUtc({ year: w.year, month: w.month, day: w.day, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** The same wall-clock time `days` days later (so a 7 pm meeting stays at 7 pm across a daylight-saving change). */
export function addDays(w: WallTime, days: number): WallTime {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return { ...w, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The day of the week of a wall-clock date (0 Sunday … 6 Saturday). */
export function weekdayOf(w: WallTime): number {
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

/** "2026-11-05" for a wall-clock date: the key a list groups a day's events under. */
export function dayKey(w: WallTime): string {
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}
