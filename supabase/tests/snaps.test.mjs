// Migration 28 (Snaps) against PGlite: the private bucket and its policies, who a Snap can go to, sending (one message
// per person, the inbox preview and the notification), the one view (open, the two minutes, close, expiry), and
// purge_snaps() deleting what is over through a stand-in for pg_net and Vault.
import { randomUUID } from "node:crypto";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
// The limits and the wording must stay the same in the apps and in the database.
import { SNAP_BUCKET, SNAP_ERRORS, SNAP_LIMITS, SNAP_MIME_TYPES, SNAP_NOTIFICATION_BODY, SNAP_PREVIEW, newSnapToken, snapMediaPath, snapOf, snapState } from "../../packages/shared/src/snaps.ts";

const MIGRATION = "migrations/20261020120000_snaps.sql";
const { db, mk, as, asAnon } = await boot();
// Migrations 29 and 30 replace send_snap(), open_snap() and close_snap(), so they run again after this one.
const PREVIEWS = "migrations/20261022000000_voice_and_snap_previews.sql";
const CLOSE = "migrations/20261023000000_snap_close_deletes.sql";
await expectOk("the Snaps migration re-runs cleanly", async () => { await db.exec(read(MIGRATION)); await db.exec(read(PREVIEWS)); await db.exec(read(CLOSE)); });

const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
const D = await mk("d@txstate.edu", "Dave"), E = await mk("e@txstate.edu", "Erin"), F = await mk("f@txstate.edu", "Frank");

// Alice and Bob are friends (they follow each other) with no chat yet. Carol has a direct chat with Alice and is not a
// friend. Dave only follows Alice. Erin was a friend until she blocked Alice. Frank is a friend who left their chat.
const follow = (a, b) => db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [a, b]);
for (const [x, y] of [[A, B], [B, A], [D, A], [A, E], [E, A], [A, F], [F, A]]) await follow(x, y);
const direct = async (me, other) => (await as(me, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [other])))).id;
const AC = await direct(C, A);
await as(C, () => db.query("insert into public.messages (conversation_id, sender_id, content, created_at) values ($1,$2,'hey!', now() - interval '1 hour')", [AC, C]));
await db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [E, A]);
const AF = await direct(A, F);
await db.query("delete from public.conversation_members where conversation_id = $1 and user_id = $2", [AF, F]);

