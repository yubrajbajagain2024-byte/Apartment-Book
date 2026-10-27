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

test("captionParts: #hashtags are tags, as before; words glued to a # are not", async () => {
  const { captionParts } = await import("../src/format.ts");
  assert.deepEqual(captionParts("Move-in day #CampusLife #über_cool!"), [
    { text: "Move-in day ", tag: false },
    { text: "#CampusLife", tag: true },
    { text: " ", tag: false },
    { text: "#über_cool", tag: true },
    { text: "!", tag: false },
  ]);
  assert.deepEqual(captionParts("#1 and a#b and ##x"), [
    { text: "#1", tag: true },
    { text: " and a#b and ##x", tag: false },
  ]);
  assert.deepEqual(captionParts("nothing to see"), [{ text: "nothing to see", tag: false }]);
  assert.deepEqual(captionParts(""), []);
});

test("captionParts: @mentions carry the username, lowercased, and are not tags", async () => {
  const { captionParts } = await import("../src/format.ts");
  assert.deepEqual(captionParts("Hi @Bob_Smith! see #Dorm"), [
    { text: "Hi ", tag: false },
    { text: "@Bob_Smith", tag: false, mention: "bob_smith" },
    { text: "! see ", tag: false },
    { text: "#Dorm", tag: true },
  ]);
  assert.deepEqual(captionParts("(@alice.b) @1ab"), [
    { text: "(", tag: false },
    { text: "@alice.b", tag: false, mention: "alice.b" },
    { text: ") ", tag: false },
    { text: "@1ab", tag: false, mention: "1ab" },
  ]);
});

test("captionParts: a mention is 3 to 30 characters and never ends in a dot or an underscore", async () => {
  const { captionParts } = await import("../src/format.ts");
  assert.deepEqual(captionParts("@ab hi"), [{ text: "@ab hi", tag: false }], "2 characters is too short");
  assert.deepEqual(captionParts("@abc"), [{ text: "@abc", tag: false, mention: "abc" }]);
  const longest = "a".repeat(30);
  assert.deepEqual(captionParts(`@${longest} ok`), [
    { text: `@${longest}`, tag: false, mention: longest },
    { text: " ok", tag: false },
  ]);
  assert.deepEqual(captionParts("thanks @bob."), [
    { text: "thanks ", tag: false },
    { text: "@bob", tag: false, mention: "bob" },
    { text: ".", tag: false },
  ], "the full stop ends the sentence, not the username");
  assert.deepEqual(captionParts("@__x"), [{ text: "@__x", tag: false }], "it starts with a letter or digit");
});

test("captionParts: email addresses (and an @ glued to a word) are plain text", async () => {
  const { captionParts } = await import("../src/format.ts");
  assert.deepEqual(captionParts("mail bob@uni.edu now"), [{ text: "mail bob@uni.edu now", tag: false }]);
  assert.deepEqual(captionParts("é@bob _@bob"), [{ text: "é@bob _@bob", tag: false }]);
  assert.deepEqual(captionParts("ask @bob@uni.edu"), [
    { text: "ask ", tag: false },
    { text: "@bob", tag: false, mention: "bob" },
    { text: "@uni.edu", tag: false },
  ]);
});

test("captionParts: the parts always put the caption back together", async () => {
  const { captionParts } = await import("../src/format.ts");
  for (const s of ["Hi @Bob_Smith! #Dorm life, mail bob@uni.edu", "#a#b @x.y.z. @@double", "  spaced  @user_1  #tag  "]) {
    assert.equal(captionParts(s).map((p) => p.text).join(""), s);
  }
});
