// Unit tests for the calendar parsers and the sync plan (src/events/ics.ts, rss.ts, sync.ts, time.ts): folded lines
// and escapes, local and UTC and floating times, all-day events, DURATION, weekly and monthly rules with COUNT, UNTIL,
// BYDAY and EXDATE, RECURRENCE-ID overrides, cancellations; RSS items with and without a start; the plan's inserts,
// column-by-column updates, cancellations by absence, hidden rows kept, duplicates within a feed. Run: npm run test:shared
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

const { parseIcs, unfoldIcs, unescapeIcsText, parseIcsDuration, resolveTimeZone } = await import("../src/events/ics.ts");
const { parseRss, stripHtml, decodeEntities, webUrl } = await import("../src/events/rss.ts");
const { planFeedSync, titleKeyOf } = await import("../src/events/sync.ts");
const { wallTimeToUtc, wallTimeOf, startOfDay, isTimeZone } = await import("../src/events/time.ts");

const CHICAGO = "America/Chicago";
const T = (iso) => Date.parse(iso);
const WINDOW = { defaultTimeZone: CHICAGO, windowStart: T("2026-11-01T00:00:00Z"), windowEnd: T("2027-03-01T00:00:00Z") };
const cal = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${body}\r\nEND:VCALENDAR\r\n`;
const vevent = (lines) => `BEGIN:VEVENT\r\n${lines.join("\r\n")}\r\nEND:VEVENT`;

test("time: a Chicago wall clock becomes the right instant in winter and summer, and across the fall-back night", () => {
  assert.equal(wallTimeToUtc({ year: 2026, month: 11, day: 5, hour: 19, minute: 0, second: 0 }, CHICAGO), T("2026-11-06T01:00:00Z"));
  assert.equal(wallTimeToUtc({ year: 2026, month: 7, day: 4, hour: 19, minute: 0, second: 0 }, CHICAGO), T("2026-07-05T00:00:00Z"));
  // 2026-11-01 01:30 happens twice in Chicago; the first (CDT, -5) is taken.
  assert.equal(wallTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, CHICAGO), T("2026-11-01T06:30:00Z"));
  assert.deepEqual(wallTimeOf(T("2026-11-06T01:00:00Z"), CHICAGO), { year: 2026, month: 11, day: 5, hour: 19, minute: 0, second: 0, weekday: 4 });
  // Nov 5 is after the clocks went back: Chicago midnight is 06:00Z.
  assert.equal(startOfDay(T("2026-11-06T01:00:00Z"), CHICAGO), T("2026-11-05T06:00:00Z"));
  assert.equal(isTimeZone("Europe/London"), true);
  assert.equal(isTimeZone("Central Standard Time"), false);
});

test("ics: folded lines are unfolded, text escapes undone, durations read, zone names resolved", () => {
  assert.deepEqual(unfoldIcs("SUMMARY:A very\r\n  long title\r\nX:1\r\n\tmore"), ["SUMMARY:A very long title", "X:1more"]);
  assert.equal(unescapeIcsText("Room 1\\, LBJ\\; bring\\\\ a bot\\nand a charger"), "Room 1, LBJ; bring\\ a bot\nand a charger");
  assert.equal(parseIcsDuration("PT1H30M"), 5400_000);
  assert.equal(parseIcsDuration("P1D"), 86400_000);
  assert.equal(parseIcsDuration("-PT15M"), -900_000);
  assert.equal(parseIcsDuration("tomorrow"), null);
  assert.equal(resolveTimeZone("America/New_York", CHICAGO), "America/New_York");
  assert.equal(resolveTimeZone("Central Standard Time", CHICAGO), CHICAGO);
  assert.equal(resolveTimeZone("/mozilla.org/20050126_1/Europe/London", CHICAGO), "Europe/London");
  assert.equal(resolveTimeZone("Mars/Olympus", CHICAGO), CHICAGO);
});

test("ics: a plain event in the campus zone, one in UTC, a floating one, an all-day one, one with a DURATION", () => {
  const events = parseIcs(
    cal(
      [
        vevent(["UID:a@x", "SUMMARY:Robot Races", "DTSTART;TZID=America/Chicago:20261105T190000", "DTEND;TZID=America/Chicago:20261105T210000", "LOCATION:LBJ Student Center\\, Room 3-14.1", "DESCRIPTION:Bring your bot.\\nCharger too.", "CATEGORIES:Technology,Student Life", "URL:https://events.example/a"]),
        vevent(["UID:b@x", "SUMMARY:Finals Study Night", "DTSTART:20261210T020000Z", "DTEND:20261210T050000Z"]),
        vevent(["UID:c@x", "SUMMARY:Floating", "DTSTART:20261106T120000"]),
        vevent(["UID:d@x", "SUMMARY:Reading Day", "DTSTART;VALUE=DATE:20261211", "DTEND;VALUE=DATE:20261212"]),
        vevent(["UID:e@x", "SUMMARY:Coffee", "DTSTART;TZID=America/Chicago:20261107T090000", "DURATION:PT45M"]),
        vevent(["UID:f@x", "SUMMARY:Last year", "DTSTART:20251107T090000Z"]),
        vevent(["SUMMARY:No uid", "DTSTART:20261107T090000Z"]),
      ].join("\r\n"),
    ),
    WINDOW,
  );
  assert.deepEqual(events.map((e) => e.uid), ["a@x", "b@x", "c@x", "d@x", "e@x"]);
  const a = events[0];
  assert.equal(a.startsAt, "2026-11-06T01:00:00.000Z");
  assert.equal(a.endsAt, "2026-11-06T03:00:00.000Z");
  assert.equal(a.location, "LBJ Student Center, Room 3-14.1");
  assert.equal(a.description, "Bring your bot.\nCharger too.");
  assert.deepEqual(a.categories, ["Technology", "Student Life"]);
  assert.equal(a.url, "https://events.example/a");
  assert.equal(a.allDay, false);
  assert.equal(events[1].startsAt, "2026-12-10T02:00:00.000Z");
  assert.equal(events[2].startsAt, "2026-11-06T18:00:00.000Z");
  assert.deepEqual([events[3].allDay, events[3].startsAt, events[3].endsAt], [true, "2026-12-11T06:00:00.000Z", "2026-12-12T06:00:00.000Z"]);
  assert.equal(events[4].endsAt, "2026-11-07T15:45:00.000Z");
});

test("ics: a weekly rule with BYDAY, COUNT and an EXDATE; one occurrence moved by RECURRENCE-ID; the meeting keeps 7 pm across the clock change", () => {
  const events = parseIcs(
    cal(
      [
        vevent(["UID:w@x", "SUMMARY:Weekly meeting", "DTSTART;TZID=America/Chicago:20261027T190000", "DTEND;TZID=America/Chicago:20261027T200000", "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6", "EXDATE;TZID=America/Chicago:20261105T190000"]),
        vevent(["UID:w@x", "RECURRENCE-ID;TZID=America/Chicago:20261103T190000", "SUMMARY:Weekly meeting (moved)", "DTSTART;TZID=America/Chicago:20261104T190000", "DTEND;TZID=America/Chicago:20261104T200000"]),
      ].join("\r\n"),
    ),
    { ...WINDOW, windowStart: T("2026-10-01T00:00:00Z") },
  );
  // Oct 27, Oct 29, Nov 3 (moved to Nov 4), Nov 5 (excluded), Nov 10, Nov 12.
  assert.deepEqual(
    events.map((e) => [e.uid, e.startsAt, e.title]),
    [
      ["w@x#20261028T000000Z", "2026-10-28T00:00:00.000Z", "Weekly meeting"],
      ["w@x#20261030T000000Z", "2026-10-30T00:00:00.000Z", "Weekly meeting"],
      ["w@x#20261104T010000Z", "2026-11-05T01:00:00.000Z", "Weekly meeting (moved)"],
      ["w@x#20261111T010000Z", "2026-11-11T01:00:00.000Z", "Weekly meeting"],
      ["w@x#20261113T010000Z", "2026-11-13T01:00:00.000Z", "Weekly meeting"],
    ],
  );
  // Each occurrence keeps the master's hour-long length.
  assert.equal(events[3].endsAt, "2026-11-11T02:00:00.000Z");
});

test("ics: monthly on the first Monday with UNTIL; daily with INTERVAL; a rule that never ends stops at the window; HOURLY is not expanded", () => {
  const events = parseIcs(
    cal(
      [
        vevent(["UID:m@x", "SUMMARY:First Monday", "DTSTART;TZID=America/Chicago:20261102T180000", "RRULE:FREQ=MONTHLY;BYDAY=1MO;UNTIL=20270201T000000Z"]),
        vevent(["UID:d@x", "SUMMARY:Every other day", "DTSTART:20261101T150000Z", "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3"]),
        vevent(["UID:n@x", "SUMMARY:Forever", "DTSTART:20261101T150000Z", "RRULE:FREQ=WEEKLY"]),
        vevent(["UID:h@x", "SUMMARY:Hourly", "DTSTART:20261101T150000Z", "RRULE:FREQ=HOURLY;COUNT=3"]),
      ].join("\r\n"),
    ),
    WINDOW,
  );
  const of = (uid) => events.filter((e) => e.uid.startsWith(uid)).map((e) => e.startsAt);
  assert.deepEqual(of("m@x"), ["2026-11-03T00:00:00.000Z", "2026-12-08T00:00:00.000Z", "2027-01-05T00:00:00.000Z"]);
  assert.deepEqual(of("d@x"), ["2026-11-01T15:00:00.000Z", "2026-11-03T15:00:00.000Z", "2026-11-05T15:00:00.000Z"]);
  const forever = of("n@x");
  assert.equal(forever.length, 18);
  assert.ok(T(forever.at(-1)) <= WINDOW.windowEnd);
  assert.deepEqual(of("h@x"), ["2026-11-01T15:00:00.000Z"]);
});

test("ics: STATUS:CANCELLED is a cancellation; a cancelled override cancels one occurrence", () => {
  const events = parseIcs(
    cal(
      [
        vevent(["UID:c@x", "SUMMARY:Gone", "DTSTART:20261110T150000Z", "STATUS:CANCELLED"]),
        vevent(["UID:r@x", "SUMMARY:Series", "DTSTART:20261110T150000Z", "RRULE:FREQ=WEEKLY;COUNT=2"]),
        vevent(["UID:r@x", "RECURRENCE-ID:20261117T150000Z", "SUMMARY:Series", "DTSTART:20261117T150000Z", "STATUS:CANCELLED"]),
      ].join("\r\n"),
    ),
    WINDOW,
  );
  assert.deepEqual(events.map((e) => [e.uid, e.cancelled]), [["c@x", true], ["r@x#20261110T150000Z", false], ["r@x#20261117T150000Z", true]]);
});

test("rss: items with a start (ev:startdate, dtstart, dc:date) become events; news items without one do not; HTML and entities are cleaned", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:ev="http://purl.org/rss/1.0/modules/event/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Campus</title>
    <item><title>Career &amp; Internship Fair</title><link>https://events.example/fair</link><guid>fair-1</guid><description><![CDATA[<p>Meet <b>80</b> employers.</p><br>Bring r&eacute;sum&#233;s.]]></description><ev:startdate>2026-11-12T16:00:00Z</ev:startdate><ev:enddate>2026-11-12T20:00:00Z</ev:enddate><ev:location>LBJ Ballroom</ev:location><category>Career</category></item>
    <item><title>Dean's list announced</title><link>https://news.example/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>News.</description></item>
    <item><title>Reading Day</title><guid>rd</guid><dtstart>2026-12-11</dtstart></item>
    <item><title>Choir concert CANCELLED</title><guid>choir</guid><dc:date>2026-11-20T01:00:00Z</dc:date></item>
    <item><title>Too old</title><guid>old</guid><dc:date>2025-11-20T01:00:00Z</dc:date></item>
    <item><title>Dup</title><guid>fair-1</guid><dc:date>2026-11-21T01:00:00Z</dc:date></item>
  </channel></rss>`;
  const events = parseRss(xml, { windowStart: WINDOW.windowStart, windowEnd: WINDOW.windowEnd });
  assert.deepEqual(events.map((e) => e.uid), ["fair-1", "rd", "choir"]);
  const fair = events[0];
  assert.equal(fair.title, "Career & Internship Fair");
  assert.equal(fair.description, "Meet 80 employers.\nBring résumés.");
  assert.deepEqual([fair.startsAt, fair.endsAt, fair.location, fair.url, fair.categories], ["2026-11-12T16:00:00.000Z", "2026-11-12T20:00:00.000Z", "LBJ Ballroom", "https://events.example/fair", ["Career"]]);
  assert.deepEqual([events[1].allDay, events[1].startsAt], [true, "2026-12-11T00:00:00.000Z"]);
  assert.equal(events[2].cancelled, true);
  assert.equal(stripHtml("<div>a</div><div>b &amp; c</div>"), "a\nb & c");
  assert.equal(decodeEntities("&#x2019;&nbsp;&unknown;"), "’ &unknown;");
});

