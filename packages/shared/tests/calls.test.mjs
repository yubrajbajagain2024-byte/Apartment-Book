// Unit tests for calls in chats (src/calls.ts). Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { CALL_RING_SECONDS, callOf, callPreview, callRowText, formatCallDuration, missedCallBody } from "../src/calls.ts";

const ID = "6d074520-5a10-43ee-903a-35779a1a1fcc";
const ME = "a1a1a1a1-0000-4000-8000-000000000001";
const THEM = "b2b2b2b2-0000-4000-8000-000000000002";

test("callOf reads a call row and drops anything that is not one", () => {
  assert.deepEqual(callOf({ id: ID, kind: "video", status: "active", ended_reason: null, duration: null, started_by: ME }), { id: ID, kind: "video", status: "active", ended_reason: null, duration: null, started_by: ME });
  // Ended without a reason reads as missed; a reason on a call still going is ignored; durations are whole seconds.
  assert.deepEqual(callOf({ id: ID, kind: "audio", status: "ended", duration: 83.6 }), { id: ID, kind: "audio", status: "ended", ended_reason: "missed", duration: 84, started_by: null });
  assert.equal(callOf({ id: ID, kind: "audio", status: "ringing", ended_reason: "completed" }).ended_reason, null);
  for (const bad of [null, "x", {}, { id: "nope", kind: "audio" }, { id: ID, kind: "hologram" }]) assert.equal(callOf(bad), null, JSON.stringify(bad));
});

test("formatCallDuration", () => {
  assert.equal(formatCallDuration(0), "0:00");
  assert.equal(formatCallDuration(42), "0:42");
  assert.equal(formatCallDuration(725), "12:05");
  assert.equal(formatCallDuration(3800), "1:03:20");
  assert.equal(formatCallDuration(null), "");
  assert.equal(formatCallDuration(-1), "");
});

test("callPreview is one line for both sides, as the database writes it", () => {
  assert.equal(callPreview({ kind: "audio", status: "ringing", ended_reason: null }), "Audio call");
  assert.equal(callPreview({ kind: "video", status: "ended", ended_reason: "completed" }), "Video call");
  assert.equal(callPreview({ kind: "video", status: "ended", ended_reason: "declined" }), "Video call declined");
  assert.equal(callPreview({ kind: "audio", status: "ended", ended_reason: "missed" }), "Missed audio call");
  assert.equal(callPreview({ kind: "audio", status: "ended", ended_reason: "expired" }), "Missed audio call");
});

test("callRowText speaks to whoever is looking", () => {
  const base = { id: ID, kind: "audio", started_by: ME, duration: null };
  assert.deepEqual(callRowText({ ...base, status: "ringing", ended_reason: null }, ME), { title: "Audio call", detail: "Calling…", missed: false });
  assert.deepEqual(callRowText({ ...base, status: "ringing", ended_reason: null }, THEM), { title: "Audio call", detail: "Ringing", missed: false });
  assert.deepEqual(callRowText({ ...base, status: "active", ended_reason: null }, THEM), { title: "Audio call", detail: "In progress", missed: false });
  assert.deepEqual(callRowText({ ...base, status: "ended", ended_reason: "completed", duration: 204 }, THEM), { title: "Audio call", detail: "3:24", missed: false });
  assert.deepEqual(callRowText({ ...base, status: "ended", ended_reason: "missed" }, ME), { title: "Audio call", detail: "No answer", missed: false });
  assert.deepEqual(callRowText({ ...base, status: "ended", ended_reason: "missed" }, THEM), { title: "Missed audio call", detail: null, missed: true });
  assert.deepEqual(callRowText({ ...base, status: "ended", ended_reason: "declined" }, THEM), { title: "Audio call", detail: "Declined", missed: true });
  assert.deepEqual(callRowText({ ...base, status: "ended", ended_reason: "declined" }, ME), { title: "Audio call", detail: "Declined", missed: false });
});

test("the ring and the missed-call words match the database", () => {
  assert.equal(CALL_RING_SECONDS, 45);
  assert.equal(missedCallBody("video"), "Missed video call");
});