const path = (uid, mime = "image/jpeg") => snapMediaPath(uid, newSnapToken(), mime);
const upload = (uid, name) => as(uid, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('snaps',$1,$2)", [name, uid]));
const canRead = async (uid, name) => (await as(uid, () => rows(db.query("select name from storage.objects where bucket_id = 'snaps' and name = $1", [name])))).length > 0;
const send = (uid, args) =>
  as(uid, async () =>
    (await one(db.query("select public.send_snap($1,$2,$3,$4,$5,$6,$7::uuid[]) as r", [args.path, args.kind ?? "image", args.mime ?? "image/jpeg", args.width ?? 1080, args.height ?? 1440, args.duration ?? null, args.to]))).r,
  );
const open = (uid, snapId) => as(uid, async () => (await one(db.query("select public.open_snap($1) as r", [snapId]))).r);
const close = (uid, snapId) => as(uid, () => db.query("select public.close_snap($1)", [snapId]));
const messageOf = async (uid, id) => as(uid, () => one(db.query("select * from public.messages where id = $1", [id])));
const preview = async (conv) => (await one(db.query("select last_message_preview from public.conversations where id = $1", [conv]))).last_message_preview;

// --- the bucket -------------------------------------------------------------------------------------------------
await expectOk("bucket: snaps is private, 50 MB, and takes exactly the types the apps send", async () => {
  const b = await one(db.query("select * from storage.buckets where id = $1", [SNAP_BUCKET]));
  if (!b || b.public !== false || Number(b.file_size_limit) !== SNAP_LIMITS.maxBytes) throw new Error("bucket: " + JSON.stringify(b));
  if ([...b.allowed_mime_types].sort().join() !== [...SNAP_MIME_TYPES].sort().join()) throw new Error("the apps and the bucket disagree: " + b.allowed_mime_types.join());
});

// --- storage policies -------------------------------------------------------------------------------------------
const first = path(A);
await expectOk("storage: Alice uploads a Snap into her own folder and reads it back; Bob and Carol cannot read it", async () => {
  await upload(A, first);
  if (!(await canRead(A, first))) throw new Error("the sender cannot read her own file");
  if ((await canRead(B, first)) || (await canRead(C, first))) throw new Error("someone else reads an unsent Snap");
  if ((await asAnon(() => rows(db.query("select name from storage.objects where bucket_id = 'snaps'")))).length) throw new Error("signed out sees Snap files");
});
await expectError("storage: nobody uploads into someone else's folder", () => upload(B, path(A)), "row-level security");
for (const [label, name] of [
  ["a name that is not 32 hex characters", `${A}/photo.jpg`],
  ["another type", `${A}/${newSnapToken()}.png`],
  ["a deeper folder", `${A}/x/${newSnapToken()}.jpg`],
  ["capital letters", `${A}/${newSnapToken().toUpperCase().replace(/[0-9]/g, "A")}.jpg`],
  ["no folder", `${newSnapToken()}.jpg`],
]) await expectError(`storage: ${label} is refused`, () => upload(A, name), "row-level security");
await expectError("storage: signed out cannot upload", () => asAnon(() => db.query("insert into storage.objects (bucket_id, name) values ('snaps',$1)", [path(A)])), "row-level security");
await expectOk("storage: no client deletes a Snap file, not even its sender", async () => {
  const gone = await as(A, () => rows(db.query("delete from storage.objects where bucket_id = 'snaps' and name = $1 returning name", [first])));
  if (gone.length || !(await canRead(A, first))) throw new Error("the sender deleted her Snap file");
});

// --- the tables stay private ----------------------------------------------------------------------------------
for (const table of ["snaps", "snap_recipients", "snap_purges"]) {
  await expectError(`tables: ${table} cannot be read from the API`, () => as(A, () => db.query(`select * from public.${table}`)), "permission denied");
}

// --- who a Snap can go to ---------------------------------------------------------------------------------------
await expectOk("Send To: Carol (our chat) first, then Bob (a friend); not Dave (follows one way), Erin (blocked), Frank (left our chat, still a friend) or Alice herself", async () => {
  const list = await as(A, () => rows(db.query("select * from public.list_snap_recipients()")));
  const ids = list.map((r) => r.id);
  if (ids[0] !== C) throw new Error("not chat-first: " + list.map((r) => r.full_name).join());
  const carol = list.find((r) => r.id === C), bob = list.find((r) => r.id === B), frank = list.find((r) => r.id === F);
  if (!carol || carol.is_friend || !carol.last_message_at) throw new Error("Carol: " + JSON.stringify(carol));
  if (!bob || !bob.is_friend || bob.last_message_at) throw new Error("Bob: " + JSON.stringify(bob));
  if (!frank || !frank.is_friend) throw new Error("Frank (a friend) is missing");
  for (const x of [A, D, E]) if (ids.includes(x)) throw new Error("offers someone it must not: " + x);
});
await expectOk("Send To: a search narrows by name, and % is a plain character", async () => {
  const bo = await as(A, () => rows(db.query("select full_name from public.list_snap_recipients('bo')")));
  if (bo.map((r) => r.full_name).join() !== "Bob") throw new Error(JSON.stringify(bo));
  if ((await as(A, () => rows(db.query("select * from public.list_snap_recipients('%')")))).length) throw new Error("% matched everyone");
});
await expectError("Send To: signed out cannot ask", () => asAnon(() => db.query("select * from public.list_snap_recipients()")), "permission denied");

// --- sending -------------------------------------------------------------------------------------------------------
await expectError("send: the file must be uploaded first", () => send(A, { path: path(A), to: [B] }), "Upload the Snap before sending it");
const bobsFile = path(B);
await upload(B, bobsFile);
await expectError("send: never someone else's file", () => send(A, { path: bobsFile, to: [C] }), "That is not a Snap file of yours");
await expectError("send: the kind must match the type", () => send(A, { path: first, kind: "video", mime: "image/jpeg", duration: 5, to: [B] }), "A Snap is a JPEG photo");
await expectError("send: the type must match the file's extension", () => send(A, { path: first, kind: "video", mime: "video/mp4", duration: 5, to: [B] }), "That is not a Snap file of yours");
const clip = path(A, "video/quicktime");
await upload(A, clip);
await expectError(`send: videos are up to ${SNAP_LIMITS.maxVideoSeconds} seconds`, () => send(A, { path: clip, kind: "video", mime: "video/quicktime", duration: 45, to: [B] }), "up to 30 seconds");
await expectError("send: nobody to send it to", () => send(A, { path: first, to: [] }), "Choose who to send it to");
await expectError("send: only herself is nobody", () => send(A, { path: first, to: [A] }), "Choose who to send it to");
await expectError(`send: at most ${SNAP_LIMITS.maxRecipients} people`, () => send(A, { path: first, to: Array.from({ length: 51 }, () => randomUUID()) }), "at most 50 people");
await expectError("send: not to someone who only follows her", () => send(A, { path: first, to: [B, D] }), "only to friends and people you chat with");
await expectError("send: not to someone blocked either way", () => send(A, { path: first, to: [E] }), "only to friends and people you chat with");
await expectError("send: not into a chat the other person left", () => send(A, { path: first, to: [F] }), "send Snaps to Frank right now");
await expectError("send: signed out cannot send", () => asAnon(() => db.query("select public.send_snap($1,'image','image/jpeg',1,1,null,$2::uuid[])", [first, [B]])), "permission denied");
await expectError("send: a message cannot carry a Snap straight from the API", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, snap) values ($1,$2,'',$3::jsonb)", [AC, A, JSON.stringify({ id: randomUUID(), kind: "image", expires_at: "2099-01-01T00:00:00Z", opened_at: null })])), "Snaps are sent with send_snap()");
await expectError("send: an empty message is still refused", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'')", [AC, A])), "messages_content_check");

let photo, AB;
await expectOk("send: one Snap to Bob (a chat is made) and Carol (their chat): one message each, no text, opened by nobody, expiring in 31 days", async () => {
  photo = await send(A, { path: first, to: [B, C, B] });
  if (!photo.snap_id || photo.sent.length !== 2) throw new Error(JSON.stringify(photo));
  AB = photo.sent.find((s) => s.recipient_id === B).conversation_id;
  if (photo.sent.find((s) => s.recipient_id === C).conversation_id !== AC) throw new Error("not Carol's chat with Alice");
  const members = await rows(db.query("select user_id from public.conversation_members where conversation_id = $1", [AB]));
  if (members.length !== 2) throw new Error("the new chat has " + members.length + " members");
  for (const s of photo.sent) {
    const m = await messageOf(s.recipient_id, s.message_id);
    const snap = snapOf(m.snap);
    if (!m || m.content !== "" || m.sender_id !== A || !snap || snap.id !== photo.snap_id || snap.kind !== "image" || snap.opened_at !== null) throw new Error("message: " + JSON.stringify(m));
    const days = (Date.parse(snap.expires_at) - Date.now()) / 86400000;
    if (days < 30.99 || days > 31.01) throw new Error("expires in " + days + " days");
  }
});
await expectOk("send: both inboxes read the shared preview, and each recipient gets a Snap notification", async () => {
  for (const conv of [AB, AC]) if ((await preview(conv)) !== SNAP_PREVIEW) throw new Error(conv + ": " + (await preview(conv)));
  for (const [uid, conv] of [[B, AB], [C, AC]]) {
    const n = await as(uid, () => one(db.query("select * from public.notifications where user_id = $1 and type = 'snap'", [uid])));
    if (!n || n.title !== "Alice" || n.body !== SNAP_NOTIFICATION_BODY || n.link !== `/messages/${conv}` || n.data.snap_id !== photo.snap_id) throw new Error("notification: " + JSON.stringify(n));
  }
});
await expectError("send: the same file goes out once", () => send(A, { path: first, to: [B] }), "This Snap was already sent");
await expectOk("send: the message keeps its Snap: a recipient cannot change it from the API", async () => {
  const changed = await as(B, () => rows(db.query("update public.messages set snap = snap || '{\"opened_at\": null}'::jsonb where id = $1 returning id", [photo.sent[0].message_id])));
  if (changed.length) throw new Error("the recipient rewrote the Snap");
});
await expectOk("send: a muted chat stays quiet", async () => {
  await as(C, () => db.query("insert into public.notification_mutes (user_id, scope, target_id) values ($1,'user',$2)", [C, A]));
  await db.query("update public.notifications set read_at = now() where user_id = $1", [C]);
  const quiet = path(A);
  await upload(A, quiet);
  await send(A, { path: quiet, to: [C] });
  const unread = await as(C, () => rows(db.query("select * from public.notifications where user_id = $1 and read_at is null", [C])));
  if (unread.length) throw new Error("muted, yet notified: " + JSON.stringify(unread));
  await as(C, () => db.query("delete from public.notification_mutes where user_id = $1", [C]));
});

// --- the one view ---------------------------------------------------------------------------------------------
await expectOk("view: before opening it, its recipients cannot read the file either", async () => {
  if ((await canRead(B, first)) || (await canRead(C, first))) throw new Error("a recipient reads an unopened Snap");
});
await expectError("view: someone it was not sent to cannot open it", () => open(D, photo.snap_id), SNAP_ERRORS.unavailable);
await expectError("view: nor its sender", () => open(A, photo.snap_id), SNAP_ERRORS.unavailable);
await expectError("view: signed out cannot open", () => asAnon(() => db.query("select public.open_snap($1)", [photo.snap_id])), "permission denied");
let opened;
await expectOk("view: Bob opens it: he gets the file and its sender, both chats show it opened, and only Bob can read it now", async () => {
  opened = await open(B, photo.snap_id);
  if (opened.path !== first || opened.kind !== "image" || opened.sender.full_name !== "Alice" || opened.message_id !== photo.sent.find((s) => s.recipient_id === B).message_id) throw new Error(JSON.stringify(opened));
  const seenByAlice = snapOf((await messageOf(A, opened.message_id)).snap);
  if (!seenByAlice?.opened_at) throw new Error("Alice does not see it opened");
  if (!(await canRead(B, first))) throw new Error("Bob cannot read what he opened");
  if (await canRead(C, first)) throw new Error("Carol reads it because Bob opened it");
});
await expectOk("view: opening again during the view (a retry) gives the same file", async () => {
  const again = await open(B, photo.snap_id);
  if (again.opened_at !== opened.opened_at || again.path !== first) throw new Error(JSON.stringify(again));
});
await expectOk("view: closing it ends the view: the file is out of Bob's reach", async () => {
  await close(B, photo.snap_id);
  if (await canRead(B, first)) throw new Error("still readable after closing");
});
await expectError("view: once closed it never opens again", () => open(B, photo.snap_id), SNAP_ERRORS.opened);
await expectOk("view: two minutes after opening, the file is out of reach even without closing", async () => {
  await open(C, photo.snap_id);
  if (!(await canRead(C, first))) throw new Error("Carol cannot read what she opened");
  await db.query("update public.snap_recipients set opened_at = now() - interval '3 minutes' where snap_id = $1 and recipient_id = $2", [photo.snap_id, C]);
  if (await canRead(C, first)) throw new Error("still readable after the view");
});
await expectError("view: and it does not open again", () => open(C, photo.snap_id), SNAP_ERRORS.opened);
const late = path(A);
let lateSnap;
await expectOk("view: an expired Snap no longer opens, and its file stays out of reach", async () => {
  await upload(A, late);
  lateSnap = await send(A, { path: late, to: [B] });
  // The Snap and its message carry the same expiry; both are moved back.
  await db.query("update public.snaps set expires_at = now() - interval '1 minute' where id = $1", [lateSnap.snap_id]);
  await db.query("update public.messages set snap = snap || jsonb_build_object('expires_at', now() - interval '1 minute') where id = $1", [lateSnap.sent[0].message_id]);
  let refused = "";
  try { await open(B, lateSnap.snap_id); } catch (e) { refused = e.message; }
  if (!refused.includes(SNAP_ERRORS.expired)) throw new Error("opened, or another error: " + refused);
  if (await canRead(B, late)) throw new Error("readable after it expired");
});
await expectOk("view: a video Snap opens with its length", async () => {
  const sent = await send(A, { path: clip, kind: "video", mime: "video/quicktime", duration: 12.46, width: 1080, height: 1920, to: [C] });
  const video = await open(C, sent.snap_id);
  if (video.kind !== "video" || Number(video.duration) !== 12.5 || video.mime !== "video/quicktime") throw new Error(JSON.stringify(video));
  await close(C, sent.snap_id);
});
let blockedPath;
await expectOk("view: blocking its sender makes a Snap unavailable", async () => {
  const blocked = path(A);
  blockedPath = blocked;
  await upload(A, blocked);
  const sent = await send(A, { path: blocked, to: [C] });
  await db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [C, A]);
  let refused = "";
  try { await open(C, sent.snap_id); } catch (e) { refused = e.message; }
  await db.query("delete from public.blocks where blocker_id = $1 and blocked_id = $2", [C, A]);
  if (!refused.includes(SNAP_ERRORS.unavailable)) throw new Error("opened, or another error: " + refused);
});

