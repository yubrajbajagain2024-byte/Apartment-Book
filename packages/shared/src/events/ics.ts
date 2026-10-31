import { decodeEntities, stripHtml, webUrl } from "./rss";
import { addDays, isTimeZone, wallTimeToUtc, weekdayOf, type WallTime } from "./time";

/**
 * One event as a calendar publishes it (an ICS VEVENT, or an RSS item), before the sync maps it onto an events row.
 * A recurring VEVENT becomes one of these per occurrence, each with its own uid.
 */
export type ParsedEvent = {
  /** Unique within the feed: the VEVENT's UID, with the occurrence's start appended for a recurrence. */
  uid: string;
  title: string;
  description: string | null;
  /** ISO instants. */
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  url: string | null;
  /** A picture the calendar gives the event (RFC 7986 IMAGE, or an image ATTACH), https only. */
  imageUrl: string | null;
  /** The calendar's own words for the kind of event (CATEGORIES), for categoryFromText(). */
  categories: string[];
  cancelled: boolean;
};

export type IcsOptions = {
  /** The campus's zone: what a floating time ("19:00", no zone) and an unknown TZID mean. */
  defaultTimeZone: string;
  /** Occurrences outside [windowStart, windowEnd] (ms) are left out; the window also stops a rule that never ends. */
  windowStart: number;
  windowEnd: number;
  /** The most occurrences one recurring event may yield. */
  maxOccurrences?: number;
};

type Prop = { name: string; params: Record<string, string>; value: string };
type Component = { props: Prop[]; children: Component[]; name: string };

/** The lines of a calendar, unfolded: a line starting with a space or a tab continues the one before (RFC 5545 §3.1). */
export function unfoldIcs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out.filter((l) => l.length > 0);
}

/** "NAME;P1=v1;P2="quoted":value" → the three parts. Parameter names are upper-cased; values keep their case. */
function parseLine(line: string): Prop | null {
  let i = 0;
  let inQuotes = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ":" && !inQuotes) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [rawName, ...rawParams] = head.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (!rawName) return null;
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: rawName.toUpperCase(), params, value };
}

/** The components of a calendar as a tree; properties outside any component are dropped. */
function parseComponents(lines: string[]): Component {
  const root: Component = { name: "ROOT", props: [], children: [] };
  const stack: Component[] = [root];
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      const c: Component = { name: prop.value.toUpperCase(), props: [], children: [] };
      stack[stack.length - 1]!.children.push(c);
      stack.push(c);
    } else if (prop.name === "END") {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1]!.props.push(prop);
    }
  }
  return root;
}

