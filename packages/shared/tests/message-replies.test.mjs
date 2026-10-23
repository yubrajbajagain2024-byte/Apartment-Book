// Unit tests for replies in chats (src/message-replies.ts). Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { REPLY_TEXT_MAX_LENGTH, replyKindLabel, replyKindOf, replyOf, replySnapshotOf, replyText } from "../src/message-replies.ts";

const ID = "6d074520-5a10-43ee-903a-35779a1a1fcc";
const USER = "a1a1a1a1-0000-4000-8000-000000000001";
const att = (kind) => ({ kind, path: `${ID}/${USER}/k-${kind}.bin`, name: `${kind}.bin`, size: 10, mime: "application/octet-stream" });

test("replyOf reads the snapshot and drops anything that is not one", () => {
  assert.deepEqual(replyOf({ id: ID, sender_id: USER, kind: "photo", text: null }), { id: ID, sender_id: USER, kind: "photo", text: null });
  // An unknown kind reads as words; a sender that is not an id reads as gone; the text is cut where the database cuts it.
  assert.deepEqual(replyOf({ id: ID, sender_id: "nobody", kind: "hologram", text: "x".repeat(200) }), { id: ID, sender_id: null, kind: "text", text: "x".repeat(REPLY_TEXT_MAX_LENGTH) });
  assert.equal(replyOf({ id: ID, text: "" })?.text, null);
  for (const bad of [null, undefined, "", 7, [], {}, { id: "not-a-uuid" }, { sender_id: USER }]) assert.equal(replyOf(bad), null, JSON.stringify(bad));
});

test("replyKindOf follows the database's order: Snap, then a share, then files, then a website photo, else words", () => {
  const base = { id: ID, sender_id: USER, content: "hi" };
  assert.equal(replyKindOf(base), "text");
  assert.equal(replyKindOf({ ...base, snap: { id: ID, kind: "image" }, shared_post: { target_type: "post", target_id: ID } }), "snap");
  assert.equal(replyKindOf({ ...base, shared_post: { target_type: "post", target_id: ID, kind: "reel" } }), "reel");
  assert.equal(replyKindOf({ ...base, shared_post: { target_type: "post", target_id: ID } }), "post");
  assert.equal(replyKindOf({ ...base, shared_post: { target_type: "apartment", target_id: ID } }), "listing");
  assert.equal(replyKindOf({ ...base, attachments: [att("audio")] }), "voice");
  assert.equal(replyKindOf({ ...base, attachments: [att("image"), att("video")] }), "video");
  assert.equal(replyKindOf({ ...base, attachments: [att("image"), att("file")] }), "photo");
  assert.equal(replyKindOf({ ...base, attachments: [att("file"), att("file")] }), "file");
  assert.equal(replyKindOf({ ...base, attachments: JSON.stringify([att("image")]) }), "photo", "raw JSON from realtime");
  assert.equal(replyKindOf({ ...base, image_url: "https://x.y/p.jpg" }), "photo");
  assert.equal(replyKindOf({ ...base, image_url: "http://x.y/p.jpg" }), "text", "only https pictures count");
});

test("replySnapshotOf is what the database stores: the id, the sender, the kind and the first 140 characters", () => {
  const long = "a".repeat(300);
  assert.deepEqual(replySnapshotOf({ id: ID, sender_id: USER, content: long, attachments: [att("image")] }), { id: ID, sender_id: USER, kind: "photo", text: "a".repeat(140) });
  assert.deepEqual(replySnapshotOf({ id: ID, sender_id: null, content: "" }), { id: ID, sender_id: null, kind: "text", text: null });
});

test("replyText says the words, or what the message was", () => {
  assert.equal(replyText({ id: ID, sender_id: null, kind: "photo", text: "look" }), "look");
  assert.equal(replyText({ id: ID, sender_id: null, kind: "photo", text: null }), "Photo");
  assert.equal(replyText({ id: ID, sender_id: null, kind: "voice", text: null }), "Voice message");
  assert.equal(replyKindLabel("listing"), "Listing");
});
