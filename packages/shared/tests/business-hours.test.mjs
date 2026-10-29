// Unit tests for a business's opening hours (src/business-hours.ts, and the form's schema in src/schemas): whether it
// is open now in its own time zone whatever the viewer's, late nights past midnight, back-to-back days, special hours
// on a date, "soon" within the hour, when it next opens or closes, daylight saving, the list students read, and what
// the form may save. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as in media.test.mjs).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const h = await import("../src/business-hours.ts");
const { businessHoursSchema, businessProfileSchema } = await import("../src/schemas/index.ts");

const nine = [{ open: "09:00", close: "17:00" }];
const HOURS = {
  timezone: "America/Chicago",
  week: { mon: nine, tue: nine, wed: nine, thu: nine, fri: [{ open: "09:00", close: "13:00" }, { open: "14:00", close: "02:00" }], sat: [{ open: "10:00", close: "16:00" }], sun: [] },
  special: [
    { date: "2026-11-26", label: "Thanksgiving", closed: true, hours: [] },
    { date: "2026-12-24", label: null, closed: false, hours: [{ open: "10:00", close: "14:00" }] },
  ],
};
// Central time is UTC-6 in November and December (standard time), UTC-5 in summer.
const cst = (local) => new Date(`${local}:00-06:00`);
const status = (local, hours = HOURS) => h.businessHoursStatus(hours, cst(local));
const brief = (s) => (s ? [s.tone, s.label, s.detail, s.special].filter(Boolean).join(" · ") : null);

test("formatHoursClock and formatHoursRanges read like a phone's clock", () => {
  assert.deepEqual(["00:00", "09:00", "09:30", "12:00", "13:05", "23:59", "24:00"].map(h.formatHoursClock), ["12 AM", "9 AM", "9:30 AM", "12 PM", "1:05 PM", "11:59 PM", "12 AM"]);
  assert.equal(h.formatHoursRanges([]), "Closed");
  assert.equal(h.formatHoursRanges([{ open: "00:00", close: "24:00" }]), "Open 24 hours");
  assert.equal(h.formatHoursRanges(HOURS.week.fri), "9 AM – 1 PM, 2 PM – 2 AM");
});

test("open, closing soon and closed on an ordinary weekday (Monday 2026-11-23)", () => {
  assert.equal(brief(status("2026-11-23T07:59")), "closed · Closed · Opens 9 AM");
  // Within the hour, the hour itself included.
  assert.equal(brief(status("2026-11-23T08:00")), "soon · Opens soon · 9 AM");
  assert.equal(brief(status("2026-11-23T09:00")), "open · Open · Closes 5 PM");
  assert.equal(brief(status("2026-11-23T16:00")), "soon · Closes soon · 5 PM");
  assert.equal(brief(status("2026-11-23T17:00")), "closed · Closed · Opens tomorrow 9 AM");
  assert.equal(status("2026-11-23T12:00").today, "mon");
});

test("in the business's time zone, whatever the viewer's: the same instant is 9:30 AM in Chicago", () => {
  const instant = new Date("2026-11-23T15:30:00Z");
  assert.equal(brief(h.businessHoursStatus(HOURS, instant)), "open · Open · Closes 5 PM");
  assert.equal(brief(h.businessHoursStatus({ ...HOURS, timezone: "America/Los_Angeles" }, instant)), "closed · Closed · Opens 9 AM");
});

test("a late night runs past midnight: Friday's 2 PM – 2 AM is open early Saturday, then Saturday's own hours", () => {
  assert.equal(brief(status("2026-11-27T23:30")), "open · Open · Closes 2 AM");
  assert.equal(brief(status("2026-11-28T01:15")), "soon · Closes soon · 2 AM");
  assert.equal(brief(status("2026-11-28T02:00")), "closed · Closed · Opens 10 AM");
  assert.equal(brief(status("2026-11-27T13:30")), "soon · Opens soon · 2 PM");
});

