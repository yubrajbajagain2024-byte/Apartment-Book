// Migration 29 against PGlite: voice messages as chat attachments, and Snaps that carry a blurred preview until opened.
import { randomUUID } from "node:crypto";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { MESSAGE_ATTACHMENT_MIME_TYPES, attachmentPreview } from "../../packages/shared/src/message-media.ts";
import { newSnapToken, snapMediaPath, snapOf } from "../../packages/shared/src/snaps.ts";

const MIGRATION = "migrations/20261022000000_voice_and_snap_previews.sql";
// Migration 30 replaces close_snap() and migration 32 open_snap(), so they run again after this one.
const CLOSE = "migrations/20261023000000_snap_close_deletes.sql";
const STAY = "migrations/20261025000000_snap_previews_stay.sql";
// Migration 33 replaces open_snap() with a two-argument form (dropping the old one), so it runs last of all.
const ACTIVITY = "migrations/20261026000000_snap_activity.sql";
const QUIET = "migrations/20261027000000_snap_close_quiet.sql";
const { db, mk, as } = await boot();
await expectOk("the migration re-runs cleanly", async () => { await db.exec(read(MIGRATION)); await db.exec(read(CLOSE)); await db.exec(read(STAY)); await db.exec(read(ACTIVITY)); await db.exec(read(QUIET)); });

const one = async (p) => (await p).rows[0];
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob");
for (const [x, y] of [[A, B], [B, A]]) await db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [x, y]);
const AB = (await as(A, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [B])))).id;
const PREVIEW = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

await expectOk("voice: the bucket takes the phones' audio, as the apps check", async () => {
  const b = await one(db.query("select allowed_mime_types from storage.buckets where id = 'message-media'"));
  for (const t of ["audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg"]) if (!b.allowed_mime_types.includes(t)) throw new Error("missing " + t);
  if ([...b.allowed_mime_types].sort().join() !== [...MESSAGE_ATTACHMENT_MIME_TYPES].sort().join()) throw new Error("the apps and the bucket disagree");
});
const voice = { kind: "audio", path: `${AB}/${A}/v1-voice.m4a`, name: "voice.m4a", size: 48000, mime: "audio/mp4", duration: 7.4 };
await expectOk("voice: a voice message is sent, previews and notifies as one", async () => {
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, attachments) values ($1,$2,'',$3::jsonb)", [AB, A, JSON.stringify([voice])]));
  const c = await one(db.query("select last_message_preview from public.conversations where id = $1", [AB]));
  if (c.last_message_preview !== "Sent a voice message" || attachmentPreview([voice]) !== c.last_message_preview) throw new Error(c.last_message_preview);
  const n = await as(B, () => one(db.query("select body from public.notifications where user_id = $1 and type = 'message'", [B])));
  if (n?.body !== "Sent a voice message") throw new Error(JSON.stringify(n));
});
await expectError("voice: still only in the sender's own folder of the chat", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, attachments) values ($1,$2,'',$3::jsonb)", [AB, A, JSON.stringify([{ ...voice, path: `${AB}/${B}/v2-voice.m4a` }])])), "own folder");

const upload = async (uid) => { const p = snapMediaPath(uid, newSnapToken(), "image/jpeg"); await as(uid, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('snaps',$1,$2)", [p, uid])); return p; };
const send = (uid, path, extra = []) => as(uid, async () => (await one(db.query(`select public.send_snap($1,'image','image/jpeg',1080,1440,null,$2::uuid[]${extra.length ? ",$3" : ""}) as r`, [path, [B], ...extra]))).r);
const msg = async (uid, id) => snapOf((await as(uid, () => one(db.query("select snap from public.messages where id = $1", [id])))).snap);

let withPreview;
await expectOk("snap: the preview and the shape ride on the message", async () => {
  withPreview = await send(A, await upload(A), [PREVIEW]);
  const s = await msg(B, withPreview.sent[0].message_id);
  if (s?.preview !== PREVIEW || s.width !== 1080 || s.height !== 1440 || s.opened_at !== null) throw new Error(JSON.stringify(s));
});
await expectOk("snap: older apps still send with seven arguments, without a preview", async () => {
  const sent = await send(A, await upload(A));
  const s = await msg(B, sent.sent[0].message_id);
  if (!s || s.preview || s.width !== 1080) throw new Error(JSON.stringify(s));
});
for (const [label, bad] of [["not a data URL", "https://example.com/x.jpg"], ["not a JPEG", "data:image/png;base64,AAAA"], ["too long", "data:image/jpeg;base64," + "A".repeat(9000)]]) {
  await expectError(`snap: a preview ${label} is refused`, async () => send(A, await upload(A), [bad]), "Invalid Snap preview");
}
await expectOk("snap: opening it marks it opened and keeps the blurred preview for both people (migration 32)", async () => {
  await as(B, () => db.query("select public.open_snap($1)", [withPreview.snap_id]));
  for (const uid of [A, B]) {
    const s = await msg(uid, withPreview.sent[0].message_id);
    if (!s?.opened_at || s.preview !== PREVIEW || s.width !== 1080) throw new Error(JSON.stringify(s));
  }
});
// Closed by its only recipient, the Snap is over (its rows and file go, migration 30): no second view, preview or not.
await expectError("snap: still only one view, preview or not", () => as(B, async () => {
  await db.query("select public.close_snap($1)", [withPreview.snap_id]);
  await db.query("select public.open_snap($1)", [withPreview.snap_id]);
}), "isn't available");
await expectOk("snap: the preview is still on the message after the Snap is over", async () => {
  const s = await msg(A, withPreview.sent[0].message_id);
  if (!s?.opened_at || s.preview !== PREVIEW) throw new Error(JSON.stringify(s));
});
await expectOk("snap: one that goes unopened loses its preview too", async () => {
  const sent = await send(A, await upload(A), [PREVIEW]);
  await db.query("delete from public.snaps where id = $1", [sent.snap_id]);
  const s = await msg(B, sent.sent[0].message_id);
  if (!s?.gone || s.preview) throw new Error(JSON.stringify(s));
});
await expectError("snap: nobody writes a preview from the API", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, snap) values ($1,$2,'',$3::jsonb)", [AB, A, JSON.stringify({ id: randomUUID(), kind: "image", expires_at: "2099-01-01T00:00:00Z", preview: PREVIEW })])), "send_snap()");

await expectOk("the migration re-runs cleanly with data in place", async () => { await db.exec(read(MIGRATION)); await db.exec(read(CLOSE)); await db.exec(read(STAY)); await db.exec(read(ACTIVITY)); await db.exec(read(QUIET)); });
await expectOk("migrations 32 and 33 re-run cleanly on their own", async () => { await db.exec(read(STAY)); await db.exec(read(ACTIVITY)); await db.exec(read(QUIET)); });
done("MIGRATION-29 VOICE AND SNAP PREVIEWS");
