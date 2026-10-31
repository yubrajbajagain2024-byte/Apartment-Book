import { test } from "node:test";
import assert from "node:assert/strict";

const row = (id, over = {}) => ({
  conversation: { id, lastMessageAt: "2026-10-30T10:00:00+00:00", lastMessagePreview: "Hi", unreadCount: 0, ...over.conversation },
  needsReply: over.needsReply ?? true,
  lastBy: over.lastBy ?? null,
  target: { kind: "post" },
});
const me = { userId: "owner", team: new Map([["owner", "Olivia"], ["ed", "Ed"]]), openConversationId: null };

test("inboxAfterMessage: a student's message moves the chat to the top, unread and needing a reply", async () => {
  const { inboxAfterMessage } = await import("../src/business.ts");
  const rows = [row("a"), row("b", { needsReply: false, lastBy: "You" })];
  const next = inboxAfterMessage(rows, { conversation_id: "b", sender_id: "student", created_at: "2026-10-30T11:00:00+00:00", content: "Is it still available?" }, me);
  assert.equal(next[0].conversation.id, "b");
  assert.equal(next[0].conversation.lastMessagePreview, "Is it still available?");
  assert.equal(next[0].conversation.lastMessageAt, "2026-10-30T11:00:00+00:00");
  assert.equal(next[0].conversation.unreadCount, 1);
  assert.equal(next[0].needsReply, true);
  assert.equal(next[0].lastBy, null);
  assert.equal(next[0].target.kind, "post", "the rest of the row is kept");
  assert.equal(next[1].conversation.id, "a");
  assert.equal(rows[1].conversation.unreadCount, 0, "the old list is untouched");
});

test("inboxAfterMessage: my own reply is 'You:', not unread and not needing a reply; a teammate's is their name and unread for me", async () => {
  const { inboxAfterMessage } = await import("../src/business.ts");
  const mine = inboxAfterMessage([row("a", { conversation: { unreadCount: 2 } })], { conversation_id: "a", sender_id: "owner", created_at: "2026-10-30T11:00:00+00:00", content: "Yes!" }, me);
  assert.equal(mine[0].lastBy, "You");
  assert.equal(mine[0].needsReply, false);
  assert.equal(mine[0].conversation.unreadCount, 2);
  const theirs = inboxAfterMessage([row("a")], { conversation_id: "a", sender_id: "ed", created_at: "2026-10-30T11:00:00+00:00", content: "On it" }, me);
  assert.equal(theirs[0].lastBy, "Ed");
  assert.equal(theirs[0].needsReply, false);
  assert.equal(theirs[0].conversation.unreadCount, 1);
});

test("inboxAfterMessage: the chat open on screen does not count as unread; a chat not listed is null; a late message changes nothing; a photo has its words", async () => {
  const { inboxAfterMessage } = await import("../src/business.ts");
  const open = inboxAfterMessage([row("a")], { conversation_id: "a", sender_id: "student", created_at: "2026-10-30T11:00:00+00:00", content: "" , image_url: "https://x/y.jpg" }, { ...me, openConversationId: "a" });
  assert.equal(open[0].conversation.unreadCount, 0);
  assert.equal(open[0].conversation.lastMessagePreview, "Sent a photo");
  assert.equal(inboxAfterMessage([row("a")], { conversation_id: "zzz", sender_id: "student", created_at: "2026-10-30T11:00:00+00:00" }, me), null);
  const rows = [row("a"), row("b")];
  assert.equal(inboxAfterMessage(rows, { conversation_id: "b", sender_id: "student", created_at: "2026-10-30T09:00:00+00:00", content: "old" }, me), rows);
});

test("inboxAfterRead: my receipt clears the count once I have read up to the newest message, and nothing else changes", async () => {
  const { inboxAfterRead } = await import("../src/business.ts");
  const rows = [row("a", { conversation: { unreadCount: 3 } }), row("b", { conversation: { unreadCount: 1 } })];
  const read = inboxAfterRead(rows, { conversation_id: "a", last_read_at: "2026-10-30T10:00:00.000Z" });
  assert.equal(read[0].conversation.unreadCount, 0);
  assert.equal(read[1].conversation.unreadCount, 1);
  assert.equal(read[0].conversation.id, "a", "the order is kept");
  // A delivery time moving on, with the read time still before the newest message: as it was.
  assert.equal(inboxAfterRead(rows, { conversation_id: "a", last_read_at: "2026-10-30T09:59:00+00:00" }), rows);
  assert.equal(inboxAfterRead(rows, { conversation_id: "nope", last_read_at: "2026-10-30T12:00:00+00:00" }), rows);
  const already = [row("a")];
  assert.equal(inboxAfterRead(already, { conversation_id: "a", last_read_at: "2026-10-30T12:00:00+00:00" }), already);
});

test("inboxReflects: true with nothing seen or a list that has the message; false for an older list or an unknown chat", async () => {
  const { inboxReflects } = await import("../src/business.ts");
  const rows = [row("a")];
  assert.equal(inboxReflects(rows, null), true);
  assert.equal(inboxReflects(rows, { conversationId: "a", createdAt: "2026-10-30T10:00:00.000Z" }), true);
  assert.equal(inboxReflects(rows, { conversationId: "a", createdAt: "2026-10-30T10:00:01+00:00" }), false);
  assert.equal(inboxReflects(rows, { conversationId: "new", createdAt: "2026-10-30T10:00:00+00:00" }), false);
});
