// Migration 33 against PGlite: what happens to a Snap, logged on its message (delivered, opened with what the device
// can detect, a screenshot or a recording with the sender's notification, deleted by its sender, expired by the purge),
// who may log what, and the one view unchanged.
import { randomUUID } from "node:crypto";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { SNAP_CAPTURE_NOTIFICATION, newSnapToken, snapLatestActivity, snapMediaPath, snapOf, snapStatusText } from "../../packages/shared/src/snaps.ts";

const MIGRATION = "migrations/20261026000000_snap_activity.sql";
// Migration 34 corrects the trigger this one creates, so it runs again after it.
const QUIET = "migrations/20261027000000_snap_close_quiet.sql";
const { db, mk, as } = await boot();
await expectOk("the migration re-runs cleanly", async () => { await db.exec(read(MIGRATION)); await db.exec(read(QUIET)); });

const one = async (p) => (await p).rows[0];
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
for (const [x, y] of [[A, B], [B, A], [A, C], [C, A]]) await db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [x, y]);
const PREVIEW = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const upload = async (uid) => { const p = snapMediaPath(uid, newSnapToken(), "image/jpeg"); await as(uid, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('snaps',$1,$2)", [p, uid])); return p; };
// The file goes up first (its own signed-in call), then the send: a nested `as` would end the outer one's session.
const send = async (uid, to) => { const path = await upload(uid); return as(uid, async () => (await one(db.query("select public.send_snap($1,'image','image/jpeg',1080,1440,null,$2::uuid[],$3) as r", [path, to, PREVIEW]))).r); };
const snapOn = async (uid, messageId) => snapOf((await as(uid, () => one(db.query("select snap from public.messages where id = $1", [messageId])))).snap);
const types = (snap) => (snap.activity ?? []).map((a) => a.type);

// --- delivered --------------------------------------------------------------------------------------------------------
const first = await send(A, [B]);
const firstMessage = first.sent[0].message_id;
await expectOk("delivered: the recipient's app logs it once, and only the recipient can", async () => {
  await as(B, () => db.query("select public.snap_delivered($1)", [first.snap_id]));
  await as(B, () => db.query("select public.snap_delivered($1)", [first.snap_id]));
  await as(A, () => db.query("select public.snap_delivered($1)", [first.snap_id]));
  await as(C, () => db.query("select public.snap_delivered($1)", [first.snap_id]));
  const s = await snapOn(A, firstMessage);
  if (JSON.stringify(types(s)) !== JSON.stringify(["delivered"])) throw new Error(JSON.stringify(s.activity));
});

// --- opened -----------------------------------------------------------------------------------------------------------
await expectOk("opened: the view goes on the activity with what the device can detect, the preview staying", async () => {
  await as(B, () => db.query("select public.open_snap($1, 'ios')", [first.snap_id]));
  const s = await snapOn(A, firstMessage);
  if (JSON.stringify(types(s)) !== JSON.stringify(["delivered", "opened"]) || s.activity[1].detect !== "ios" || s.preview !== PREVIEW || !s.opened_at) throw new Error(JSON.stringify(s));
});
const second = await send(A, [B]);
await expectOk("opened: an older app's one-argument call still opens, claiming nothing about detection", async () => {
  await as(B, () => db.query("select public.open_snap($1)", [second.snap_id]));
  const s = await snapOn(B, second.sent[0].message_id);
  const opened = s.activity.find((a) => a.type === "opened");
  if (!opened || opened.detect !== undefined) throw new Error(JSON.stringify(s.activity));
});
await expectOk("opened: a made-up detection is dropped", async () => {
  const third = await send(A, [B]);
  await as(B, () => db.query("select public.open_snap($1, 'quantum')", [third.snap_id]));
  const s = await snapOn(B, third.sent[0].message_id);
  if (s.activity.find((a) => a.type === "opened").detect !== undefined) throw new Error(JSON.stringify(s.activity));
});

// --- screenshots and recordings --------------------------------------------------------------------------------------
await expectOk("capture: the recipient reports a screenshot, it is logged, and the sender is told at once", async () => {
  await as(B, () => db.query("select public.report_snap_capture($1, 'screenshot')", [first.snap_id]));
  const s = await snapOn(A, firstMessage);
  if (types(s).at(-1) !== "screenshot" || snapLatestActivity(s).type !== "screenshot") throw new Error(JSON.stringify(s.activity));
  const n = await as(A, () => one(db.query("select type, title, body, data from public.notifications where user_id = $1 and type = 'snap_activity'", [A])));
  if (!n || n.title !== "Bob" || n.body !== SNAP_CAPTURE_NOTIFICATION.screenshot || n.data.snap_id !== first.snap_id) throw new Error(JSON.stringify(n));
});
await expectOk("capture: a recording too, as its own notification", async () => {
  await as(B, () => db.query("select public.report_snap_capture($1, 'recording')", [first.snap_id]));
  const n = await as(A, async () => (await db.query("select body from public.notifications where user_id = $1 and type = 'snap_activity' order by created_at", [A])).rows.map((r) => r.body));
  if (JSON.stringify(n) !== JSON.stringify([SNAP_CAPTURE_NOTIFICATION.screenshot, SNAP_CAPTURE_NOTIFICATION.recording])) throw new Error(JSON.stringify(n));
});
await expectError("capture: the sender cannot report on their own Snap", () => as(A, () => db.query("select public.report_snap_capture($1, 'screenshot')", [first.snap_id])), "isn't available");
await expectError("capture: nor someone outside the chat", () => as(C, () => db.query("select public.report_snap_capture($1, 'screenshot')", [first.snap_id])), "isn't available");
await expectError("capture: only a screenshot or a recording", () => as(B, () => db.query("select public.report_snap_capture($1, 'photo')", [first.snap_id])), "screenshot or a recording");
await expectError("capture: not before the Snap is opened", async () => { const s = await send(A, [B]); await as(B, () => db.query("select public.report_snap_capture($1, 'screenshot')", [s.snap_id])); }, "isn't open");
await expectError("capture: not long after the view", async () => {
  await db.query("update public.messages set snap = snap || jsonb_build_object('opened_at', now() - interval '6 minutes') where id = $1", [firstMessage]);
  await as(B, () => db.query("select public.report_snap_capture($1, 'screenshot')", [first.snap_id]));
}, "isn't open");
await expectOk("capture: it still works once the Snap's rows are over (closed and purged), from the message alone", async () => {
  const s = await send(A, [B]);
  await as(B, () => db.query("select public.open_snap($1, 'android')", [s.snap_id]));
  await as(B, () => db.query("select public.close_snap($1)", [s.snap_id]));
  const left = await one(db.query("select count(*)::int as n from public.snaps where id = $1", [s.snap_id]));
  if (left.n !== 0) throw new Error("the closed Snap's rows should be gone");
  await as(B, () => db.query("select public.report_snap_capture($1, 'screenshot')", [s.snap_id]));
  const m = await snapOn(A, s.sent[0].message_id);
  if (types(m).at(-1) !== "screenshot" || m.activity.find((a) => a.type === "opened").detect !== "android") throw new Error(JSON.stringify(m.activity));
  // Viewed and closed is the end of a Snap, not a deletion (migration 34).
  if (types(m).includes("deleted") || m.gone || m.preview !== PREVIEW) throw new Error("a closed Snap must not read as deleted: " + JSON.stringify(m));
});

// --- deleted ----------------------------------------------------------------------------------------------------------
await expectOk("deleted: the sender takes a waiting Snap back; both chats say so and the preview goes", async () => {
  const s = await send(A, [B, C]);
  await as(A, () => db.query("select public.delete_snap($1)", [s.snap_id]));
  for (const sent of s.sent) {
    const m = await snapOn(A, sent.message_id);
    if (!m.gone || m.preview || types(m).at(-1) !== "deleted" || snapStatusText(m, false) !== "Deleted" || snapStatusText(m, true) !== "Deleted") throw new Error(JSON.stringify(m));
  }
  const left = await one(db.query("select count(*)::int as n from public.snaps where id = $1", [s.snap_id]));
  if (left.n !== 0) throw new Error("rows should be gone");
  const queued = await one(db.query("select count(*)::int as n from public.snap_purges"));
  if (queued.n < 1) throw new Error("the file should be queued for deletion");
});
await expectOk("deleted: after one view it still says so on every chat, the opened one keeping its mark", async () => {
  const s = await send(A, [B, C]);
  await as(B, () => db.query("select public.open_snap($1, 'ios')", [s.snap_id]));
  await as(A, () => db.query("select public.delete_snap($1)", [s.snap_id]));
  const opened = await snapOn(B, s.sent.find((x) => x.recipient_id === B).message_id);
  const waiting = await snapOn(C, s.sent.find((x) => x.recipient_id === C).message_id);
  if (!opened.opened_at || opened.gone || opened.preview !== PREVIEW || types(opened).at(-1) !== "deleted") throw new Error(JSON.stringify(opened));
  if (!waiting.gone || waiting.preview || types(waiting).at(-1) !== "deleted") throw new Error(JSON.stringify(waiting));
});
await expectError("deleted: only its sender", async () => { const s = await send(A, [B]); await as(B, () => db.query("select public.delete_snap($1)", [s.snap_id])); }, "isn't yours");
await expectError("deleted: not twice", async () => { const s = await send(A, [B]); await as(A, () => db.query("select public.delete_snap($1)", [s.snap_id])); await as(A, () => db.query("select public.delete_snap($1)", [s.snap_id])); }, "already over");

await expectError("deleted: once taken back it cannot be opened", async () => {
  const s = await send(A, [B]);
  await as(A, () => db.query("select public.delete_snap($1)", [s.snap_id]));
  await as(B, () => db.query("select public.open_snap($1, 'ios')", [s.snap_id]));
}, "isn't available");
await expectOk("a failed open never marks a Snap viewed: refused to its sender and to a stranger, it stays new and unlogged", async () => {
  const s = await send(A, [B]);
  for (const [uid, label] of [[A, "sender"], [C, "stranger"]]) {
    let failed = false;
    try { await as(uid, () => db.query("select public.open_snap($1, 'ios')", [s.snap_id])); } catch { failed = true; }
    if (!failed) throw new Error(label + " opened it");
  }
  const m = await snapOn(B, s.sent[0].message_id);
  if (m.opened_at || m.gone || m.activity) throw new Error(JSON.stringify(m));
  const r = await one(db.query("select opened_at from public.snap_recipients where snap_id = $1", [s.snap_id]));
  if (r.opened_at) throw new Error("recipient row marked opened");
});

// --- expired ----------------------------------------------------------------------------------------------------------
// The harness's stand-in for storage.objects has no created_at; the purge reads it (as the Snaps test adds it too).
await db.exec("alter table storage.objects add column if not exists created_at timestamptz not null default now()");
await expectOk("expired: the purge logs it on a Snap nobody opened, and nothing on one everyone did", async () => {
  const late = await send(A, [B]);
  // As a month passing would leave them: the Snap's row and its message both past their expiry.
  await db.query("update public.snaps set expires_at = now() - interval '1 day' where id = $1", [late.snap_id]);
  await db.query("update public.messages set snap = snap || jsonb_build_object('expires_at', now() - interval '1 day') where id = $1", [late.sent[0].message_id]);
  const viewed = await send(A, [B]);
  await as(B, () => db.query("select public.open_snap($1, 'ios')", [viewed.snap_id]));
  await db.query("update public.snap_recipients set opened_at = now() - interval '1 hour' where snap_id = $1", [viewed.snap_id]);
  await db.query("update public.messages set snap = snap || jsonb_build_object('opened_at', now() - interval '1 hour') where id = $1", [viewed.sent[0].message_id]);
  await db.query("select public.purge_snaps()");
  const l = await snapOn(A, late.sent[0].message_id);
  if (!l.gone || l.preview || types(l).at(-1) !== "expired" || snapStatusText(l, true) !== "Expired") throw new Error(JSON.stringify(l));
  const v = await snapOn(A, viewed.sent[0].message_id);
  if (v.gone || v.preview !== PREVIEW || JSON.stringify(types(v)) !== JSON.stringify(["opened"])) throw new Error(JSON.stringify(v));
});

// --- the column stays closed ------------------------------------------------------------------------------------------
// (An update from the API changes nothing either: messages have no update policy, so it finds no row.)
await expectError("nobody writes activity from the API", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, snap) values ($1,$2,'',$3::jsonb)", [first.sent[0].conversation_id, A, JSON.stringify({ id: randomUUID(), kind: "image", expires_at: "2099-01-01T00:00:00Z", activity: [{ type: "screenshot", at: "2026-01-01T00:00:00Z" }] })])), "send_snap()");
await expectOk("the activity keeps only its newest 40 entries", async () => {
  const s = await send(A, [B]);
  for (let i = 0; i < 45; i++) await db.query("select public.snap_log($1, $2::jsonb)", [s.sent[0].message_id, JSON.stringify({ type: "delivered", at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() })]);
  const m = await snapOn(A, s.sent[0].message_id);
  if (m.activity.length !== 40 || !m.activity[0].at.startsWith("2026-01-01T00:05")) throw new Error(`${m.activity.length} entries, first at ${m.activity[0].at}`);
});
await expectOk("the migration re-runs cleanly with data in place", async () => { await db.exec(read(MIGRATION)); await db.exec(read(QUIET)); });
await expectOk("migration 34 re-runs cleanly on its own", () => db.exec(read(QUIET)));
done("MIGRATION-33 SNAP ACTIVITY");
