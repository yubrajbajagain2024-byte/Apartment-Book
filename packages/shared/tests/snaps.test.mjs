// Unit tests for Snaps (src/snaps.ts). Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SNAP_BUCKET,
  SNAP_ERRORS,
  SNAP_LIFETIME_DAYS,
  SNAP_LIMITS,
  SNAP_MIME_TYPES,
  SNAP_NOTIFICATION_BODY,
  SNAP_PREVIEW,
  SNAP_VIEW_WINDOW_SECONDS,
  newSnapToken,
  snapErrorState,
  snapExtension,
  snapMediaPath,
  snapMediaUrl,
  snapMimeType,
  snapOf,
  snapState,
  snapStatusText,
} from "../src/snaps.ts";

const ID = "6d074520-5a10-43ee-903a-35779a1a1fcc";
const USER = "a1a1a1a1-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-20T12:00:00Z");
const snap = (extra = {}) => ({ id: ID, kind: "image", expires_at: "2026-11-20T12:00:00Z", opened_at: null, ...extra });

test("the bucket, the types and the limits are the database's: snaps, JPEG / MP4 / QuickTime, 50 MB, 30 s, 50 people", () => {
  assert.equal(SNAP_BUCKET, "snaps");
  assert.deepEqual([...SNAP_MIME_TYPES], ["image/jpeg", "video/mp4", "video/quicktime"]);
  assert.deepEqual({ ...SNAP_LIMITS }, { maxBytes: 52428800, maxVideoSeconds: 30, maxRecipients: 50 });
  assert.equal(SNAP_LIFETIME_DAYS, 31);
  assert.equal(SNAP_VIEW_WINDOW_SECONDS, 120);
  assert.equal(SNAP_PREVIEW, "Sent a Snap");
  assert.equal(SNAP_NOTIFICATION_BODY, "Sent you a Snap");
});

test("snapOf reads a message's Snap, and nothing that is not one", () => {
  assert.deepEqual(snapOf(snap()), snap());
  assert.deepEqual(snapOf(snap({ id: ID.toUpperCase(), opened_at: "2026-10-21T08:00:00Z" })), snap({ opened_at: "2026-10-21T08:00:00Z" }));
  assert.equal(snapOf(snap({ gone: true })).gone, true);
  assert.equal("gone" in snapOf(snap({ gone: "yes" })), false, "only a real true counts");
  assert.equal(snapOf(snap({ opened_at: "not a date" })).opened_at, null);
  for (const bad of [null, undefined, "snap", 3, [], {}, snap({ id: "x" }), snap({ kind: "file" }), snap({ expires_at: null }), snap({ expires_at: "soon" })]) {
    assert.equal(snapOf(bad), null, JSON.stringify(bad));
  }
});

test("snapState: new until opened or expired; gone early reads as unavailable", () => {
  assert.equal(snapState(snap(), NOW), "new");
  assert.equal(snapState(snap({ opened_at: "2026-10-20T11:00:00Z" }), NOW), "opened");
  assert.equal(snapState(snap({ expires_at: "2026-10-20T11:59:59Z" }), NOW), "expired");
  assert.equal(snapState(snap({ expires_at: "2026-10-20T12:00:00Z" }), NOW), "expired", "at the very moment it expires");
  assert.equal(snapState(snap({ gone: true }), NOW), "unavailable");
  assert.equal(snapState(snap({ gone: true, expires_at: "2026-10-01T00:00:00Z" }), NOW), "expired");
  assert.equal(snapState(snap({ gone: true, opened_at: "2026-10-20T11:00:00Z" }), NOW), "opened", "opened stays opened");
});

test("snapStatusText: the recipient taps to view, the sender sees it delivered; then both see what became of it", () => {
  assert.equal(snapStatusText(snap(), false, NOW), "Tap to view");
  assert.equal(snapStatusText(snap(), true, NOW), "Delivered");
  for (const mine of [true, false]) {
    assert.equal(snapStatusText(snap({ opened_at: "2026-10-20T11:00:00Z" }), mine, NOW), "Opened");
    assert.equal(snapStatusText(snap({ expires_at: "2026-10-01T00:00:00Z" }), mine, NOW), "Expired");
    assert.equal(snapStatusText(snap({ gone: true }), mine, NOW), "Unavailable");
  }
});

test("file names: the sender's own folder, 32 hex characters, the type's extension", () => {
  const token = newSnapToken();
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.notEqual(newSnapToken(), token);
  assert.equal(newSnapToken(() => 0), "0".repeat(32));
  assert.equal(snapMediaPath(USER.toUpperCase(), token, "image/jpeg"), `${USER}/${token}.jpg`);
  assert.equal(snapMediaPath(USER, token, "video/mp4"), `${USER}/${token}.mp4`);
  assert.equal(snapMediaPath(USER, token, "video/quicktime"), `${USER}/${token}.mov`);
  assert.throws(() => snapMediaPath("me", token, "image/jpeg"));
  assert.throws(() => snapMediaPath(USER, "abc", "image/jpeg"));
  assert.throws(() => snapMediaPath(USER, token, "image/png"));
  assert.equal(snapExtension("image/png"), null);
});

