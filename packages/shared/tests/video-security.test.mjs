// Unit tests for the video provider's webhook checks and the length limit (src/media.ts): the signature header read
// strictly, a signature older than the tolerance refused as a replay, and videos over 10 minutes refused.
// Run: npm run test:shared
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

const { parseMuxSignature, muxSignatureFresh, videoTooLong } = await import("../src/media.ts");
const { MAX_VIDEO_DURATION_SECONDS, MUX_WEBHOOK_TOLERANCE_SECONDS } = await import("../src/constants.ts");
const hex = (c) => c.repeat(64);

test("parseMuxSignature: the time and every v1 signature; anything malformed is no signature", () => {
  assert.deepEqual(parseMuxSignature(`t=1700000000,v1=${hex("a")}`), { timestamp: 1700000000, signatures: [hex("a")] });
  assert.deepEqual(parseMuxSignature(` t=1700000000 , v1=${hex("a")}, v1=${hex("b")}`), { timestamp: 1700000000, signatures: [hex("a"), hex("b")] });
  assert.equal(parseMuxSignature(null), null);
  assert.equal(parseMuxSignature(""), null);
  assert.equal(parseMuxSignature(`v1=${hex("a")}`), null, "no time");
  assert.equal(parseMuxSignature("t=1700000000"), null, "no signature");
  assert.equal(parseMuxSignature(`t=17e8,v1=${hex("a")}`), null, "not a plain number");
  assert.equal(parseMuxSignature(`t=1700000000,v1=${hex("G")}`), null, "not hex");
  assert.equal(parseMuxSignature(`t=1700000000,v1=${"a".repeat(63)}`), null, "not a sha256");
});

test("muxSignatureFresh: within the tolerance either way; older (a replay) or far in the future is refused", () => {
  const now = 1_700_000_000;
  assert.equal(MUX_WEBHOOK_TOLERANCE_SECONDS, 300);
  assert.equal(muxSignatureFresh(now, now), true);
  assert.equal(muxSignatureFresh(now - 300, now), true);
  assert.equal(muxSignatureFresh(now - 301, now), false);
  assert.equal(muxSignatureFresh(now - 86_400, now), false);
  assert.equal(muxSignatureFresh(now + 301, now), false);
  assert.equal(muxSignatureFresh(Number.NaN, now), false);
});

test("videoTooLong: over 10 minutes, and only a known length counts", () => {
  assert.equal(MAX_VIDEO_DURATION_SECONDS, 600);
  assert.equal(videoTooLong(600), false);
  assert.equal(videoTooLong(600.5), true);
  assert.equal(videoTooLong(null), false);
  assert.equal(videoTooLong(undefined), false);
});
