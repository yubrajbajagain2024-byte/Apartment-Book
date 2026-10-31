// Unit tests for the Events tab's pure parts (src/events.ts): the category guessed from a calendar's words, the date
// pills' ranges on the campus's clock, the one-line "when", the day groups, and the For you ranking. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

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

const { categoryFromText, eventDateRange, eventWhen, groupEventsByDay, rankEvents, eventScore, affinityFrom, isEventOver, dayLabel } = await import("../src/events.ts");

const TZ = "America/Chicago";
const T = (iso) => Date.parse(iso);
// Thursday 2026-11-05, 10:00 Chicago.
const NOW = T("2026-11-05T16:00:00Z");
let n = 0;
const ev = (startsAt, extra = {}) => ({ id: `e${++n}`, university_id: "tx", organization_id: null, organization: null, feed_id: null, title: "Event", description: null, starts_at: startsAt, ends_at: null, all_day: false, location: null, category: "other", image_url: null, registration_url: null, source: "feed", status: "scheduled", save_count: 0, click_count: 0, created_by: null, created_at: startsAt, ...extra });

test("categoryFromText: the calendar's own category word first, then its words, then the title, then the feed's default", () => {
  assert.equal(categoryFromText(["Tech"], "Anything", "other"), "tech");
  assert.equal(categoryFromText(["Technology, Student Life"], "Robot races", "other"), "tech");
  assert.equal(categoryFromText([], "Career & Internship Fair", "academic"), "career");
  assert.equal(categoryFromText([], "Guest lecture: the Texas aquifer", "other"), "academic");
  assert.equal(categoryFromText([], "Bobcats vs. Lobos (football)", "other"), "sports");
  assert.equal(categoryFromText([], "Diwali celebration", "other"), "cultural");
  assert.equal(categoryFromText([], "Board meeting", "academic"), "academic");
  assert.equal(categoryFromText([], "Career workshop", "other"), "career");
});

test("eventDateRange: today to midnight, the week through Sunday, the coming weekend, upcoming a year out, on the campus's clock", () => {
  const today = eventDateRange("today", NOW, TZ);
  assert.deepEqual([today.from, today.to], [NOW, T("2026-11-06T06:00:00Z")]);
  const week = eventDateRange("week", NOW, TZ);
  assert.deepEqual([week.from, week.to], [NOW, T("2026-11-09T06:00:00Z")]);
  const weekend = eventDateRange("weekend", NOW, TZ);
  assert.deepEqual([weekend.from, weekend.to], [T("2026-11-07T06:00:00Z"), T("2026-11-09T06:00:00Z")]);
  // On Saturday afternoon the weekend is this one, from now.
  const sat = T("2026-11-07T20:00:00Z");
  assert.deepEqual(eventDateRange("weekend", sat, TZ), { from: sat, to: T("2026-11-09T06:00:00Z") });
  // On Sunday, "this week" runs to the next Sunday night.
  const sun = T("2026-11-08T20:00:00Z");
  assert.equal(eventDateRange("week", sun, TZ).to, T("2026-11-16T06:00:00Z"));
  assert.equal(eventDateRange("any", NOW, TZ).to - NOW, 366 * 86400_000);
});

test("eventWhen and dayLabel: today, tomorrow, a date, a range of hours, all day, several days", () => {
  assert.equal(eventWhen(ev("2026-11-06T01:00:00Z", { ends_at: "2026-11-06T03:00:00Z" }), TZ, NOW), "Today · 7 – 9 PM");
  assert.equal(eventWhen(ev("2026-11-06T19:30:00Z"), TZ, NOW), "Tomorrow · 1:30 PM");
  assert.equal(eventWhen(ev("2026-11-12T17:00:00Z", { ends_at: "2026-11-12T18:30:00Z" }), TZ, NOW), "Thu, Nov 12 · 11 AM – 12:30 PM");
  assert.equal(eventWhen(ev("2026-11-12T18:00:00Z"), TZ, NOW), "Thu, Nov 12 · Noon");
  assert.equal(eventWhen(ev("2026-12-11T06:00:00Z", { all_day: true, ends_at: "2026-12-12T06:00:00Z" }), TZ, NOW), "Fri, Dec 11 · All day");
  assert.equal(eventWhen(ev("2026-12-11T06:00:00Z", { all_day: true, ends_at: "2026-12-14T06:00:00Z" }), TZ, NOW), "Dec 11 – Dec 13");
  assert.equal(eventWhen(ev("2026-11-06T01:00:00Z", { ends_at: "2026-11-06T03:00:00Z" }), TZ, NOW, { withDay: false }), "7 – 9 PM");
  assert.equal(dayLabel(T("2027-01-05T18:00:00Z"), TZ, NOW), "Tue, Jan 5, 2027");
});

