import type { EventCategory } from "./constants";
import { addDays, dayKey, startOfDay, wallTimeOf, wallTimeToUtc } from "./events/time";

export * from "./events/category";
export * from "./events/time";
export * from "./events/ics";
export * from "./events/rss";
export * from "./events/sync";

/** The organization an event names, as the event rows carry it (a join on events.organization_id). */
export type EventOrganizationSummary = { id: string; name: string; kind: string; avatar_url: string | null; verified: boolean };

export type EventStatus = "scheduled" | "cancelled" | "pending" | "hidden";

/** An event as the app shows it: the row's columns (snake_case, like the listings) with its organization joined. */
export type EventSummary = {
  id: string;
  university_id: string;
  organization_id: string | null;
  organization: EventOrganizationSummary | null;
  feed_id: string | null;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  category: EventCategory;
  image_url: string | null;
  registration_url: string | null;
  source: "feed" | "organization";
  status: EventStatus;
  save_count: number;
  click_count: number;
  created_by: string | null;
  created_at: string;
};

// --- When --------------------------------------------------------------------------------------------------------------

export type EventDateFilter = "any" | "today" | "week" | "weekend";
export const EVENT_DATE_FILTERS: { value: EventDateFilter; label: string }[] = [
  { value: "any", label: "Upcoming" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "weekend", label: "Weekend" },
];

/** How long an event without an end is taken to run, for "still on" and "over". */
const DEFAULT_LENGTH_MS = 2 * 3600_000;

/** When an event is over: its end, or two hours after its start (an all-day event: the end of its day). */
export function eventEndMs(e: Pick<EventSummary, "starts_at" | "ends_at" | "all_day">): number {
  const start = Date.parse(e.starts_at);
  if (e.ends_at) return Date.parse(e.ends_at);
  return start + (e.all_day ? 86400_000 : DEFAULT_LENGTH_MS);
}

export function isEventOver(e: Pick<EventSummary, "starts_at" | "ends_at" | "all_day">, nowMs: number): boolean {
  return eventEndMs(e) <= nowMs;
}

/**
 * The instants a date pill covers, on the campus's clock: Upcoming is from now (events still running included) a year
 * out; Today to midnight; This week to the end of Sunday; Weekend the coming Saturday and Sunday (this weekend while
 * it lasts). The list asks the database for starts_at in [from, to], with to exclusive, and adds what is still running.
 */
export function eventDateRange(filter: EventDateFilter, nowMs: number, timeZone: string): { from: number; to: number } {
  const dayStart = startOfDay(nowMs, timeZone);
  const today = wallTimeOf(dayStart, timeZone);
  const midnight = (daysAhead: number) => wallTimeToUtc({ ...addDays(today, daysAhead), hour: 0, minute: 0, second: 0 }, timeZone);
  switch (filter) {
    case "today":
      return { from: nowMs, to: midnight(1) };
    case "week": {
      // Through Sunday night; on a Sunday, through the next Sunday (a single evening is not a week).
      const toSunday = (7 - today.weekday) % 7;
      return { from: nowMs, to: midnight(toSunday === 0 ? 8 : toSunday + 1) };
    }
    case "weekend": {
      const toSaturday = (6 - today.weekday + 7) % 7;
      const sat = today.weekday === 0 ? -1 : toSaturday;
      return { from: Math.max(nowMs, midnight(sat)), to: midnight(sat + 2) };
    }
    default:
      return { from: nowMs, to: nowMs + 366 * 86400_000 };
  }
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = timeFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, ...options });
    timeFormatters.set(key, f);
  }
  return f;
}