test("snapMediaUrl: Storage's signed-in download of the file, never a signed link", () => {
  const path = `${USER}/${"ab".repeat(16)}.mov`;
  assert.equal(snapMediaUrl("https://x.supabase.co/", path), `https://x.supabase.co/storage/v1/object/authenticated/snaps/${path}`);
  assert.equal(snapMediaUrl("https://x.supabase.co", "a b/c?.jpg"), "https://x.supabase.co/storage/v1/object/authenticated/snaps/a%20b/c%3F.jpg");
});

test("snapMimeType: what pickers report, or the file name when they report nothing", () => {
  assert.equal(snapMimeType("image/jpeg"), "image/jpeg");
  assert.equal(snapMimeType("IMAGE/JPG"), "image/jpeg");
  assert.equal(snapMimeType("video/quicktime"), "video/quicktime");
  assert.equal(snapMimeType("video/mp4; codecs=avc1"), "video/mp4");
  assert.equal(snapMimeType(null, "IMG_0001.MOV"), "video/quicktime");
  assert.equal(snapMimeType("", "clip.m4v"), "video/mp4");
  assert.equal(snapMimeType("application/octet-stream", "photo.jpeg"), "image/jpeg");
  assert.equal(snapMimeType("image/heic", "photo.heic"), null, "HEIC is converted to JPEG first");
  assert.equal(snapMimeType("image/png", "photo.jpg"), null, "a type that says otherwise wins over the name");
  assert.equal(snapMimeType(undefined, undefined), null);
});

test("snapErrorState knows the database's refusals", () => {
  assert.equal(snapErrorState(SNAP_ERRORS.expired), "expired");
  assert.equal(snapErrorState(`Error: ${SNAP_ERRORS.opened}`), "opened");
  assert.equal(snapErrorState(SNAP_ERRORS.unavailable), "unavailable");
  assert.equal(snapErrorState("Failed to fetch"), null);
  assert.equal(snapErrorState(undefined), null);
});

test("snap activity (migration 33): parsed from the message, labelled for each side, the newest or a capture first", async () => {
  const { snapActivityLabel, snapDetectionOf, snapDetectionText, snapLatestActivity, snapOf, snapStatusText, snapWasCaptured, snapWasDeleted } = await import("../src/snaps.ts");
  const id = "6d074520-5a10-43ee-903a-35779a1a1fcc";
  const base = { id, kind: "image", expires_at: "2099-01-01T00:00:00Z", opened_at: "2026-10-23T10:05:00Z" };
  const s = snapOf({ ...base, activity: [{ type: "delivered", at: "2026-10-23T10:00:00Z" }, { type: "opened", at: "2026-10-23T10:05:00Z", detect: "ios" }, { type: "screenshot", at: "2026-10-23T10:05:30Z" }, { type: "bogus", at: "2026-10-23T10:06:00Z" }, { type: "expired", at: "not a date" }] });
  assert.equal(s.activity.length, 3, "unknown types and bad dates are dropped");
  assert.equal(s.activity[1].detect, "ios");
  assert.equal(snapLatestActivity(s).type, "screenshot", "a capture outranks the newest entry");
  assert.equal(snapWasCaptured(s), true);
  assert.equal(snapActivityLabel({ type: "screenshot" }, true), "Screenshot taken");
  assert.equal(snapActivityLabel({ type: "screenshot" }, false), "You took a screenshot");
  assert.equal(snapActivityLabel({ type: "recording" }, true), "Screen recording detected");
  assert.equal(snapActivityLabel({ type: "deleted" }, false), "Snap deleted");
  assert.equal(snapDetectionOf(s), "ios");
  assert.match(snapDetectionText("ios"), /reports screenshots/);
  assert.match(snapDetectionText("android"), /blocks screenshots/);
  assert.match(snapDetectionText("none"), /can't detect/);
  assert.match(snapDetectionText(null), /depends on the device/);
  // Opened by an app that did not say what it can detect: nothing is claimed.
  assert.equal(snapDetectionOf(snapOf(base)), "none");
  assert.equal(snapDetectionOf(snapOf({ ...base, opened_at: null })), null);
  // A Snap taken back reads "Deleted", not "Unavailable"; one that merely went still reads "Unavailable".
  const deleted = snapOf({ ...base, opened_at: null, gone: true, activity: [{ type: "deleted", at: "2026-10-23T11:00:00Z" }] });
  assert.equal(snapWasDeleted(deleted), true);
  assert.equal(snapStatusText(deleted, false), "Deleted");
  assert.equal(snapStatusText(snapOf({ ...base, opened_at: null, gone: true }), false), "Unavailable");
  assert.equal(snapOf({ ...base, activity: "nope" }).activity, undefined);
});
