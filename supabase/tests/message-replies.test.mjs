// Migration 31 against PGlite: a message answering another one of its chat, the snapshot the database builds from the
// original, and what it refuses.
import { randomUUID } from "node:crypto";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { replyOf, replySnapshotOf } from "../../packages/shared/src/message-replies.ts";

const MIGRATION = "migrations/20261024000000_message_replies.sql";
const { db, mk, as } = await boot();
await expectOk("the migration re-runs cleanly", () => db.exec(read(MIGRATION)));

const one = async (p) => (await p).rows[0];
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
for (const [x, y] of [[A, B], [B, A], [A, C], [C, A]]) await db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [x, y]);
const AB = (await as(A, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [B])))).id;
const AC = (await as(A, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [C])))).id;

const send = (uid, conv, content, extra = {}) =>
  as(uid, () =>
    one(
      db.query("insert into public.messages (conversation_id, sender_id, content, attachments, shared_post, reply_to) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb) returning *", [
        conv,
        uid,
        content,
        JSON.stringify(extra.attachments ?? []),
        extra.shared_post ? JSON.stringify(extra.shared_post) : null,
        extra.reply_to ? JSON.stringify(extra.reply_to) : null,
      ]),
    ),
  );
const photo = { kind: "image", path: `${AB}/${A}/p-pic.jpg`, name: "pic.jpg", size: 100, mime: "image/jpeg" };
const voice = { kind: "audio", path: `${AB}/${B}/v-voice.m4a`, name: "voice.m4a", size: 100, mime: "audio/mp4", duration: 3 };

const hello = await send(A, AB, "Hello there, Bob! " + "x".repeat(200));
await expectOk("a reply carries the database's snapshot of the original: id, sender, kind and its first 140 characters", async () => {
  const r = await send(B, AB, "hi!", { reply_to: { id: hello.id } });
  const got = replyOf(r.reply_to);
  const want = replySnapshotOf(hello);
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
  if (got.text.length !== 140 || got.sender_id !== A || got.kind !== "text") throw new Error(JSON.stringify(got));
});
await expectOk("the reply's own words are what the inbox and the notification say", async () => {
  const c = await one(db.query("select last_message_preview from public.conversations where id = $1", [AB]));
  if (c.last_message_preview !== "hi!") throw new Error(c.last_message_preview);
  const n = await as(A, () => one(db.query("select body from public.notifications where user_id = $1 and type = 'message' order by created_at desc limit 1", [A])));
  if (n?.body !== "hi!") throw new Error(JSON.stringify(n));
});
await expectOk("a forged snapshot is replaced by the real one", async () => {
  const r = await send(B, AB, "sure", { reply_to: { id: hello.id, sender_id: C, kind: "snap", text: "never said" } });
  const got = replyOf(r.reply_to);
  if (got.sender_id !== A || got.kind !== "text" || !got.text.startsWith("Hello there")) throw new Error(JSON.stringify(got));
});
await expectOk("a photo, a voice message and a shared post read as what they were", async () => {
  const p = await send(A, AB, "", { attachments: [photo] });
  const v = await send(B, AB, "", { attachments: [voice] });
  const apartment = randomUUID();
  const s = await send(A, AB, "", { shared_post: { target_type: "apartment", target_id: apartment, kind: "listing", path: `/apartments/${apartment}`, title: "Room", caption: null, image_url: null, author: { id: A, name: "Alice", avatar_url: null } } });
  for (const [orig, kind] of [[p, "photo"], [v, "voice"], [s, "listing"]]) {
    const r = await send(B, AB, "nice", { reply_to: { id: orig.id } });
    const got = replyOf(r.reply_to);
    if (got.kind !== kind || got.text !== null || got.id !== orig.id) throw new Error(`${kind}: ${JSON.stringify(got)}`);
    if (JSON.stringify(got) !== JSON.stringify(replySnapshotOf(orig))) throw new Error(`${kind}: the apps would build ${JSON.stringify(replySnapshotOf(orig))}`);
  }
});
await expectOk("a reply to a reply quotes only the original, never the chain", async () => {
  const first = await send(B, AB, "one", { reply_to: { id: hello.id } });
  const second = await send(A, AB, "two", { reply_to: { id: first.id } });
  const got = replyOf(second.reply_to);
  if (got.id !== first.id || got.text !== "one" || "reply_to" in second.reply_to) throw new Error(JSON.stringify(second.reply_to));
});
await expectError("a message of another chat cannot be answered", () => send(C, AC, "psst", { reply_to: { id: hello.id } }), "in this chat");
await expectError("nor a message that does not exist", () => send(B, AB, "?", { reply_to: { id: randomUUID() } }), "in this chat");
await expectError("nor garbage", () => send(B, AB, "?", { reply_to: { id: "nope" } }), "Invalid reply");
await expectError("nor a list", () => send(B, AB, "?", { reply_to: [hello.id] }), "Invalid reply");
await expectOk("what a reply answers never changes afterwards", async () => {
  const r = await send(B, AB, "fixed", { reply_to: { id: hello.id } });
  const other = await send(A, AB, "other");
  await as(B, () => db.query("update public.messages set reply_to = $2::jsonb where id = $1", [r.id, JSON.stringify({ id: other.id })]));
  await as(B, () => db.query("update public.messages set reply_to = null where id = $1", [r.id]));
  const row = await one(db.query("select reply_to from public.messages where id = $1", [r.id]));
  if (replyOf(row.reply_to)?.id !== hello.id) throw new Error(JSON.stringify(row.reply_to));
});
await expectOk("the quote stays when the original is deleted", async () => {
  const gone = await send(A, AB, "going");
  const r = await send(B, AB, "stay", { reply_to: { id: gone.id } });
  await as(A, () => db.query("delete from public.messages where id = $1", [gone.id]));
  const row = await one(db.query("select reply_to from public.messages where id = $1", [r.id]));
  if (replyOf(row.reply_to)?.text !== "going") throw new Error(JSON.stringify(row.reply_to));
});
await expectOk("search still works with the column in place", async () => {
  const found = await as(B, async () => (await db.query("select id from public.search_messages('Hello', $1, 10)", [AB])).rows);
  if (!found.some((m) => m.id === hello.id)) throw new Error("not found");
});
await expectOk("the migration re-runs cleanly with data in place", () => db.exec(read(MIGRATION)));
done("MIGRATION-31 MESSAGE REPLIES");