test("ics from a web calendar (Trumba's shape): HTML entities decoded, HTML descriptions turned to text, the Event Type field as a category, the IMAGE picture", () => {
  const events = parseIcs(
    cal(
      vevent([
        "UID:t@x",
        "SUMMARY:Texas State Softball vs Texas A&amp\\;M - Women&#39;s Day",
        "DTSTART:20261110T230000Z",
        "LOCATION:Bobcat Softball Stadium &amp\\; Plaza",
        "DESCRIPTION:Campus Location: Stadium<br>Cost: Free<br><br>Bring a friend &amp\\; cheer.",
        "CATEGORIES:Texas State University Events",
        'X-TRUMBA-CUSTOMFIELD;NAME="Event Type";ID=21;TYPE=number:Performance',
        'X-TRUMBA-CUSTOMFIELD;NAME="Sponsor";ID=46604;TYPE=SingleLine:Athletics Department',
        "IMAGE;VALUE=URI:https://www.trumba.com/i/abc.jpg",
        "ATTACH;FMTTYPE=application/pdf:https://x.example/flyer.pdf",
      ]),
    ),
    WINDOW,
  );
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.title, "Texas State Softball vs Texas A&M - Women's Day");
  assert.equal(e.location, "Bobcat Softball Stadium & Plaza");
  assert.equal(e.description, "Campus Location: Stadium\nCost: Free\nBring a friend & cheer.");
  assert.deepEqual(e.categories, ["Texas State University Events", "Performance"]);
  assert.equal(e.imageUrl, "https://www.trumba.com/i/abc.jpg");
  // An image only over https; a plain link or another file type is not a picture.
  const plain = parseIcs(cal(vevent(["UID:p@x", "SUMMARY:P", "DTSTART:20261110T230000Z", "IMAGE;VALUE=URI:http://x.example/a.jpg", "ATTACH;FMTTYPE=image/png:https://x.example/b.png"])), WINDOW);
  assert.equal(plain[0].imageUrl, "https://x.example/b.png");
});