/** The text of a TEXT property: the escapes undone (RFC 5545 §3.3.11). */
export function unescapeIcsText(value: string): string {
  return value.replace(/\\(n|N|,|;|\\)/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Microsoft's and other non-IANA zone names seen in calendars, mapped to zones Intl knows. */
const ZONE_ALIASES: Record<string, string> = {
  "central standard time": "America/Chicago",
  "central daylight time": "America/Chicago",
  "central time (us & canada)": "America/Chicago",
  "us/central": "America/Chicago",
  "eastern standard time": "America/New_York",
  "eastern daylight time": "America/New_York",
  "eastern time (us & canada)": "America/New_York",
  "us/eastern": "America/New_York",
  "mountain standard time": "America/Denver",
  "mountain time (us & canada)": "America/Denver",
  "us/mountain": "America/Denver",
  "pacific standard time": "America/Los_Angeles",
  "pacific daylight time": "America/Los_Angeles",
  "pacific time (us & canada)": "America/Los_Angeles",
  "us/pacific": "America/Los_Angeles",
  "gmt standard time": "Europe/London",
  "utc": "UTC",
  "gmt": "UTC",
  "z": "UTC",
};

/** The zone a TZID names, or the default when Intl does not know it (a "/mozilla.org/…/America/Chicago" prefix is dropped). */
export function resolveTimeZone(tzid: string | undefined, fallback: string): string {
  if (!tzid) return fallback;
  const trimmed = tzid.trim();
  if (isTimeZone(trimmed)) return trimmed;
  const alias = ZONE_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  const tail = /([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(trimmed)?.[1];
  if (tail && isTimeZone(tail)) return tail;
  return fallback;
}

type IcsTime = { wall: WallTime; zone: string | null; allDay: boolean; utc: boolean };

/** A DATE or DATE-TIME value with its TZID, kept as a wall clock plus the zone it is in (null: floating). */
function parseIcsTime(prop: Prop, fallbackZone: string): IcsTime | null {
  const v = prop.value.trim();
  const isDate = prop.params.VALUE === "DATE" || /^\d{8}$/.test(v);
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const wall: WallTime = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0) };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  const utc = m[7] === "Z";
  const zone = utc ? "UTC" : prop.params.TZID ? resolveTimeZone(prop.params.TZID, fallbackZone) : null;
  return { wall, zone, allDay: isDate, utc };
}

/** The instant of an ICS time, a floating one read in the default zone. */
function toUtc(t: IcsTime, defaultZone: string): number {
  return wallTimeToUtc(t.wall, t.zone ?? defaultZone);
}

/** A DURATION ("PT1H30M", "P1D", "-PT15M") in milliseconds, or null when it is not one. */
export function parseIcsDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const ms = ((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 86400 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return sign * ms;
}

type Rule = { freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; interval: number; count: number | null; until: IcsTime | null; byDay: { ordinal: number; weekday: number }[]; byMonthDay: number[] };
const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** An RRULE's parts; null for a rule this sync does not expand (FREQ it does not know, HOURLY and finer). */
function parseRule(value: string, fallbackZone: string): Rule | null {
  const parts: Record<string, string> = {};
  for (const p of value.split(";")) {
    const eq = p.indexOf("=");
    if (eq > 0) parts[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const byDay: Rule["byDay"] = [];
  for (const d of (parts.BYDAY ?? "").split(",").filter(Boolean)) {
    const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d.trim().toUpperCase());
    if (m) byDay.push({ ordinal: Number(m[1] ?? 0), weekday: DAY_CODES[m[2]!]! });
  }
  const byMonthDay = (parts.BYMONTHDAY ?? "").split(",").map((s) => Number(s)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
  const until = parts.UNTIL ? parseIcsTime({ name: "UNTIL", params: {}, value: parts.UNTIL }, fallbackZone) : null;
  return { freq, interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1), count: parts.COUNT ? Math.max(0, Number(parts.COUNT) || 0) : null, until, byDay, byMonthDay };
}

/** The dates of a month that a MONTHLY rule's BYDAY names ("1MO": the first Monday; "-1FR": the last Friday; "TU": every Tuesday). */
function monthDaysByWeekday(year: number, month: number, byDay: Rule["byDay"]): number[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out = new Set<number>();
  for (const { ordinal, weekday } of byDay) {
    const matches: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === weekday) matches.push(d);
    if (ordinal === 0) matches.forEach((d) => out.add(d));
    else {
      const pick = ordinal > 0 ? matches[ordinal - 1] : matches[matches.length + ordinal];
      if (pick) out.add(pick);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The occurrences of a recurring event's start, as wall-clock times, from DTSTART on: DAILY, WEEKLY (BYDAY), MONTHLY
 * (BYMONTHDAY, or BYDAY with an ordinal) and YEARLY, with INTERVAL, COUNT and UNTIL. COUNT counts from DTSTART, which
 * is always the first occurrence. Stops at the window's end, at `max` occurrences, or after a bounded number of steps.
 */
export function expandRule(start: WallTime, rule: Rule, zone: string, windowEnd: number, max: number): WallTime[] {
  const out: WallTime[] = [];
  const untilMs = rule.until ? toUtc(rule.until, zone) : null;
  const startMs = wallTimeToUtc(start, zone);
  const accept = (w: WallTime): boolean => {
    const ms = wallTimeToUtc(w, zone);
    if (ms < startMs) return true; // before the first: skip without stopping
    if (untilMs !== null && ms > untilMs) return false;
    if (ms > windowEnd) return false;
    out.push(w);
    return out.length < max && (rule.count === null || out.length < rule.count);
  };
  const stepLimit = 5000;
  if (rule.freq === "DAILY") {
    for (let i = 0; i < stepLimit; i++) if (!accept(addDays(start, i * rule.interval))) break;
  } else if (rule.freq === "WEEKLY") {
    const days = rule.byDay.length > 0 ? [...new Set(rule.byDay.map((d) => d.weekday))].sort((a, b) => a - b) : [weekdayOf(start)];
    // Weeks begin on Monday (WKST's default); the first week is the one DTSTART falls in.
    const startWeekday = weekdayOf(start);
    const weekStart = addDays(start, -((startWeekday + 6) % 7));
    outer: for (let week = 0; week < stepLimit; week++) {
      const base = addDays(weekStart, week * 7 * rule.interval);
      for (const d of days) {
        const w = addDays(base, (d + 6) % 7);
        if (!accept(w)) break outer;
      }
    }
  } else if (rule.freq === "MONTHLY") {
    outer: for (let i = 0; i < stepLimit; i++) {
      const monthIndex = start.month - 1 + i * rule.interval;
      const year = start.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const days = rule.byDay.length > 0 ? monthDaysByWeekday(year, month, rule.byDay) : rule.byMonthDay.length > 0 ? rule.byMonthDay : [start.day];
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (const day of days) {
        if (day > daysInMonth) continue;
        if (!accept({ ...start, year, month, day })) break outer;
      }
    }
  } else {
    for (let i = 0; i < stepLimit; i++) {
      const year = start.year + i * rule.interval;
      const daysInMonth = new Date(Date.UTC(year, start.month, 0)).getUTCDate();
      if (start.day > daysInMonth) continue;
      if (!accept({ ...start, year })) break;
    }
  }
  return out;
}

const first = (c: Component, name: string): Prop | undefined => c.props.find((p) => p.name === name);
const all = (c: Component, name: string): Prop[] => c.props.filter((p) => p.name === name);
/**
 * A text property's words. Calendars exported from web tools (Trumba, Localist, LiveWhale) put HTML entities in their
 * text ("Texas A&amp;M") and HTML in DESCRIPTION, so entities are decoded everywhere and tags dropped where there are any.
 */
const text = (c: Component, name: string): string | null => {
  const v = first(c, name)?.value;
  const unescaped = v ? unescapeIcsText(v) : "";
  const t = (/<[a-z/][^>]*>/i.test(unescaped) ? stripHtml(unescaped) : decodeEntities(unescaped)).trim();
  return t ? t : null;
};
/** A custom field that names the kind of event (Trumba's X-TRUMBA-CUSTOMFIELD;NAME="Event Type", and its like). */
const TYPE_FIELD = /^(event\s*)?(type|types|category|categories)$/i;
/** The calendar's own words for the kind of event: CATEGORIES, then any X- custom field named like a type or category. */
const categoriesOf = (c: Component): string[] =>
  c.props
    .filter((p) => p.name === "CATEGORIES" || (p.name.startsWith("X-") && TYPE_FIELD.test((p.params.NAME ?? "").trim())))
    .flatMap((p) => unescapeIcsText(p.value).split(","))
    .map((s) => decodeEntities(s).trim())
    .filter(Boolean);
/** The event's picture: an IMAGE property (RFC 7986), else an ATTACH whose type is an image; https only. */
const imageOf = (c: Component): string | null => {
  for (const p of c.props) {
    const isImage = p.name === "IMAGE" || (p.name === "ATTACH" && /^image\//i.test(p.params.FMTTYPE ?? ""));
    const v = p.value.trim();
    if (isImage && /^https:\/\/[^\s"<>]+$/i.test(v) && v.length <= 2000) return v;
  }
  return null;
};
const compact = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Every event a calendar publishes in the window, one per occurrence, with cancellations marked (STATUS:CANCELLED, and
 * an occurrence a RECURRENCE-ID override cancels). A VEVENT without a UID, a title or a start is skipped. All-day
 * events start at the campus's midnight; their end is iCalendar's exclusive one (the day after the last day).
 */
export function parseIcs(textOrLines: string, opts: IcsOptions): ParsedEvent[] {
  const zone: string = isTimeZone(opts.defaultTimeZone) ? opts.defaultTimeZone : "UTC";
  const max = opts.maxOccurrences ?? 60;
  const root = parseComponents(unfoldIcs(textOrLines));
  const events: Component[] = [];
  const walk = (c: Component) => {
    for (const child of c.children) {
      if (child.name === "VEVENT") events.push(child);
      walk(child);
    }
  };
  walk(root);

  // Overrides (RECURRENCE-ID) by UID, keyed by the occurrence they replace.
  const overrides = new Map<string, Map<number, Component>>();
  for (const e of events) {
    const rid = first(e, "RECURRENCE-ID");
    const uid = text(e, "UID");
    if (!rid || !uid) continue;
    const t = parseIcsTime(rid, zone);
    if (!t) continue;
    if (!overrides.has(uid)) overrides.set(uid, new Map());
    overrides.get(uid)!.set(toUtc(t, zone), e);
  }

  const out: ParsedEvent[] = [];
  const seen = new Set<string>();
  /**
   * One event or occurrence. `ownEnd`: read the component's DTEND or DURATION (a single event, an override); an
   * occurrence of a rule gets the master's length instead, since the master's DTEND names the first occurrence's end.
   */
  const emit = (e: Component, uid: string, startMs: number, startTime: IcsTime, durationMs: number | null, ownEnd: boolean) => {
    if (seen.has(uid)) return;
    const title = text(e, "SUMMARY");
    if (!title) return;
    let endMs: number | null = null;
    const dtend = ownEnd ? first(e, "DTEND") : undefined;
    const duration = ownEnd ? first(e, "DURATION") : undefined;
    const endTime = dtend ? parseIcsTime(dtend, zone) : null;
    if (endTime) endMs = toUtc(endTime, zone);
    else if (duration) {
      const d = parseIcsDuration(duration.value);
      if (d !== null) endMs = startMs + d;
    } else if (durationMs !== null) endMs = startMs + durationMs;
    if (endMs !== null && endMs <= startMs) endMs = null;
    const windowed = (endMs ?? startMs) >= opts.windowStart && startMs <= opts.windowEnd;
    if (!windowed) return;
    seen.add(uid);
    const status = (first(e, "STATUS")?.value ?? "").trim().toUpperCase();
    out.push({
      uid,
      title: title.replace(/\s+/g, " ").slice(0, 160),
      description: text(e, "DESCRIPTION")?.slice(0, 5000) ?? null,
      startsAt: new Date(startMs).toISOString(),
      endsAt: endMs === null ? null : new Date(endMs).toISOString(),
      allDay: startTime.allDay,
      location: text(e, "LOCATION")?.replace(/\s+/g, " ").slice(0, 200) ?? null,
      url: webUrl(text(e, "URL")),
      imageUrl: imageOf(e),
      categories: categoriesOf(e),
      cancelled: status === "CANCELLED",
    });
  };

  for (const e of events) {
    if (first(e, "RECURRENCE-ID")) continue;
    const uid = text(e, "UID");
    const dtstart = first(e, "DTSTART");
    if (!uid || !dtstart) continue;
    const start = parseIcsTime(dtstart, zone);
    if (!start) continue;
    const startMs = toUtc(start, zone);
    const rruleProp = first(e, "RRULE");
    const rule = rruleProp ? parseRule(rruleProp.value, zone) : null;
    // The master's length, carried to each occurrence that does not state its own end.
    let durationMs: number | null = null;
    const dtend = first(e, "DTEND");
    const dur = first(e, "DURATION");
    const endTime = dtend ? parseIcsTime(dtend, zone) : null;
    if (endTime) durationMs = toUtc(endTime, zone) - startMs;
    else if (dur) durationMs = parseIcsDuration(dur.value);
    if (!rule) {
      emit(e, uid, startMs, start, null, true);
      continue;
    }
    const exdates = new Set<number>();
    for (const ex of all(e, "EXDATE")) {
      for (const v of ex.value.split(",")) {
        const t = parseIcsTime({ name: "EXDATE", params: ex.params, value: v }, zone);
        if (t) exdates.add(toUtc(t, zone));
      }
    }
    const occurrenceZone = start.zone ?? zone;
    const mine = overrides.get(uid) ?? new Map<number, Component>();
    for (const w of expandRule(start.wall, rule, occurrenceZone, opts.windowEnd, max)) {
      const ms = wallTimeToUtc(w, occurrenceZone);
      if (exdates.has(ms)) continue;
      const override = mine.get(ms);
      const occurrenceUid = `${uid}#${compact(ms)}`;
      if (override) {
        const os = first(override, "DTSTART");
        const ost = os ? parseIcsTime(os, zone) : null;
        const oms = ost ? toUtc(ost, zone) : ms;
        emit(override, occurrenceUid, oms, ost ?? start, durationMs, true);
      } else {
        emit(e, occurrenceUid, ms, { ...start, wall: w }, durationMs, false);
      }
    }
  }
  return out;
}