// --- previews ----------------------------------------------------------------------------------------------------
await expectOk("preview: a Snap reads 'Sent a Snap', words still win, and the four-argument form still answers as before", async () => {
  const snap = JSON.stringify({ id: randomUUID(), kind: "image", expires_at: "2099-01-01T00:00:00Z", opened_at: null });
  const p = await one(db.query("select public.message_preview('', null, '[]'::jsonb, $1::jsonb) as a, public.message_preview('hi', null, '[]'::jsonb, $1::jsonb) as b, public.message_preview('', null, '[{\"kind\":\"image\"}]'::jsonb, 140) as c, public.message_preview('hello', null, '[]'::jsonb) as d", [snap]));
  if (p.a !== SNAP_PREVIEW || p.b !== "hi" || p.c !== "Sent a photo" || p.d !== "hello") throw new Error(JSON.stringify(p));
});

// --- purging -------------------------------------------------------------------------------------------------------
// Supabase's storage.objects has created_at; the harness's stand-in does not.
await db.exec("alter table storage.objects add column if not exists created_at timestamptz not null default now()");
const purge = async (at) => (await one(db.query("select public.purge_snaps($1::timestamptz) as r", [at ?? new Date().toISOString()]))).r;
const queued = async () => (await rows(db.query("select path, attempts from public.snap_purges order by path"))).map((r) => r.path);
const snapRow = async (id) => one(db.query("select * from public.snaps where id = $1", [id]));
const unsentOld = path(A), unsentNew = path(A);