test("webUrl: a bare host gets https, a web address stays, anything else is dropped (the database accepts only http and https)", () => {
  assert.equal(webUrl("infosecurity.txst.edu"), "https://infosecurity.txst.edu");
  assert.equal(webUrl("www.txst.edu/events?id=1"), "https://www.txst.edu/events?id=1");
  assert.equal(webUrl("https://events.example/a"), "https://events.example/a");
  assert.equal(webUrl("http://events.example/a"), "http://events.example/a");
  for (const bad of ["mailto:a@b.c", "javascript:alert(1)", "Call 512-555-0100", "", null, "ftp://x.example/a", "https://"]) assert.equal(webUrl(bad), null, String(bad));
  const ev = parseIcs(cal(vevent(["UID:u@x", "SUMMARY:U", "DTSTART:20261110T230000Z", "URL:infosecurity.txst.edu"])), WINDOW);
  assert.equal(ev[0].url, "https://infosecurity.txst.edu");
});

test("rss: an image enclosure or media:thumbnail is the item's picture", () => {
  const xml = `<rss xmlns:ev="http://purl.org/rss/1.0/modules/event/" xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title>A</title><guid>a</guid><ev:startdate>2026-11-12T16:00:00Z</ev:startdate><enclosure url="https://x.example/a.jpg?w=1&amp;h=2" type="image/jpeg" length="1"/></item>
    <item><title>B</title><guid>b</guid><ev:startdate>2026-11-12T16:00:00Z</ev:startdate><media:thumbnail url="https://x.example/b.png"/></item>
    <item><title>C</title><guid>c</guid><ev:startdate>2026-11-12T16:00:00Z</ev:startdate><enclosure url="https://x.example/c.mp3" type="audio/mpeg"/></item>
  </channel></rss>`;
  assert.deepEqual(parseRss(xml, { windowStart: WINDOW.windowStart, windowEnd: WINDOW.windowEnd }).map((e) => e.imageUrl), ["https://x.example/a.jpg?w=1&h=2", "https://x.example/b.png", null]);
});

