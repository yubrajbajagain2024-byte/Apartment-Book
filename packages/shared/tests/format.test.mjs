// Unit tests for the shared date formatter (src/format.ts). Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// format.ts imports utils without an extension, as the bundlers resolve it; this hook adds it (as in media.test.mjs).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) return next(specifier + ".ts", context);
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

test("formatDate: a calendar date is the same day in every time zone", async () => {
  const { formatDate } = await import("../src/format.ts");
  assert.equal(formatDate("2026-12-01"), "1 Dec 2026", "not 30 Nov, as midnight UTC reads in Texas");
  assert.equal(formatDate("2027-01-05"), "5 Jan 2027");
  assert.equal(formatDate("2026-02-28"), "28 Feb 2026");
});

test("formatDate: a timestamp still shows its local day, and nothing shows for nothing", async () => {
  const { formatDate } = await import("../src/format.ts");
  const evening = new Date(2026, 9, 25, 23, 30).toISOString();
  assert.equal(formatDate(evening), "25 Oct 2026");
  assert.equal(formatDate(null), "");
  assert.equal(formatDate(""), "");
  assert.equal(formatDate("not a date"), "not a date");
});