/** "7:00 PM", "7 PM" when on the hour, "Noon" and "Midnight" by name. */
export function clockLabel(ms: number, timeZone: string): string {
  const w = wallTimeOf(ms, timeZone);
  if (w.minute === 0 && w.hour === 12) return "Noon";
  if (w.minute === 0 && w.hour === 0) return "Midnight";
  const s = fmt(timeZone, { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  return s.replace(":00 ", " ");
}

/** "Today", "Tomorrow", else "Thu, Nov 5" (with the year once it is not this year). */
export function dayLabel(ms: number, timeZone: string, nowMs: number): string {
  const day = startOfDay(ms, timeZone);
  const today = startOfDay(nowMs, timeZone);
  const diff = Math.round((day - today) / 86400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  const sameYear = wallTimeOf(ms, timeZone).year === wallTimeOf(nowMs, timeZone).year;
  return fmt(timeZone, { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(new Date(ms));
}

/**
 * When an event is, in one line, on the campus's clock: "Today · 7–9 PM", "Thu, Nov 5 · 7:30 PM", "Sat, Nov 7 · All day",
 * a multi-day one "Nov 5 – Nov 7". `withDay: false` leaves the day out, for a list already grouped by day.
 */
export function eventWhen(e: Pick<EventSummary, "starts_at" | "ends_at" | "all_day">, timeZone: string, nowMs: number, opts: { withDay?: boolean } = {}): string {
  const withDay = opts.withDay ?? true;
  const start = Date.parse(e.starts_at);
  const end = e.ends_at ? Date.parse(e.ends_at) : null;
  const sameDay = end === null || startOfDay(start, timeZone) === startOfDay(e.all_day ? end - 1 : end, timeZone);
  if (!sameDay) {
    const short = (ms: number) => fmt(timeZone, { month: "short", day: "numeric" }).format(new Date(ms));
    // iCalendar's all-day end is the morning after the last day.
    const last = e.all_day ? end! - 1 : end!;
    const days = `${short(start)} – ${short(last)}`;
    return e.all_day ? days : `${days} · ${clockLabel(start, timeZone)}`;
  }
  const time = e.all_day ? "All day" : end ? `${clockLabel(start, timeZone)} – ${clockLabel(end, timeZone)}`.replace(/ (AM|PM) – (.*) \1$/, " – $2 $1") : clockLabel(start, timeZone);
  return withDay ? `${dayLabel(start, timeZone, nowMs)} · ${time}` : time;
}

/** Whether the event is on right now. */
export function isEventLive(e: Pick<EventSummary, "starts_at" | "ends_at" | "all_day">, nowMs: number): boolean {
  return Date.parse(e.starts_at) <= nowMs && !isEventOver(e, nowMs);
}

export type EventDayGroup<T extends Pick<EventSummary, "starts_at">> = { key: string; label: string; events: T[] };

/** The All list: events in time order, under one heading per day on the campus's clock. */
export function groupEventsByDay<T extends Pick<EventSummary, "starts_at">>(events: T[], timeZone: string, nowMs: number): EventDayGroup<T>[] {
  const groups: EventDayGroup<T>[] = [];
  const sorted = [...events].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  for (const e of sorted) {
    const ms = Date.parse(e.starts_at);
    const key = dayKey(wallTimeOf(ms, timeZone));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, label: dayLabel(ms, timeZone, nowMs), events: [e] });
  }
  return groups;
}

// --- For you -----------------------------------------------------------------------------------------------------------

/** What the ranking knows about the reader. Everything optional: signed out it ranks by time and popularity alone. */
export type ForYouContext = {
  interests?: readonly string[];
  followedOrganizationIds?: readonly string[];
  /** A weight per category, 0..1, from what the reader saved and opened before (see affinityFrom). */
  affinity?: Partial<Record<string, number>>;
  savedIds?: ReadonlySet<string>;
};

/** Category weights from the categories of the events someone saved or opened: the most frequent is 1, the rest in proportion. */
export function affinityFrom(categories: readonly string[]): Partial<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const c of categories) counts[c] = (counts[c] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return {};
  return Object.fromEntries(Object.entries(counts).map(([c, n]) => [c, n / max]));
}

/**
 * The For you score: what the reader is into (a picked interest, a category they keep saving), who they follow, how
 * soon it is (a week away is worth half of tonight), how many others saved or opened it, a picture, and a cancellation
 * counted against. Deterministic, so a page looks the same on every reload; ties go to the earlier event.
 */
export function eventScore(e: EventSummary, ctx: ForYouContext, nowMs: number): number {
  let score = 0;
  if (ctx.interests?.includes(e.category)) score += 3;
  score += 2.5 * (ctx.affinity?.[e.category] ?? 0);
  if (e.organization && ctx.followedOrganizationIds?.includes(e.organization.id)) score += 4;
  const days = Math.max(0, (Date.parse(e.starts_at) - nowMs) / 86400_000);
  score += 3 * Math.exp(-days / 7);
  score += 0.8 * Math.log1p(e.save_count + 0.5 * e.click_count);
  if (e.image_url) score += 0.3;
  if (e.organization?.verified) score += 0.2;
  if (e.status === "cancelled") score -= 2;
  return score;
}

/**
 * Upcoming events in For you order: by score, then time; what is over is left out; among the first five rows the same
 * organization does not take a third row in a row while something else scores within a point of it, so a busy club
 * does not fill the top of the page.
 */
export function rankEvents<T extends EventSummary>(events: T[], ctx: ForYouContext, nowMs: number): T[] {
  const scored = events
    .filter((e) => !isEventOver(e, nowMs))
    .map((e) => ({ e, s: eventScore(e, ctx, nowMs) }))
    .sort((a, b) => b.s - a.s || Date.parse(a.e.starts_at) - Date.parse(b.e.starts_at) || (a.e.id < b.e.id ? -1 : 1));
  const out: T[] = [];
  const rest = [...scored];
  while (rest.length > 0) {
    let pick = 0;
    const candidate = rest[0]!.e.organization?.id;
    if (out.length >= 2 && out.length < 5 && candidate && out.slice(-2).every((x) => x.organization?.id === candidate)) {
      const alt = rest.findIndex((x, i) => i > 0 && x.e.organization?.id !== candidate && x.s >= rest[0]!.s - 1);
      if (alt > 0) pick = alt;
    }
    out.push(rest.splice(pick, 1)[0]!.e);
  }
  return out;
}

/** Where an event lives on the website, for sharing. */
export function eventPath(id: string): string {
  return `/events/${id}`;
}

export function organizationPath(id: string): string {
  return `/organizations/${id}`;
}