await expectOk("purge: without pg_net and Vault it still forgets what is over and queues the files, and says what is missing", async () => {
  await upload(A, unsentOld);
  await upload(A, unsentNew);
  await db.query("update storage.objects set created_at = now() - interval '2 hours' where name = $1", [unsentOld]);
  // Everyone the first Snap went to opened it (Bob and Carol), long enough ago.
  await db.query("update public.snap_recipients set opened_at = now() - interval '11 minutes' where snap_id = $1", [photo.snap_id]);
  const result = await purge();
  if (!result.includes("not set up")) throw new Error(result);
  if (await snapRow(photo.snap_id)) throw new Error("the opened Snap is still there");
  if (await snapRow(lateSnap.snap_id)) throw new Error("the expired Snap is still there");
  const q = await queued();
  for (const p of [first, late, unsentOld]) if (!q.includes(p)) throw new Error("not queued: " + p);
  if (q.includes(unsentNew)) throw new Error("a file uploaded a moment ago was queued");
  if (q.includes(blockedPath)) throw new Error("the file of a Snap still waiting was queued");
  if (!q.includes(clip)) throw new Error("the video Snap, closed by its only recipient, was not queued at once");
});
await expectOk("purge: the chats keep their marks (opened for Bob's, expired for the late one)", async () => {
  const bobs = snapOf((await messageOf(A, photo.sent.find((s) => s.recipient_id === B).message_id)).snap);
  if (!bobs?.opened_at) throw new Error("the opened mark is gone");
  const lateMessage = snapOf((await messageOf(B, lateSnap.sent[0].message_id)).snap);
  if (!lateMessage || lateMessage.opened_at || !lateMessage.gone || snapState(lateMessage) !== "expired") throw new Error("the expired mark: " + JSON.stringify(lateMessage));
});
await expectError("purge: a file waiting to be deleted cannot be sent any more", () => send(A, { path: unsentOld, to: [B] }), "took too long to send");