test("special hours replace the week's: closed on Thanksgiving, short hours on Christmas Eve", () => {
  assert.equal(brief(status("2026-11-26T12:00")), "closed · Closed · Opens tomorrow 9 AM · Thanksgiving");
  assert.equal(brief(status("2026-12-24T09:00")), "soon · Opens soon · 10 AM · Special hours");
  // Christmas Day has no special hours here, so Friday's usual 9 AM.
  assert.equal(brief(status("2026-12-24T15:00")), "closed · Closed · Opens tomorrow 9 AM · Special hours");
  // The day before a closed holiday reads past it.
  assert.equal(brief(status("2026-11-25T18:00")), "closed · Closed · Opens Fri 9 AM");
});

test("Sunday closed, then the next opening is days away", () => {
  assert.equal(brief(status("2026-11-29T12:00")), "closed · Closed · Opens tomorrow 9 AM");
  const weekendsOnly = { ...HOURS, week: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: nine, sun: [] }, special: [] };
  assert.equal(brief(status("2026-11-23T12:00", weekendsOnly)), "closed · Closed · Opens Sat 9 AM");
  const never = { ...HOURS, week: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, special: [] };
  assert.equal(brief(status("2026-11-23T12:00", never)), "closed · Closed");
});

test("open 24 hours: back-to-back days join, so it does not 'close at midnight'", () => {
  const always = { ...HOURS, week: Object.fromEntries(h.HOURS_DAYS.map((d) => [d, [{ open: "00:00", close: "24:00" }]])), special: [] };
  assert.equal(brief(status("2026-11-23T23:59", always)), "open · Open 24 hours");
  const weekdays = { ...always, week: { ...always.week, sat: [], sun: [] } };
  assert.equal(brief(status("2026-11-27T12:00", weekdays)), "open · Open 24 hours · Closes 12 AM");
  // Days before the last open one: no closing time to give yet.
  assert.equal(brief(status("2026-11-26T12:00", weekdays)), "open · Open 24 hours");
});

test("a close at midnight written as 00:00 closes at the end of the day", () => {
  const late = { ...HOURS, week: { ...HOURS.week, mon: [{ open: "18:00", close: "00:00" }] }, special: [] };
  assert.equal(brief(status("2026-11-23T22:00", late)), "open · Open · Closes 12 AM");
  assert.equal(brief(status("2026-11-23T23:30", late)), "soon · Closes soon · 12 AM");
});

test("daylight saving: Chicago in July is UTC-5", () => {
  assert.equal(brief(h.businessHoursStatus(HOURS, new Date("2026-07-06T14:30:00Z"))), "open · Open · Closes 5 PM");
  assert.equal(brief(h.businessHoursStatus(HOURS, new Date("2026-07-06T13:30:00Z"))), "soon · Opens soon · 9 AM");
});

test("no hours, or a time zone this device does not know: no status rather than a wrong one", () => {
  assert.equal(h.businessHoursStatus(null, new Date()), null);
  assert.equal(h.businessHoursStatus({ ...HOURS, timezone: "Not/AZone" }, new Date()), null);
});

test("parseBusinessHours reads the stored value defensively", () => {
  assert.deepEqual(h.parseBusinessHours(HOURS), { ...HOURS, special: HOURS.special });
  assert.equal(h.parseBusinessHours(null), null);
  assert.equal(h.parseBusinessHours({ ...HOURS, timezone: "Europe/London" }), null);
  const messy = h.parseBusinessHours({ ...HOURS, week: { mon: [{ open: "9", close: "17:00" }, { open: "10:00", close: "12:00" }] }, special: [{ date: "2026-02-30", closed: true }, { date: "2026-12-31", closed: false, hours: [] }, { date: "2026-12-25", label: "  Christmas ", closed: true }] });
  assert.deepEqual(messy.week.mon, [{ open: "10:00", close: "12:00" }]);
  assert.deepEqual(messy.week.sun, []);
  assert.deepEqual(messy.special, [{ date: "2026-12-25", label: "Christmas", closed: true, hours: [] }]);
});