test("isEventOver: two hours after a start without an end; the end of the day for all-day; the end when there is one", () => {
  assert.equal(isEventOver(ev("2026-11-05T13:00:00Z"), NOW), true);
  assert.equal(isEventOver(ev("2026-11-05T15:00:00Z"), NOW), false);
  assert.equal(isEventOver(ev("2026-11-05T06:00:00Z", { all_day: true }), NOW), false);
  assert.equal(isEventOver(ev("2026-11-05T13:00:00Z", { ends_at: "2026-11-05T17:00:00Z" }), NOW), false);
});

test("groupEventsByDay: one group per campus day, in order, labelled Today and Tomorrow first", () => {
  const groups = groupEventsByDay([ev("2026-11-07T01:00:00Z"), ev("2026-11-06T01:00:00Z"), ev("2026-11-05T23:00:00Z"), ev("2026-11-06T18:00:00Z")], TZ, NOW);
  assert.deepEqual(groups.map((g) => [g.key, g.label, g.events.length]), [["2026-11-05", "Today", 2], ["2026-11-06", "Tomorrow", 2]]);
});

test("rankEvents: an interest, a followed organization and saves lift an event; sooner beats later; what is over is gone; cancelled sinks; deterministic", () => {
  const club = { id: "club", name: "Robotics", kind: "club", avatar_url: null, verified: true };
  const soonPlain = ev("2026-11-06T01:00:00Z", { title: "soon" });
  const laterInterest = ev("2026-11-20T01:00:00Z", { title: "interest", category: "music" });
  const laterFollowed = ev("2026-11-21T01:00:00Z", { title: "followed", organization: club, organization_id: "club" });
  const popular = ev("2026-11-22T01:00:00Z", { title: "popular", save_count: 40, click_count: 80 });
  const over = ev("2026-11-05T12:00:00Z", { title: "over" });
  const cancelled = ev("2026-11-06T02:00:00Z", { title: "cancelled", status: "cancelled" });
  const ctx = { interests: ["music"], followedOrganizationIds: ["club"], affinity: affinityFrom(["music", "music", "tech"]) };
  const ranked = rankEvents([cancelled, over, popular, laterFollowed, laterInterest, soonPlain], ctx, NOW).map((e) => e.title);
  // A picked interest the reader keeps saving outweighs a follow; both outweigh popularity, which outweighs being soon.
  assert.deepEqual(ranked, ["interest", "followed", "popular", "soon", "cancelled"]);
  assert.ok(eventScore(laterInterest, ctx, NOW) > eventScore(laterInterest, {}, NOW));
  assert.deepEqual(affinityFrom(["music", "music", "tech"]), { music: 1, tech: 0.5 });
  // Signed out: time and popularity alone, the same every time.
  const plain = rankEvents([popular, soonPlain, laterInterest], {}, NOW).map((e) => e.title);
  assert.deepEqual(plain, ["popular", "soon", "interest"]);
  assert.deepEqual(rankEvents([popular, soonPlain, laterInterest], {}, NOW).map((e) => e.title), plain);
});

test("rankEvents: one organization does not take the first rows in a row when something else scores nearly as well", () => {
  const club = { id: "club", name: "Robotics", kind: "club", avatar_url: null, verified: true };
  const theirs = [1, 2, 3, 4].map((d) => ev(`2026-11-0${5 + d}T01:00:00Z`, { title: `club ${d}`, organization: club, organization_id: "club" }));
  // Scores a little under the club's third event (within a point), which is the rule's margin.
  const other = ev("2026-11-10T01:00:00Z", { title: "other", category: "music", save_count: 5 });
  const ranked = rankEvents([...theirs, other], { followedOrganizationIds: ["club"], interests: ["music"] }, NOW).map((e) => e.title);
  // The club's first two lead; the third row goes to the other event rather than a third club row in a row.
  assert.deepEqual(ranked.slice(0, 3), ["club 1", "club 2", "other"]);
});
