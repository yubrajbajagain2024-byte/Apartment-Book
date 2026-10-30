// Unit tests for the staff console's Analytics and Business helpers (src/ad-ops.ts, migration 59): money as the team
// types it, period-over-period change, how much of a paid period has passed, Central-time scheduling fields, and the
// CSV exports (quoting, and formulas that a spreadsheet must not run). Run: npm run test:shared
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

const ops = await import("../src/ad-ops.ts");

test("parseDollars: whole dollars, cents, commas and a dollar sign; nothing else", () => {
  assert.equal(ops.parseDollars("120"), 12000);
  assert.equal(ops.parseDollars(" $1,250.5 "), 125050);
  assert.equal(ops.parseDollars("99.99"), 9999);
  assert.equal(ops.parseDollars("0.07"), 7);
  assert.equal(ops.parseDollars("0"), 0);
  for (const bad of ["", "  ", "-5", "1.234", "abc", "1e3", "12.", ".5", null, undefined]) assert.equal(ops.parseDollars(bad), null, String(bad));
  assert.equal(ops.parseDollars("100000"), 10_000_000);
  assert.equal(ops.parseDollars("100000.01"), null, "past the default cap of $100,000");
  assert.equal(ops.parseDollars("10001", 1_000_000), null, "a custom cap");
});

test("centsToDollarInput: round trips with parseDollars", () => {
  assert.equal(ops.centsToDollarInput(1200), "12");
  assert.equal(ops.centsToDollarInput(1250), "12.50");
  assert.equal(ops.centsToDollarInput(7), "0.07");
  assert.equal(ops.centsToDollarInput(null), "");
  for (const c of [0, 1, 99, 100, 12345, 10_000_000]) assert.equal(ops.parseDollars(ops.centsToDollarInput(c)), c);
});

test("changeRatio: no change from nothing", () => {
  assert.equal(ops.changeRatio(125, 100), 0.25);
  assert.equal(ops.changeRatio(50, 100), -0.5);
  assert.equal(ops.changeRatio(10, 0), null);
});

test("periodElapsed: clamped to the period", () => {
  assert.equal(ops.periodElapsed(0, 100, 50), 0.5);
  assert.equal(ops.periodElapsed(0, 100, -10), 0);
  assert.equal(ops.periodElapsed(0, 100, 500), 1);
  assert.equal(ops.periodElapsed(null, 100, 50), null);
  assert.equal(ops.periodElapsed(100, 100, 50), null);
});

test("toCsv: RFC 4180 quoting, CRLF, empty cells, and formulas defused", () => {
  const csv = ops.toCsv(["name", "amount", "note"], [
    ["Bean There", 1250, null],
    ['Say "hi", then', 0, "two\nlines"],
    ["=HYPERLINK(\"x\")", -5, "@sum"],
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "name,amount,note");
  assert.equal(lines[1], "Bean There,1250,");
  assert.equal(lines[2], '"Say ""hi"", then",0,"two\nlines"', "quotes doubled; a newline stays inside the quoted cell");
  assert.ok(csv.includes('"two\nlines"'), "a newline is kept inside quotes");
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), "a formula is prefixed and quoted");
  assert.ok(csv.includes(",-5,"), "a negative number is a number, not a formula");
  assert.ok(csv.includes(",'@sum"), "@ is defused");
  assert.ok(csv.endsWith("\r\n"));
});

test("zonedInputValue and zonedInputToMs: Central time, standard and daylight, whatever this machine's zone", () => {
  const CT = "America/Chicago";
  assert.equal(ops.zonedInputToMs("2026-11-02T09:00", CT), Date.UTC(2026, 10, 2, 15, 0), "CST is UTC-6");
  assert.equal(ops.zonedInputToMs("2026-07-01T09:00", CT), Date.UTC(2026, 6, 1, 14, 0), "CDT is UTC-5");
  assert.equal(ops.zonedInputValue(Date.UTC(2026, 10, 2, 15, 0), CT), "2026-11-02T09:00");
  assert.equal(ops.zonedInputValue(Date.UTC(2026, 6, 1, 4, 30), CT), "2026-06-30T23:30", "the day before in Central time");
  for (const v of ["2026-01-15T00:00", "2026-03-08T12:00", "2026-11-01T00:30", "2026-12-31T23:59"]) {
    assert.equal(ops.zonedInputValue(ops.zonedInputToMs(v, CT), CT), v, v);
  }
  assert.equal(ops.zonedInputToMs("2026-03-08T02:30", CT) !== null, true, "a time the spring-forward skips still reads as a moment");
  for (const bad of ["", "2026-11-02", "2026-11-02 09:00", "tomorrow"]) assert.equal(ops.zonedInputToMs(bad, CT), null, bad);
});