test("sync plan: inserts, column-by-column updates, cancellations by absence, hidden kept, past rows left, duplicates within the feed", () => {
  const feed = { id: "feed-1", university_id: "tx", organization_id: null, default_category: "academic" };
  const now = T("2026-11-01T12:00:00Z");
  const parsed = [
    { uid: "a", title: "Robot Races", description: "x", startsAt: "2026-11-06T01:00:00.000Z", endsAt: null, allDay: false, location: null, url: null, imageUrl: "https://x.example/r.jpg", categories: ["Technology"], cancelled: false },
    { uid: "b", title: "Study Night (moved)", description: null, startsAt: "2026-12-10T02:00:00.000Z", endsAt: "2026-12-10T05:00:00.000Z", allDay: false, location: "Alkek", url: null, imageUrl: null, categories: [], cancelled: false },
    { uid: "c", title: "Hidden one", description: null, startsAt: "2026-11-20T01:00:00.000Z", endsAt: null, allDay: false, location: null, url: null, imageUrl: null, categories: [], cancelled: true },
    { uid: "d", title: "Same", description: null, startsAt: "2026-11-21T01:00:00.000Z", endsAt: null, allDay: false, location: null, url: null, imageUrl: null, categories: [], cancelled: false },
    { uid: "a", title: "Robot Races duplicate", description: null, startsAt: "2026-11-06T01:00:00.000Z", endsAt: null, allDay: false, location: null, url: null, imageUrl: null, categories: [], cancelled: false },
  ];
  const existing = [
    { id: "row-b", external_uid: "b", title: "Study Night", description: null, starts_at: "2026-12-10T02:00:00+00:00", ends_at: "2026-12-10T05:00:00+00:00", all_day: false, location: "Alkek", category: "academic", registration_url: null, image_url: null, status: "scheduled" },
    { id: "row-c", external_uid: "c", title: "Hidden one", description: null, starts_at: "2026-11-20T01:00:00+00:00", ends_at: null, all_day: false, location: null, category: "academic", registration_url: null, image_url: null, status: "hidden" },
    { id: "row-d", external_uid: "d", title: "Same", description: null, starts_at: "2026-11-21T01:00:00+00:00", ends_at: null, all_day: false, location: null, category: "academic", registration_url: null, image_url: null, status: "scheduled" },
    { id: "row-gone", external_uid: "gone", title: "Dropped", description: null, starts_at: "2026-11-25T01:00:00+00:00", ends_at: null, all_day: false, location: null, category: "academic", registration_url: null, image_url: null, status: "scheduled" },
    { id: "row-past", external_uid: "past", title: "Yesterday", description: null, starts_at: "2026-10-31T01:00:00+00:00", ends_at: null, all_day: false, location: null, category: "academic", registration_url: null, image_url: null, status: "scheduled" },
    { id: "row-already", external_uid: "already", title: "Already cancelled", description: null, starts_at: "2026-11-26T01:00:00+00:00", ends_at: null, all_day: false, location: null, category: "academic", registration_url: null, image_url: null, status: "cancelled" },
  ];
  const plan = planFeedSync(parsed, existing, feed, now);
  assert.equal(plan.inserts.length, 1);
  assert.deepEqual([plan.inserts[0].external_uid, plan.inserts[0].category, plan.inserts[0].source, plan.inserts[0].status, plan.inserts[0].image_url], ["a", "tech", "feed", "scheduled", "https://x.example/r.jpg"]);
  assert.deepEqual(plan.updates, [{ id: "row-b", patch: { title: "Study Night (moved)" } }]);
  assert.deepEqual(plan.cancelIds, ["row-gone"]);
  assert.equal(plan.unchanged, 2);
  assert.equal(titleKeyOf("  Robot   Races "), "robot races");
});