// Stand-ins for Supabase's Vault and pg_net: secrets in a plain table, and HTTP calls written down instead of made.
await db.exec(`create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid language sql as $$ insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;
  create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
  create schema net;
  create table net.calls (id bigserial primary key, method text, url text, headers jsonb);
  create function net.http_delete(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language sql as $$ insert into net.calls (method, url, headers) values ('DELETE', url, headers) returning id $$;`);
const calls = async () => rows(db.query("select url, headers from net.calls order by id"));

await expectError("purge: nobody in the API can set its credentials", () => as(A, () => db.query("select public.set_snap_purge_credentials('https://x', 'y')")), "permission denied");
await expectError("purge: nobody in the API can run it", () => as(A, () => db.query("select public.purge_snaps()")), "permission denied");
await expectOk("purge: its credentials go to Vault, and setting them again updates them", async () => {
  await db.query("select public.set_snap_purge_credentials('https://example.supabase.co/', 'first-key')");
  await db.query("select public.set_snap_purge_credentials('https://example.supabase.co/', 'service-key')");
  const s = await rows(db.query("select name, secret from vault.secrets order by name"));
  if (s.length !== 2 || s.find((x) => x.name === "snaps_service_key")?.secret !== "service-key") throw new Error(JSON.stringify(s));
});
await expectOk("purge: asks Storage to delete each queued file once, with the service key", async () => {
  await purge();
  const c = await calls();
  const q = await queued();
  if (c.length !== q.length) throw new Error(`${c.length} calls for ${q.length} files`);
  for (const p of q) {
    const call = c.find((x) => x.url === `https://example.supabase.co/storage/v1/object/snaps/${p}`);
    if (!call || call.headers.Authorization !== "Bearer service-key" || call.headers.apikey !== "service-key") throw new Error("no proper call for " + p + ": " + JSON.stringify(c));
  }
});
await expectOk("purge: does not ask again within 30 minutes, and does after", async () => {
  const asked = (await calls()).map((c) => c.url);
  await purge();
  if ((await calls()).length !== asked.length) throw new Error("asked again too soon");
  await purge(new Date(Date.now() + 31 * 60 * 1000).toISOString());
  const now = (await calls()).map((c) => c.url);
  for (const url of asked) if (now.filter((u) => u === url).length !== 2) throw new Error("not asked again: " + url);
});
await expectOk("purge: files Storage deleted are checked off", async () => {
  // What the Storage API does with each DELETE.
  await db.query("delete from storage.objects where bucket_id = 'snaps' and name = any($1::text[])", [await queued()]);
  await purge();
  if ((await queued()).length) throw new Error("still queued: " + (await queued()).join());
});
await expectOk("purge: a sender's account going takes their Snaps with it; the files follow an hour on", async () => {
  const waiting = await rows(db.query("select s.id, s.media_path, r.message_id from public.snaps s join public.snap_recipients r on r.snap_id = s.id where s.sender_id = $1 and r.opened_at is null", [A]));
  if (!waiting.length) throw new Error("no Snap left to test with");
  await db.query("delete from auth.users where id = $1", [A]);
  if ((await rows(db.query("select id from public.snaps where sender_id = $1", [A]))).length) throw new Error("the Snaps outlived their sender");
  for (const s of waiting) {
    const left = snapOf((await messageOf(C, s.message_id)).snap);
    if (!left || snapState(left) !== "unavailable") throw new Error("the recipient's chat still offers it: " + JSON.stringify(left));
  }
  await db.query("update storage.objects set created_at = now() - interval '2 hours' where bucket_id = 'snaps'");
  // With one of Supabase's new secret keys, which goes only in the apikey header.
  await db.query("select public.set_snap_purge_credentials('https://example.supabase.co', 'sb_secret_test')");
  const before = (await calls()).length;
  await purge();
  const q = await queued();
  for (const s of waiting) if (!q.includes(s.media_path)) throw new Error("not queued: " + s.media_path);
  const fresh = (await calls()).slice(before);
  if (!fresh.length || fresh.some((c) => c.headers.apikey !== "sb_secret_test" || "Authorization" in c.headers)) throw new Error("new-style key headers: " + JSON.stringify(fresh));
});