test("the week as listed, Monday first, today marked; upcoming special hours only", () => {
  const rows = h.hoursWeekRows(HOURS, "fri");
  assert.deepEqual(rows.map((r) => r.label), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  assert.deepEqual(rows.filter((r) => r.today).map((r) => r.text), ["9 AM – 1 PM, 2 PM – 2 AM"]);
  assert.equal(rows[6].text, "Closed");
  // Today's special hours replace today's row, with the day's name; the other days keep the week's.
  const holiday = h.hoursWeekRows(HOURS, "thu", "2026-11-26");
  assert.deepEqual(holiday.filter((r) => r.today).map((r) => [r.text, r.special]), [["Closed", "Thanksgiving"]]);
  assert.equal(holiday[2].text, "9 AM – 5 PM");
  assert.deepEqual(h.hoursWeekRows(HOURS, "thu", "2026-12-24")[3], { day: "thu", label: "Thursday", text: "10 AM – 2 PM", today: true, special: "Special hours" });
  assert.deepEqual(h.upcomingSpecialHours(HOURS, "2026-11-27"), [{ date: "2026-12-24", dateLabel: "Thu, Dec 24", label: null, text: "10 AM – 2 PM" }]);
  assert.equal(h.upcomingSpecialHours(HOURS, "2026-11-20").length, 2);
  assert.equal(h.upcomingSpecialHours(HOURS, "2026-11-20", 10).length, 1);
});

test("pruneSpecialHours drops dates before yesterday (whose late night may run into today) and sorts the rest", () => {
  const pruned = h.pruneSpecialHours({ ...HOURS, special: [HOURS.special[1], { date: "2026-11-01", label: null, closed: true, hours: [] }, HOURS.special[0]] }, cst("2026-11-27T12:00"));
  assert.deepEqual(pruned.special.map((s) => s.date), ["2026-11-26", "2026-12-24"]);
  assert.deepEqual(h.pruneSpecialHours(HOURS, cst("2026-11-28T00:30")).special.map((s) => s.date), ["2026-12-24"]);
});

test("the form's schema: what the database accepts, nothing else", () => {
  assert.ok(businessHoursSchema.safeParse(HOURS).success);
  assert.ok(businessHoursSchema.safeParse(h.defaultBusinessHours()).success);
  const bad = [
    { ...HOURS, timezone: "Europe/London" },
    { ...HOURS, extra: 1 },
    { ...HOURS, week: { ...HOURS.week, mon: [{ open: "9:00", close: "17:00" }] } },
    { ...HOURS, week: { ...HOURS.week, mon: [{ open: "09:00", close: "09:00" }] } },
    { ...HOURS, week: { ...HOURS.week, mon: [{ open: "24:00", close: "02:00" }] } },
    { ...HOURS, special: [{ ...HOURS.special[0], date: "2026-02-30" }] },
    { ...HOURS, special: [HOURS.special[0], HOURS.special[0]] },
    { ...HOURS, special: [{ ...HOURS.special[0], hours: nine }] },
    { ...HOURS, special: [{ ...HOURS.special[1], hours: [] }] },
    { ...HOURS, special: [{ ...HOURS.special[0], label: "x".repeat(41) }] },
  ];
  for (const b of bad) assert.equal(businessHoursSchema.safeParse(b).success, false, JSON.stringify(b).slice(0, 120));
  // A blank name is no name.
  assert.equal(businessHoursSchema.parse({ ...HOURS, special: [{ ...HOURS.special[0], label: "  " }] }).special[0].label, null);
});

test("the profile form: hours left out, taken off, or sent as JSON", () => {
  const base = { name: "River Rock", category: "housing", universityIds: [] };
  assert.equal(businessProfileSchema.parse(base).hours, undefined);
  assert.equal(businessProfileSchema.parse({ ...base, hours: "" }).hours, undefined);
  assert.equal(businessProfileSchema.parse({ ...base, hours: "null" }).hours, null);
  assert.deepEqual(businessProfileSchema.parse({ ...base, hours: JSON.stringify(HOURS) }).hours.week.fri, HOURS.week.fri);
  assert.equal(businessProfileSchema.safeParse({ ...base, hours: "{not json" }).success, false);
});