await expectOk("close: the last recipient closing a Snap deletes its file at once (queued, and asked of Storage), keeping the chats' marks", async () => {
  // Alice is gone; Bob and Carol become friends, Bob sends Carol a Snap and Carol views it.
  for (const [x, y] of [[B, C], [C, B]]) await follow(x, y);
  const p = path(B);
  await upload(B, p);
  const sent = await send(B, { path: p, to: [C] });
  await open(C, sent.snap_id);
  const before = (await calls()).length;
  await close(C, sent.snap_id);
  if (await snapRow(sent.snap_id)) throw new Error("the Snap's row stayed");
  if (!(await queued()).includes(p)) throw new Error("the file was not queued");
  const fresh = (await calls()).slice(before);
  if (fresh.length !== 1 || !fresh[0].url.endsWith("/storage/v1/object/snaps/" + p)) throw new Error("no deletion asked for: " + JSON.stringify(fresh));
  const mark = snapOf((await messageOf(C, sent.sent[0].message_id)).snap);
  if (!mark?.opened_at || mark.gone) throw new Error("the chat's mark: " + JSON.stringify(mark));
});
await expectOk("close: with two recipients the file waits for the second one", async () => {
  const p = path(B);
  await upload(B, p);
  const D2 = await mk("d2@txstate.edu", "Dana");
  for (const [x, y] of [[B, D2], [D2, B]]) await follow(x, y);
  const sent = await send(B, { path: p, to: [C, D2] });
  await open(C, sent.snap_id);
  await close(C, sent.snap_id);
  if (!(await snapRow(sent.snap_id))) throw new Error("gone before Dana opened it");
  if ((await queued()).includes(p)) throw new Error("queued before Dana opened it");
  await open(D2, sent.snap_id);
  await close(D2, sent.snap_id);
  if (await snapRow(sent.snap_id)) throw new Error("the Snap's row stayed after the last close");
  if (!(await queued()).includes(p)) throw new Error("the file was not queued after the last close");
});
await expectOk("the Snaps migration re-runs cleanly with data in place", async () => { await db.exec(read(MIGRATION)); await db.exec(read(PREVIEWS)); await db.exec(read(CLOSE)); });
done("MIGRATION-28 SNAPS");
