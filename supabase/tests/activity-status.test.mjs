// Migration 22 (activity status) against PGlite: exact last-active times in a table the API cannot touch, heartbeats
// that stamp only people who show their status and never touch profiles (not even a lock), activity_status() and its
// rules one by one, profiles' and notifications' system columns closed to the API, showing your status again only on
// purpose, "Delivered" while hiding, "Seen" only for something new, messages never dated ahead (a planted one kept
// receipts moving), what chat members may change, scheduled
// notifications out of reach, the end of the public last_seen_at, the block list for presence, and the realtime
// presence policies against a stand-in realtime schema.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const MIGRATION = "migrations/20261011000000_activity_status.sql";
const { db, mk, as, asAnon, asService } = await boot();
// Buzz v2 (migration 30): writes come from the website's write API (service role), after the Buzz guidelines are accepted.
const buzzPost = async (uid, title) => {
  await as(uid, () => db.query("select public.buzz_v2_accept_gate('2026-10-21')"));
  return (await asService(() => one(db.query("select public.buzz_v2_create($1, $2::jsonb) as r", [uid, JSON.stringify({ title, scope: "global" })])))).r.id;
};
const buzzReply = async (uid, thread, text) => {
  await as(uid, () => db.query("select public.buzz_v2_accept_gate('2026-10-21')"));
  await asService(() => db.query("select public.buzz_v2_reply($1, $2, $3::jsonb)", [uid, thread, JSON.stringify({ text })]));
};
await expectOk("the activity-status migration re-runs cleanly, twice, without a realtime schema", async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read(MIGRATION));
});

const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const names = {};
const user = async (name, email) => { const id = await mk(email, name); names[id] = name; return id; };
// Vera asks about everyone. She chats with Omar, Hana, Kai, Lee and Dee one to one, and with Gia in a group; each of
// them has written to her there. Sam chats only with Omar. Max has an empty chat with Vera; in her chat with Ned only
// Vera has written. Mal put Vera, Omar and Gia in a group nobody has written in. Hana hides her status, Vera blocks Kai,
// and Lee blocks Vera.
const V = await user("Vera", "vera@txstate.edu"), O = await user("Omar", "omar@txstate.edu"), G = await user("Gia", "gia@txstate.edu");
const H = await user("Hana", "hana@txstate.edu"), K = await user("Kai", "kai@txstate.edu"), L = await user("Lee", "lee@txstate.edu");
const S = await user("Sam", "sam@txstate.edu"), D = await user("Dee", "dee@txstate.edu"), X = await user("Max", "max@txstate.edu");
const N = await user("Ned", "ned@txstate.edu"), M = await user("Mal", "mal@txstate.edu");
const direct = async (me, other) => (await as(me, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [other])))).id;
const say = (from, chat, text = "hi") => as(from, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3)", [chat, from, text]));
const chats = {};
for (const other of [O, H, K, L, D, X, N]) chats[other] = await direct(V, other);
for (const other of [O, H, K, L, D]) await say(other, chats[other]);
await say(V, chats[O]);
await say(V, chats[N]);
chats.samOmar = await direct(S, O);
await say(S, chats.samOmar);
await say(O, chats.samOmar);
const GROUP = (await as(V, () => one(db.query("select public.create_group_conversation('Study group', $1::uuid[]) as id", [[G]])))).id;
await say(G, GROUP, "notes are up");
await say(V, GROUP, "thanks");
const MASS = (await as(M, () => one(db.query("select public.create_group_conversation('hey all', $1::uuid[]) as id", [[V, O, G]])))).id;
const block = (blocker, blocked) => as(blocker, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [blocker, blocked]));
const unblock = (blocker, blocked) => as(blocker, () => db.query("delete from public.blocks where blocker_id=$1 and blocked_id=$2", [blocker, blocked]));
await block(V, K);
await block(L, V);

// The apps' switch (a plain update can no longer turn it on: see "showing your status again").
const setShown = (uid, shown) => as(uid, () => db.query("select public.set_show_active_status($1)", [shown]));
await setShown(H, false);
const touch = async (uid) => (await as(uid, () => one(db.query("select public.touch_activity() as shown")))).shown;
const touchPresence = (uid) => as(uid, () => db.query("select public.touch_presence()"));
// Read and written as the table owner, past the grants, the way only the database's own functions can.
const activityOf = async (uid) => (await one(db.query("select last_active_at from public.user_activity where user_id = $1", [uid])))?.last_active_at ?? null;
const stamp = (uid, at) => db.query("insert into public.user_activity (user_id, last_active_at) values ($1, $2) on conflict (user_id) do update set last_active_at = excluded.last_active_at", [uid, at]);
const profileOf = (uid) => one(db.query("select last_seen_at, updated_at, show_active_status from public.profiles where id = $1", [uid]));
const xmaxOf = async (uid) => (await one(db.query("select xmax::text as x from public.profiles where id = $1", [uid]))).x;
const status = async (viewer, ids) => Object.fromEntries((await as(viewer, () => rows(db.query("select user_id, last_active_at from public.activity_status($1::uuid[])", [ids])))).map((r) => [r.user_id, r.last_active_at?.toISOString() ?? null]));
const recentOf = async (viewer, id) => (await as(viewer, () => one(db.query("select recent from public.activity_status(array[$1]::uuid[])", [id]))))?.recent;
const list = (o) => Object.keys(o).map((id) => names[id] ?? id).sort().join(", ") || "nobody";
const can = async (role, fn) => (await one(db.query("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))).ok;
const secondsAgo = (s) => new Date(Date.now() - s * 1000);
const randomIds = (n) => Array.from({ length: n }, () => crypto.randomUUID());
const fnSource = async (name) => (await one(db.query("select prosrc from pg_proc where oid = $1::regprocedure", [name]))).prosrc;
// PGlite's clock moves in whole milliseconds (back-to-back statements often share now()): where a check needs one write
// strictly after another, wait a little between them.
const tick = () => new Promise((r) => setTimeout(r, 5));

// --- the table ---------------------------------------------------------------------------------------------------
for (const uid of [V, O, G, K, L, S, D, X, N, M]) await touch(uid);
for (const [who, run] of [["signed in", (fn) => as(V, fn)], ["signed out", asAnon]]) {
  await expectError(`user_activity: ${who}, the API cannot read it`, () => run(() => db.query("select * from public.user_activity")), "permission denied");
  await expectError(`user_activity: ${who}, the API cannot add a row`, () => run(() => db.query("insert into public.user_activity (user_id, last_active_at) values ($1, now())", [V])), "permission denied");
  await expectError(`user_activity: ${who}, the API cannot change a row`, () => run(() => db.query("update public.user_activity set last_active_at = now() - interval '1 day' where user_id = $1", [V])), "permission denied");
  await expectError(`user_activity: ${who}, the API cannot delete a row`, () => run(() => db.query("delete from public.user_activity where user_id = $1", [V])), "permission denied");
}
await expectOk("user_activity: no grants and no policies for the API roles, row-level security on; its key points at auth.users, not profiles", async () => {
  for (const role of ["anon", "authenticated"]) for (const p of ["select", "insert", "update", "delete"]) {
    if ((await one(db.query("select has_table_privilege($1, 'public.user_activity', $2) as ok", [role, p]))).ok) throw new Error(`${role} has ${p}`);
  }
  const t = await one(db.query("select relrowsecurity as rls, (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'user_activity') as policies from pg_class where oid = 'public.user_activity'::regclass"));
  if (!t.rls || t.policies !== 0) throw new Error(JSON.stringify(t));
  const fks = await rows(db.query("select confrelid::regclass::text as target, confdeltype as on_delete from pg_constraint where conrelid = 'public.user_activity'::regclass and contype = 'f'"));
  if (JSON.stringify(fks) !== JSON.stringify([{ target: "auth.users", on_delete: "c" }])) throw new Error(JSON.stringify(fks));
});

// --- heartbeats ----------------------------------------------------------------------------------------------------
await expectOk("touch_activity: stamps the caller's own time and says they show their status; profiles is not touched at all", async () => {
  await db.query("delete from public.user_activity where user_id = $1", [V]);
  const before = await profileOf(V);
  if ((await touch(V)) !== true) throw new Error("did not say Vera shows her status");
  const at = await activityOf(V);
  if (!at || Math.abs(at - Date.now()) > 60000) throw new Error("time: " + at);
  const after = await profileOf(V);
  if (after.last_seen_at !== null || +after.updated_at !== +before.updated_at) throw new Error("profiles changed: " + JSON.stringify(after));
});
await expectOk("touch_activity: keeps a stamp under 20 seconds old (fewer writes), replaces an older one, never goes back", async () => {
  const recent = secondsAgo(10);
  await stamp(V, recent);
  await touch(V);
  if (+(await activityOf(V)) !== +recent) throw new Error("a 10-second-old stamp was replaced");
  await stamp(V, secondsAgo(30));
  await touch(V);
  if (Date.now() - (await activityOf(V)) > 15000) throw new Error("a 30-second-old stamp was kept");
  const ahead = new Date(Date.now() + 3600000);
  await stamp(V, ahead);
  await touch(V);
  if (+(await activityOf(V)) !== +ahead) throw new Error("the time went back");
  await stamp(V, secondsAgo(60));
});
await expectOk("touch_activity: nothing for someone hiding their status, and it says so", async () => {
  if ((await touch(H)) !== false) throw new Error("said Hana shows her status");
  if ((await activityOf(H)) !== null) throw new Error("stamped Hana");
});
await expectOk("touch_presence (old builds' heartbeat): stamps the same table, only for people who show their status, and writes nothing public", async () => {
  await db.query("delete from public.user_activity where user_id = $1", [O]);
  const before = await profileOf(O);
  await touchPresence(O);
  if (!(await activityOf(O))) throw new Error("did not stamp Omar");
  const after = await profileOf(O);
  if (after.last_seen_at !== null || +after.updated_at !== +before.updated_at) throw new Error("profiles changed: " + JSON.stringify(after));
  await touchPresence(H);
  if ((await activityOf(H)) !== null) throw new Error("stamped Hana");
});
await expectOk("heartbeats leave no trace on the profile row, not even a lock: xmax stays put through a first stamp, a new one, a kept one and touch_presence", async () => {
  await db.query("delete from public.user_activity where user_id = $1", [S]);
  const before = await xmaxOf(S);
  await touch(S);
  await stamp(S, secondsAgo(60));
  await touch(S);
  await touch(S);
  await touchPresence(S);
  const after = await xmaxOf(S);
  if (after !== before) throw new Error(`Sam's profile xmax moved ${before} -> ${after}`);
});
await expectOk("heartbeat and hide take the same per-user advisory lock, and neither locks the profile row", async () => {
  for (const fn of ["public.touch_activity()", "public.forget_activity_when_hidden()"]) {
    const src = (await fnSource(fn)).toLowerCase();
    if (!src.includes("pg_advisory_xact_lock(hashtextextended('user_activity:'")) throw new Error(`${fn} takes no advisory lock`);
    if (/for\s+(share|update|key\s+share|no\s+key\s+update)/.test(src)) throw new Error(`${fn} locks rows`);
  }
});
await expectError("heartbeats: the API refuses touch_activity signed out", () => asAnon(() => db.query("select public.touch_activity()")), "permission denied");
await expectError("heartbeats: and touch_presence", () => asAnon(() => db.query("select public.touch_presence()")), "permission denied");
await expectOk("heartbeats: signed in may call both; both run as the definer, the only way to the table", async () => {
  for (const fn of ["public.touch_activity()", "public.touch_presence()"]) {
    if (!(await can("authenticated", fn)) || (await can("anon", fn))) throw new Error(fn);
  }
  const definer = (await rows(db.query("select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('touch_activity', 'touch_presence', 'activity_status')"))).filter((r) => r.prosecdef);
  if (definer.length !== 3) throw new Error(JSON.stringify(definer));
});

// --- profiles: system columns ----------------------------------------------------------------------------------------
for (const [who, run] of [["signed out", asAnon], ["signed in", (fn) => as(V, fn)]]) {
  await expectError(`profiles: ${who}, the API cannot read xmax`, () => run(() => db.query("select id, xmax from public.profiles limit 1")), "permission denied");
  await expectError(`profiles: ${who}, nor xmin`, () => run(() => db.query("select id, xmin from public.profiles limit 1")), "permission denied");
  await expectError(`profiles: ${who}, nor filter on xmax`, () => run(() => db.query("select id from public.profiles where xmax = '1'::xid")), "permission denied");
  await expectError(`profiles: ${who}, nor ctid`, () => run(() => db.query("select ctid from public.profiles limit 1")), "permission denied");
}
await expectOk("profiles: every user column is still readable signed in and out (select *, counts, whole rows, embedded senders); system columns are the only ones closed", async () => {
  const cols = (await rows(db.query("select attname from pg_attribute where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped"))).map((r) => r.attname);
  for (const role of ["anon", "authenticated"]) for (const c of cols) {
    if (!(await one(db.query("select has_column_privilege($1, 'public.profiles', $2, 'select') as ok", [role, c]))).ok) throw new Error(`${role} cannot read ${c}`);
  }
  for (const run of [asAnon, (fn) => as(O, fn)]) {
    const all = await run(() => rows(db.query("select * from public.profiles where id = $1", [V])));
    if (all.length !== 1 || all[0].full_name !== "Vera" || !("show_active_status" in all[0])) throw new Error(JSON.stringify(all));
    if ((await run(() => one(db.query("select count(*)::int as n from public.profiles")))).n < 11) throw new Error("count");
    if (!(await run(() => one(db.query("select p as row from public.profiles p where p.id = $1", [V])))).row) throw new Error("whole row");
  }
  const embedded = await as(O, () => rows(db.query("select m.content, s.full_name from public.messages m join public.profiles s on s.id = m.sender_id where m.conversation_id = $1", [chats[O]])));
  if (embedded.length !== 2) throw new Error("messages with their senders: " + JSON.stringify(embedded));
  const saved = await as(V, () => one(db.query("update public.profiles set bio = 'still me' where id = $1 returning *", [V])));
  if (saved.bio !== "still me") throw new Error("update returning *");
});
await expectOk("profiles: an anonymous Buzz reply leaves the replier's profile xmax at the reply's id (the owner sees it), but the thread author cannot match the notification to it any more", async () => {
  await db.query("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0 where id = 1");
  const post = await buzzPost(O, "Anyone else stressed?");
  await buzzReply(H, post, "same here");
  // (Buzz notifications are dated to the minute, so pick the reply's by its type rather than by the latest time.)
  const xid = (await one(db.query("select xmin::text as x from public.notifications where user_id = $1 and type = 'buzz_reply' order by created_at desc limit 1", [O]))).x;
  // (The notification's own key locks the author's row too: the author knows that one.)
  const owner = await rows(db.query("select id from public.profiles where xmax = $1::xid and id <> $2", [xid, O]));
  if (owner.length !== 1 || owner[0].id !== H) throw new Error("setup: the trail is not there to hide: " + JSON.stringify(owner));
  let refused = 0;
  for (const run of [asAnon, (fn) => as(O, fn)]) {
    try { await run(() => db.query("select full_name from public.profiles where xmax = $1::xid and id <> $2", [xid, O])); } catch (e) { if (e.message.includes("permission denied")) refused++; else throw e; }
  }
  if (refused !== 2) throw new Error("the match went through");
});
await expectOk("notifications: every column is still readable by its owner (select *, counts, filters), signed out still sees none (no error), and xmin, which dated a scheduled notification's write, is closed", async () => {
  const cols = (await rows(db.query("select attname from pg_attribute where attrelid = 'public.notifications'::regclass and attnum > 0 and not attisdropped"))).map((r) => r.attname);
  for (const role of ["anon", "authenticated"]) for (const c of cols) {
    if (!(await one(db.query("select has_column_privilege($1, 'public.notifications', $2, 'select') as ok", [role, c]))).ok) throw new Error(`${role} cannot read ${c}`);
  }
  const mine = await as(O, () => rows(db.query("select * from public.notifications")));
  if (!mine.length || !("visible_at" in mine[0])) throw new Error("Omar's notifications: " + JSON.stringify(mine));
  if ((await as(O, () => one(db.query("select count(*)::int as n from public.notifications")))).n !== mine.length) throw new Error("count");
  if ((await asAnon(() => rows(db.query("select * from public.notifications")))).length !== 0) throw new Error("signed out sees notifications");
  for (const [who, run] of [["signed in", (fn) => as(O, fn)], ["signed out", asAnon]]) {
    for (const sql of ["select xmin from public.notifications", "select id from public.notifications where xmin = '1'::xid", "select xmax from public.notifications"]) {
      let refused = false;
      try { await run(() => db.query(sql)); } catch (e) { if (e.message.includes("permission denied")) refused = true; else throw e; }
      if (!refused) throw new Error(`${who}: ${sql}`);
    }
  }
});
await expectOk("profiles and notifications: the grant names the columns each table has when the migration runs, so a column made outside these migrations keeps select * working; the system columns stay closed", async () => {
  await db.exec("alter table public.profiles add column extra_note text; alter table public.notifications add column extra_note text");
  try {
    await db.exec(read(MIGRATION));
    for (const run of [asAnon, (fn) => as(O, fn)]) {
      const all = await run(() => rows(db.query("select * from public.profiles where id = $1", [V])));
      if (all.length !== 1 || !("extra_note" in all[0])) throw new Error("profiles select *: " + JSON.stringify(all));
      let refused = false;
      try { await run(() => db.query("select xmax from public.profiles limit 1")); } catch (e) { if (e.message.includes("permission denied")) refused = true; else throw e; }
      if (!refused) throw new Error("xmax opened again");
    }
    const n = await as(O, () => rows(db.query("select * from public.notifications")));
    if (!n.length || !("extra_note" in n[0])) throw new Error("notifications select *");
  } finally {
    await db.exec("alter table public.profiles drop column extra_note; alter table public.notifications drop column extra_note");
    await db.exec(read(MIGRATION));
  }
  if ((await asAnon(() => rows(db.query("select * from public.profiles where id = $1", [V])))).length !== 1) throw new Error("after dropping the column again");
});

// --- profiles.last_seen_at -----------------------------------------------------------------------------------------
await expectOk("last_seen_at: the migration empties values written before it; afterwards nobody fills it, not its owner through the API either", async () => {
  // Values the old touch_presence wrote, put back past migration 9's trigger.
  await db.exec("alter table public.profiles disable trigger clear_last_seen_when_hidden");
  await db.query("update public.profiles set last_seen_at = to_timestamp(floor(extract(epoch from now()) / 600) * 600) where id = any($1::uuid[])", [[V, O, S]]);
  await db.exec("alter table public.profiles enable trigger clear_last_seen_when_hidden");
  if ((await one(db.query("select count(last_seen_at)::int as n from public.profiles"))).n !== 3) throw new Error("setup");
  await db.exec(read(MIGRATION));
  if ((await one(db.query("select count(last_seen_at)::int as n from public.profiles"))).n !== 0) throw new Error("values survived the migration");
  const r = await as(V, () => db.query("update public.profiles set last_seen_at = now() where id = $1", [V]));
  if (r.affectedRows !== 1 || (await profileOf(V)).last_seen_at !== null) throw new Error("Vera wrote her last_seen_at");
  await db.query("update public.profiles set last_seen_at = now() where id = $1", [O]);
  if ((await profileOf(O)).last_seen_at !== null) throw new Error("written as the owner");
});

// --- hiding --------------------------------------------------------------------------------------------------------
await expectOk("hiding your status deletes your time; heartbeats then write nothing; showing it again waits for the next heartbeat", async () => {
  if (!(await activityOf(D))) throw new Error("setup");
  await setShown(D, false);
  if ((await activityOf(D)) !== null) throw new Error("the time survived hiding");
  if ((await touch(D)) !== false || (await activityOf(D)) !== null) throw new Error("a heartbeat wrote while hidden");
  await as(D, () => db.query("update public.profiles set bio = 'hi' where id = $1", [D]));
  await setShown(D, true);
  if ((await activityOf(D)) !== null) throw new Error("showing it again brought an old time back");
  if ((await touch(D)) !== true || !(await activityOf(D))) throw new Error("the next heartbeat did not stamp");
});
await expectOk("showing your status again: a plain update (an installed old build's stale Settings save) cannot turn it back on, though the rest of that save is kept; set_show_active_status() can, and its choice lasts only for that call; hiding works either way", async () => {
  await setShown(D, false);
  await as(D, () => db.query("update public.profiles set show_active_status = true, bio = 'saved from an old build' where id = $1", [D]));
  const p = await one(db.query("select show_active_status, bio from public.profiles where id = $1", [D]));
  if (p.show_active_status !== false || p.bio !== "saved from an old build") throw new Error("the stale save: " + JSON.stringify(p));
  if ((await touch(D)) !== false || (await activityOf(D)) !== null) throw new Error("the stale save brought her heartbeat back");
  await setShown(D, true);
  if ((await profileOf(D)).show_active_status !== true || (await touch(D)) !== true) throw new Error("set_show_active_status(true) did not show it");
  await as(D, () => db.query("update public.profiles set show_active_status = false where id = $1", [D]));
  if ((await profileOf(D)).show_active_status !== false) throw new Error("a plain update could not hide it");
  await as(D, () => db.query("update public.profiles set show_active_status = true where id = $1", [D]));
  if ((await profileOf(D)).show_active_status !== false) throw new Error("the earlier choice reached a later plain update");
  // The database's owner (the dashboard, the service role) is not held to it.
  await db.query("update public.profiles set show_active_status = true where id = $1", [D]);
  if ((await profileOf(D)).show_active_status !== true) throw new Error("the owner could not show it");
  await touch(D);
  // Only your own profile, and only signed in.
  await as(V, () => db.query("select public.set_show_active_status(false)"));
  if ((await profileOf(V)).show_active_status !== false || (await profileOf(D)).show_active_status !== true) throw new Error("someone else's profile changed");
  await setShown(V, true);
  await touch(V);
  if (!(await can("authenticated", "public.set_show_active_status(boolean)")) || (await can("anon", "public.set_show_active_status(boolean)"))) throw new Error("grants");
  if (await can("authenticated", "public.keep_active_status_hidden()")) throw new Error("the trigger function is callable");
});
await expectError("showing your status again: the API refuses set_show_active_status signed out", () => asAnon(() => db.query("select public.set_show_active_status(true)")), "permission denied");
await expectOk("hiding: someone else's update cannot touch your time, and other profile edits leave it alone", async () => {
  const before = await activityOf(O);
  await as(V, () => db.query("update public.profiles set show_active_status = false where id = $1", [O]));
  await as(O, () => db.query("update public.profiles set bio = 'still here' where id = $1", [O]));
  if (+(await activityOf(O)) !== +before || (await profileOf(O)).show_active_status !== true) throw new Error("Omar's time changed");
});

// --- "Delivered" ---------------------------------------------------------------------------------------------------
const deliveredOf = async (uid, chat) => (await one(db.query("select last_delivered_at, last_read_at from public.conversation_members where user_id = $1 and conversation_id = $2", [uid, chat])));
const backdate = (uid, chat) => db.query("update public.conversation_members set last_delivered_at = now() - interval '1 hour', last_read_at = now() - interval '1 hour' where user_id = $1 and conversation_id = $2", [uid, chat]);
await expectOk("mark_delivered_all: marks a new message delivered for someone who shows their status, as before", async () => {
  await backdate(O, chats[O]);
  await say(V, chats[O], "are you there?");
  const before = await deliveredOf(O, chats[O]);
  await as(O, () => db.query("select public.mark_delivered_all()"));
  const after = await deliveredOf(O, chats[O]);
  if (!(after.last_delivered_at > before.last_delivered_at)) throw new Error("not marked delivered");
});
await expectOk("mark_delivered_all: does nothing while you hide your status (no 'Delivered' from your app opening); reading the chat still shows 'Seen'", async () => {
  await setShown(O, false);
  await backdate(O, chats[O]);
  await say(V, chats[O], "hello?");
  const before = await deliveredOf(O, chats[O]);
  await as(O, () => db.query("select public.mark_delivered_all()"));
  if (+(await deliveredOf(O, chats[O])).last_delivered_at !== +before.last_delivered_at) throw new Error("hidden Omar's app marked it delivered");
  await as(O, () => db.query("select public.mark_conversation_read($1)", [chats[O]]));
  const read_ = await deliveredOf(O, chats[O]);
  if (!(read_.last_read_at > before.last_read_at) || !(read_.last_delivered_at > before.last_delivered_at)) throw new Error("reading did not mark it seen");
  await setShown(O, true);
  await touch(O);
});
// --- "Seen" ----------------------------------------------------------------------------------------------------------
const receiptRow = (uid, chat) => one(db.query("select last_read_at, last_delivered_at, xmin::text as x from public.conversation_members where user_id = $1 and conversation_id = $2", [uid, chat]));
await expectOk("mark_conversation_read: with nothing new from anyone else it changes nothing, shown or hidden (opening a chat no longer tells its members when you had the app open); your own messages are not something to read", async () => {
  await say(V, chats[O], "new for Omar");
  await as(O, () => db.query("select public.mark_conversation_read($1)", [chats[O]]));
  for (const shown of [true, false]) {
    await setShown(O, shown);
    const before = await receiptRow(O, chats[O]);
    await as(O, () => db.query("select public.mark_conversation_read($1)", [chats[O]]));
    const after = await receiptRow(O, chats[O]);
    if (after.x !== before.x || +after.last_read_at !== +before.last_read_at || +after.last_delivered_at !== +before.last_delivered_at) throw new Error(`shown=${shown}: the row moved with nothing to read`);
  }
  await setShown(O, true);
  await touch(O);
  await tick();
  await say(O, chats[O], "Omar's own message");
  // Even with his read marker put back behind it (the apps never leave it there: sending moves it), his own message is
  // not something for him to read.
  await db.query("update public.conversation_members set last_read_at = (select max(created_at) from public.messages where conversation_id = $1 and sender_id is distinct from $2) where conversation_id = $1 and user_id = $2", [chats[O], O]);
  const own = await receiptRow(O, chats[O]);
  await as(O, () => db.query("select public.mark_conversation_read($1)", [chats[O]]));
  if ((await receiptRow(O, chats[O])).x !== own.x) throw new Error("his own message counted as something to read");
});
await expectOk("mark_conversation_read: something new from someone else moves 'Seen' (and 'Delivered') as before, and the chat is no longer unread", async () => {
  const before = await receiptRow(O, chats[O]);
  await tick();
  await say(V, chats[O], "and another one");
  if (!(await as(O, () => rows(db.query("select * from public.get_unread_counts()")))).some((u) => u.conversation_id === chats[O])) throw new Error("setup: not unread");
  await as(O, () => db.query("select public.mark_conversation_read($1)", [chats[O]]));
  const after = await receiptRow(O, chats[O]);
  if (!(after.last_read_at > before.last_read_at) || !(after.last_delivered_at > before.last_delivered_at)) throw new Error("not marked seen");
  if ((await as(O, () => rows(db.query("select * from public.get_unread_counts()")))).some((u) => u.conversation_id === chats[O])) throw new Error("still unread");
  // A message from an account deleted since (no sender) counts as something to read, as in the unread counts.
  await tick();
  await db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, null, 'from a deleted account')", [chats[O]]);
  await as(O, () => db.query("select public.mark_conversation_read($1)", [chats[O]]));
  if (!((await receiptRow(O, chats[O])).last_read_at > after.last_read_at)) throw new Error("a message with no sender was not read");
});

// --- messages dated ahead ------------------------------------------------------------------------------------------
// The insert used to keep whatever created_at it carried. A message dated ahead stayed newer than the other member's
// receipts until that date, so each time they opened the chat ("Seen") or their app woke ("Delivered") the receipt moved
// to now() again, live to the sender, even while they hid their status or after a block; and the chat stayed unread.
const I = await user("Ivy", "ivy@txstate.edu"), Mo = await user("Moe", "moe@txstate.edu"), U = await user("Uma", "uma@txstate.edu");
const ahead = await direct(Mo, I);
const sendAhead = (interval) => as(Mo, () => one(db.query(`insert into public.messages (conversation_id, sender_id, content, created_at) values ($1, $2, 'from the future', now() + interval '${interval}') returning created_at, now() as sent_at`, [ahead, Mo])));
const seenBy = async (uid, chat) => +(await as(Mo, () => one(db.query("select last_read_at from public.conversation_members where conversation_id = $1 and user_id = $2", [chat, uid])))).last_read_at;
const unreadIn = async (uid, chat) => (await as(uid, () => rows(db.query("select * from public.get_unread_counts()")))).some((u) => u.conversation_id === chat);
await expectOk("messages: one sent dated ahead is dated when it was sent, and so is its chat's last message; an earlier date is kept as sent; the trigger function cannot be called", async () => {
  const m = await sendAhead("1 year");
  if (+m.created_at !== +m.sent_at) throw new Error(`dated ${m.created_at.toISOString()}, sent ${m.sent_at.toISOString()}`);
  const chat = await one(db.query("select last_message_at from public.conversations where id = $1", [ahead]));
  if (+chat.last_message_at !== +m.sent_at) throw new Error("the chat's last message is dated " + chat.last_message_at.toISOString());
  const umaMoe = await direct(U, Mo);
  const earlier = await as(U, () => one(db.query("insert into public.messages (conversation_id, sender_id, content, created_at) values ($1, $2, 'imported', '2026-01-02T03:04:05Z') returning created_at", [umaMoe, U])));
  if (earlier.created_at.toISOString() !== "2026-01-02T03:04:05.000Z") throw new Error("an earlier date was changed: " + earlier.created_at.toISOString());
  if (await can("authenticated", "public.clamp_message_created_at()")) throw new Error("the trigger function is callable");
});
await expectOk("mark_conversation_read: after a message dated ahead, opening the chat moves 'Seen' once, then never again (Moe cannot clock Ivy, who hides her status), and nothing stays unread", async () => {
  await setShown(I, false);
  await backdate(I, ahead);
  const before = await seenBy(I, ahead);
  await tick();
  await sendAhead("1 year");
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await tick();
    await as(I, () => db.query("select public.mark_conversation_read($1)", [ahead]));
    seen.push(await seenBy(I, ahead));
  }
  if (!(seen[0] > before)) throw new Error("the first open did not mark it seen");
  if (new Set(seen).size !== 1) throw new Error(`Moe saw Ivy's 'Seen' move on ${new Set(seen).size} of 4 opens`);
  if (await unreadIn(I, ahead)) throw new Error("the chat stays unread");
  await setShown(I, true);
});
await expectOk("mark_delivered_all: likewise, after a message dated ahead the app's wakes mark it delivered once, then never again, nor after Ivy blocks Moe", async () => {
  await backdate(I, ahead);
  const before = +(await deliveredOf(I, ahead)).last_delivered_at;
  await tick();
  await sendAhead("30 days");
  const wake = async () => {
    await tick();
    await as(I, () => db.query("select public.mark_delivered_all()"));
    return +(await deliveredOf(I, ahead)).last_delivered_at;
  };
  const wakes = [await wake(), await wake(), await wake()];
  if (!(wakes[0] > before)) throw new Error("the first wake did not mark it delivered");
  if (new Set(wakes).size !== 1) throw new Error(`'Delivered' moved on ${new Set(wakes).size} of 3 wakes`);
  await block(I, Mo);
  for (let i = 0; i < 2; i++) if ((await wake()) !== wakes[0]) throw new Error("'Delivered' moved after the block");
  await unblock(I, Mo);
});
await expectOk("receipts and unread counts leave out a message dated later than now however it got there (moved ahead by the table's owner): opening the chat and waking the app stamp nothing, and the chat is not unread", async () => {
  await tick();
  await say(Mo, ahead, "moved ahead");
  await tick();
  await as(I, () => db.query("select public.mark_conversation_read($1)", [ahead]));
  await db.query("update public.messages set created_at = now() + interval '1 year' where conversation_id = $1 and content = 'moved ahead'", [ahead]);
  const before = await receiptRow(I, ahead);
  for (let i = 0; i < 3; i++) {
    await tick();
    await as(I, () => db.query("select public.mark_conversation_read($1)", [ahead]));
    await as(I, () => db.query("select public.mark_delivered_all()"));
  }
  if ((await receiptRow(I, ahead)).x !== before.x) throw new Error("the receipts moved for a message dated ahead");
  if (await unreadIn(I, ahead)) throw new Error("counted as unread");
});
await expectOk("re-running the migration dates now any message still dated ahead, and its chat's last message", async () => {
  await db.query("update public.conversations set last_message_at = now() + interval '1 year' where id = $1", [ahead]);
  await db.exec(read(MIGRATION));
  const last = (await one(db.query("select max(created_at) as at from public.messages where conversation_id = $1", [ahead]))).at;
  const chat = await one(db.query("select last_message_at from public.conversations where id = $1", [ahead]));
  if (!(last <= new Date()) || +chat.last_message_at !== +last) throw new Error(`last message ${last.toISOString()}, chat ${chat.last_message_at.toISOString()}`);
  if ((await one(db.query("select count(*)::int as n from public.messages where created_at > now()"))).n) throw new Error("messages still dated ahead");
});

// --- chats: what members may change ----------------------------------------------------------------------------------
await expectOk("chats: a member cannot move their membership into another chat, even with no filter (which the select policy does not cover) or in PostgREST's own shape, nor change its joined_at; their receipts still change, and leaving still works", async () => {
  const P = await user("Pia", "pia@txstate.edu");
  const pia = await direct(P, S);
  const moves = [
    `update public.conversation_members set conversation_id = '${chats[O]}'`,
    `update public.conversation_members set conversation_id = '${chats[O]}' where true returning 1`,
    `with pgrst_source as (update public.conversation_members set conversation_id = pgrst_body.conversation_id from (select '{"conversation_id":"${chats[O]}"}'::json as json_data) pgrst_payload, lateral (select conversation_id from json_populate_record(null::public.conversation_members, pgrst_payload.json_data)) pgrst_body returning 1) select '' from pgrst_source`,
    "update public.conversation_members set joined_at = '2000-01-01'",
    "update public.conversation_members set user_id = user_id",
  ];
  for (const sql of moves) {
    let refused = false;
    try { await as(P, () => db.query(sql)); } catch (e) { if (e.message.includes("permission denied")) refused = true; else throw e; }
    if (!refused) throw new Error("allowed: " + sql.slice(0, 80));
  }
  const where = (await rows(db.query("select conversation_id from public.conversation_members where user_id = $1", [P]))).map((r) => r.conversation_id);
  if (where.join() !== pia) throw new Error("Pia's membership moved: " + where.join());
  if ((await as(P, () => rows(db.query("select 1 from public.messages where conversation_id = $1", [chats[O]])))).length) throw new Error("Pia reads Vera and Omar's chat");
  const r = await as(P, () => db.query("update public.conversation_members set last_read_at = now(), last_delivered_at = now() where conversation_id = $1 and user_id = $2", [pia, P]));
  if (r.affectedRows !== 1) throw new Error("receipts could not be written");
  await as(P, () => db.query("delete from public.conversation_members where conversation_id = $1 and user_id = $2", [pia, P]));
  if ((await rows(db.query("select 1 from public.conversation_members where user_id = $1", [P]))).length) throw new Error("leaving did not work");
  await db.query("delete from public.conversations where id = $1", [pia]);
  for (const c of ["conversation_id", "user_id", "joined_at"]) {
    if ((await one(db.query("select has_column_privilege('authenticated', 'public.conversation_members', $1, 'update') as ok", [c]))).ok) throw new Error(`members may update ${c}`);
  }
});
await expectOk("chats: a direct chat cannot become a group (which anyone in it could then grow) nor be renamed; a group can still be renamed, and nothing else about it changed", async () => {
  let refused = false;
  try { await as(V, () => db.query("update public.conversations set type = 'group' where id = $1", [chats[O]])); } catch (e) { if (e.message.includes("permission denied")) refused = true; else throw e; }
  if (!refused) throw new Error("a direct chat turned into a group");
  const renamedDirect = await as(V, () => db.query("update public.conversations set name = 'ours' where id = $1", [chats[O]]));
  if (renamedDirect.affectedRows !== 0 || (await one(db.query("select name, type from public.conversations where id = $1", [chats[O]]))).type !== "direct") throw new Error("a direct chat was renamed");
  const renamed = await as(V, () => db.query("update public.conversations set name = 'Study group 2' where id = $1", [GROUP]));
  if (renamed.affectedRows !== 1 || (await one(db.query("select name from public.conversations where id = $1", [GROUP]))).name !== "Study group 2") throw new Error("renaming a group broke");
  for (const sql of [`update public.conversations set last_message_preview = 'forged' where id = '${GROUP}'`, `update public.conversations set created_by = '${V}' where id = '${GROUP}'`]) {
    let no = false;
    try { await as(V, () => db.query(sql)); } catch (e) { if (e.message.includes("permission denied")) no = true; else throw e; }
    if (!no) throw new Error("allowed: " + sql);
  }
  await db.query("update public.conversations set name = 'Study group' where id = $1", [GROUP]);
});

// --- activity_status -----------------------------------------------------------------------------------------------
const T = { [O]: "2026-10-11T10:15:42.123Z", [G]: "2026-10-11T09:01:59.999Z", [S]: "2026-10-10T22:30:05Z", [K]: "2026-10-11T08:00:00Z", [L]: "2026-10-11T07:00:30Z", [D]: "2026-10-11T06:59:00Z", [V]: "2026-10-11T05:00:00Z", [X]: "2026-10-11T05:00:00Z", [N]: "2026-10-11T05:00:00Z", [M]: "2026-10-11T05:00:00Z" };
for (const [uid, at] of Object.entries(T)) await stamp(uid, at);
await expectOk("activity_status: Vera sees the people who have written to her, direct or group, several at once, cut to the minute", async () => {
  const got = await status(V, [O, G, D]);
  const want = { [O]: "2026-10-11T10:15:00.000Z", [G]: "2026-10-11T09:01:00.000Z", [D]: "2026-10-11T06:59:00.000Z" };
  if (JSON.stringify(got, Object.keys(want)) !== JSON.stringify(want) || Object.keys(got).length !== 3) throw new Error(JSON.stringify(got));
});
await expectOk("activity_status: both ways once both have written, Omar sees Vera", async () => {
  const got = await status(O, [V]);
  if (Object.keys(got).join() !== V || new Date(got[V]).getUTCSeconds() !== 0 || new Date(got[V]).getUTCMilliseconds() !== 0) throw new Error(JSON.stringify(got));
});
await expectOk("activity_status: for a time, an empty chat is not enough (Max), nor a chat only you wrote in (Ned): they must have written to you", async () => {
  if (Object.keys(await status(V, [X, N])).length !== 0) throw new Error("Vera sees " + list(await status(V, [X, N])));
  if (list(await status(N, [V])) !== "Vera") throw new Error("Ned, whom Vera wrote to, cannot see her");
  if (Object.keys(await status(X, [V])).length !== 0) throw new Error("Max sees Vera from an empty chat");
});
await expectOk("activity_status: a group anyone made with anyone shows nothing until someone writes in it, and then only the writer", async () => {
  if (Object.keys(await status(M, [V, O, G])).length !== 0) throw new Error("Mal sees " + list(await status(M, [V, O, G])));
  if (list(await status(V, [M])) !== "nobody") throw new Error("Vera sees Mal");
  await say(V, MASS, "who is this?");
  if (list(await status(M, [V, O, G])) !== "Vera") throw new Error("after Vera wrote, Mal sees " + list(await status(M, [V, O, G])));
  if (list(await status(G, [V])) !== "Vera") throw new Error("Gia does not see Vera");
  await db.query("delete from public.messages where conversation_id = $1", [MASS]);
  if (Object.keys(await status(M, [V])).length !== 0) throw new Error("after the message went, Mal still sees Vera");
});
await expectOk("activity_status: someone who shares a chat with you but has not written to you is answered only while recent, and with no time ('Active now', no more than presence shows); never without a shared chat, hidden or blocked", async () => {
  const fresh = [X, N, M, S, H, K, L];
  for (const uid of fresh) await stamp(uid, new Date());
  try {
    const got = await as(V, () => rows(db.query("select user_id, last_active_at, recent from public.activity_status($1::uuid[])", [fresh])));
    const seen = got.map((r) => `${names[r.user_id]}:${r.last_active_at === null ? "no time" : "time"}:${r.recent}`).sort().join(", ");
    // Max (an empty chat), Ned (only Vera wrote) and Mal (his group with Vera, nobody has written there).
    if (seen !== "Mal:no time:true, Max:no time:true, Ned:no time:true") throw new Error("Vera got " + seen);
    const back = await as(X, () => rows(db.query("select last_active_at, recent from public.activity_status(array[$1]::uuid[])", [V])));
    if (back.length !== 0) throw new Error("Max sees Vera, whose stamp is not recent: " + JSON.stringify(back));
  } finally {
    for (const uid of fresh) await stamp(uid, T[uid] ?? "2026-10-11T05:00:00Z");
    await db.query("delete from public.user_activity where user_id = $1", [H]);
  }
  if (Object.keys(await status(V, [X, N, M])).length !== 0) throw new Error("not recent any more, yet answered");
});
await expectOk("activity_status: what a group said before you joined was not said to you: no time until they write again", async () => {
  const late = (await as(O, () => one(db.query("select public.create_group_conversation('Late joiners', $1::uuid[]) as id", [[S]])))).id;
  try {
    await say(S, late, "before Vera came");
    await tick();
    await as(O, () => db.query("select public.add_group_members($1, $2::uuid[])", [late, [V]]));
    if (Object.keys(await status(V, [S])).length !== 0) throw new Error("Vera sees Sam's time from before she joined: " + list(await status(V, [S])));
    await tick();
    await say(S, late, "welcome Vera");
    const got = await status(V, [S]);
    if (list(got) !== "Sam" || got[S] !== "2026-10-10T22:30:00.000Z") throw new Error("after Sam wrote with Vera there: " + JSON.stringify(got));
  } finally {
    await db.query("delete from public.conversations where id = $1", [late]);
  }
  if (Object.keys(await status(V, [S])).length !== 0) throw new Error("the group is gone, yet Vera sees Sam");
});
await expectOk("activity_status: recent says whether the time is within two minutes of this one (to the minute); an older time is not", async () => {
  await stamp(O, new Date());
  if ((await recentOf(V, O)) !== true) throw new Error("a stamp just now is not recent");
  const t = await one(db.query("select date_trunc('minute', now()) - interval '2 minutes' as edge, date_trunc('minute', now()) - interval '3 minutes' as before"));
  await stamp(O, t.edge);
  if ((await recentOf(V, O)) !== true) throw new Error("two minutes back is not recent");
  await stamp(O, new Date(t.before.getTime() + 59000));
  if ((await recentOf(V, O)) !== false) throw new Error("three minutes back is recent");
  await stamp(O, T[O]);
});
await expectOk("activity_status: hide yours and you see nobody's (and nobody sees yours); show it again and you do", async () => {
  await setShown(V, false);
  if (Object.keys(await status(V, [O, G, D])).length !== 0) throw new Error("Vera, hidden, sees: " + list(await status(V, [O, G, D])));
  if (Object.keys(await status(O, [V])).length !== 0) throw new Error("Omar sees hidden Vera");
  await setShown(V, true);
  if (list(await status(V, [O, G, D])) !== "Dee, Gia, Omar") throw new Error("after showing it again: " + list(await status(V, [O, G, D])));
  await touch(V);
});
await expectOk("activity_status: nothing about Hana, who hides hers, even with a time left behind (written as the owner)", async () => {
  if (Object.keys(await status(V, [H])).length !== 0) throw new Error("no row, yet something came back");
  await stamp(H, "2026-10-11T10:00:00Z");
  if (Object.keys(await status(V, [H])).length !== 0) throw new Error("Hana's time was revealed");
  await db.query("delete from public.user_activity where user_id = $1", [H]);
});
await expectOk("activity_status: blocked either way, nothing, from either side; unblocking brings it back", async () => {
  const shared = await rows(db.query("select user_id from public.conversation_members where user_id = any($1::uuid[]) and conversation_id in (select conversation_id from public.conversation_members where user_id = $2)", [[K, L], V]));
  if (shared.length !== 2) throw new Error("the blocks should not have ended the chats");
  if (Object.keys(await status(V, [K, L])).length !== 0) throw new Error("Vera sees " + list(await status(V, [K, L])));
  if (Object.keys(await status(K, [V])).length !== 0 || Object.keys(await status(L, [V])).length !== 0) throw new Error("they see Vera");
  await unblock(V, K);
  await unblock(L, V);
  if (list(await status(V, [K, L])) !== "Kai, Lee") throw new Error("after unblocking: " + list(await status(V, [K, L])));
  await block(V, K);
  await block(L, V);
});
await expectOk("activity_status: nothing without a shared chat: Sam shows his status but only chats with Omar, who sees him", async () => {
  if (Object.keys(await status(V, [S])).length !== 0) throw new Error("Vera sees Sam");
  if (Object.keys(await status(S, [V])).length !== 0) throw new Error("Sam sees Vera");
  if (list(await status(O, [S])) !== "Sam") throw new Error("Omar cannot see Sam");
});
await expectOk("activity_status: leaving the group ends Gia's (her messages stay behind); your own time is never in the answer", async () => {
  if (Object.keys(await status(V, [V])).length !== 0) throw new Error("Vera got her own time");
  const { joined_at: joined } = await one(db.query("select joined_at from public.conversation_members where conversation_id = $1 and user_id = $2", [GROUP, G]));
  await as(G, () => db.query("delete from public.conversation_members where conversation_id = $1 and user_id = $2", [GROUP, G]));
  if (Object.keys(await status(V, [G])).length !== 0) throw new Error("Vera still sees Gia");
  // Put her back as she was (rejoining now would make what was said before not count for her: see "Late joiners").
  await db.query("insert into public.conversation_members (conversation_id, user_id, joined_at) values ($1, $2, $3)", [GROUP, G, joined]);
});
await expectOk("activity_status: only the first 100 ids count; repeats and unknown ids are fine", async () => {
  if (list(await status(V, [...randomIds(99), O])) !== "Omar") throw new Error("Omar 100th");
  if (Object.keys(await status(V, [...randomIds(100), O])).length !== 0) throw new Error("Omar 101st was answered");
  const got = await as(V, () => rows(db.query("select user_id from public.activity_status($1::uuid[])", [[O, O, G, O, G]])));
  if (got.length !== 2) throw new Error("repeats: " + JSON.stringify(got));
  if (Object.keys(await status(V, [])).length !== 0) throw new Error("empty list");
  const nulls = await as(V, () => rows(db.query("select user_id from public.activity_status(array[null, $1]::uuid[])", [O])));
  if (nulls.length !== 1) throw new Error("a null id");
});
await expectOk("activity_status: everyone at once gives exactly the allowed ones (with no stamp recent, only times)", async () => {
  for (const [uid, at] of Object.entries(T)) await stamp(uid, at);
  const everyone = [V, O, G, H, K, L, S, D, X, N, M];
  for (const [viewer, want] of [[V, "Dee, Gia, Omar"], [O, "Sam, Vera"], [H, "nobody"], [S, "Omar"], [K, "nobody"], [L, "nobody"], [G, "Vera"], [X, "nobody"], [N, "Vera"], [M, "nobody"]]) {
    const got = list(await status(viewer, everyone));
    if (got !== want) throw new Error(`${names[viewer]} sees ${got}; expected ${want}`);
  }
});
await expectError("activity_status: the API refuses it signed out", () => asAnon(() => db.query("select * from public.activity_status($1::uuid[])", [[O]])), "permission denied");
await expectOk("activity_status: signed in may call it; stable, security definer; the sender index is there", async () => {
  if (!(await can("authenticated", "public.activity_status(uuid[])")) || (await can("anon", "public.activity_status(uuid[])"))) throw new Error("grants");
  const f = await one(db.query("select provolatile, prosecdef from pg_proc where oid = 'public.activity_status(uuid[])'::regprocedure"));
  if (f.provolatile !== "s" || !f.prosecdef) throw new Error(JSON.stringify(f));
  if (await can("authenticated", "public.forget_activity_when_hidden()")) throw new Error("the trigger function is callable");
  const idx = await one(db.query("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'messages_sender_conversation_idx'"));
  if (!idx || !idx.indexdef.includes("(sender_id, conversation_id)")) throw new Error("index: " + JSON.stringify(idx));
});
await expectOk("re-running the migration keeps everyone's times", async () => {
  const before = await rows(db.query("select user_id, last_active_at from public.user_activity order by user_id"));
  await db.exec(read(MIGRATION));
  const after = await rows(db.query("select user_id, last_active_at from public.user_activity order by user_id"));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("times changed");
});

// --- blocks, for presence ------------------------------------------------------------------------------------------
await expectOk("blocked_either_way_ids: the people I blocked and who blocked me, nobody else's blocks", async () => {
  const ids = async (uid) => (await as(uid, () => rows(db.query("select * from public.blocked_either_way_ids() as id")))).map((r) => names[r.id]).sort().join(", ") || "nobody";
  if ((await ids(V)) !== "Kai, Lee") throw new Error("Vera: " + (await ids(V)));
  if ((await ids(K)) !== "Vera" || (await ids(L)) !== "Vera") throw new Error("Kai / Lee");
  if ((await ids(O)) !== "nobody") throw new Error("Omar: " + (await ids(O)));
  if (!(await can("authenticated", "public.blocked_either_way_ids()")) || (await can("anon", "public.blocked_either_way_ids()"))) throw new Error("grants");
});
await expectError("blocked_either_way_ids: the API refuses it signed out", () => asAnon(() => db.query("select * from public.blocked_either_way_ids()")), "permission denied");

// --- notifications: changed only once shown --------------------------------------------------------------------------
await expectOk("notifications: a scheduled one (an anonymous Buzz reply's) cannot be surfaced early by a filterless update, nor counted or deleted by a filterless delete; only read_at may change; once shown it is read and deleted as before", async () => {
  const Q = await user("Quinn", "quinn@txstate.edu");
  await db.query("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 3600 where id = 1");
  try {
    const post = await buzzPost(Q, "Is anyone up?");
    await buzzReply(O, post, "me");
    const owner = () => rows(db.query("select id, read_at, visible_at from public.notifications where user_id = $1", [Q]));
    const [n] = await owner();
    if (!n || !(n.visible_at > new Date())) throw new Error("setup: no scheduled notification");
    let refused = false;
    try { await as(Q, () => db.query("update public.notifications set visible_at = now()")); } catch (e) { if (e.message.includes("permission denied")) refused = true; else throw e; }
    if (!refused) throw new Error("a filterless update of visible_at went through");
    const read = await as(Q, () => db.query("update public.notifications set read_at = now()"));
    const gone = await as(Q, () => db.query("delete from public.notifications"));
    const after = await owner();
    if (read.affectedRows !== 0 || gone.affectedRows !== 0 || after.length !== 1 || after[0].read_at !== null) throw new Error(`reached the scheduled one: updated ${read.affectedRows}, deleted ${gone.affectedRows}, left ${JSON.stringify(after)}`);
    if ((await as(Q, () => rows(db.query("select * from public.notifications")))).length !== 0) throw new Error("visible before its time");
    // Its time comes.
    await db.query("update public.notifications set visible_at = now() - interval '1 second' where user_id = $1", [Q]);
    if ((await as(Q, () => one(db.query("select public.mark_notifications_read() as n")))).n !== 1) throw new Error("mark_notifications_read");
    const del = await as(Q, () => db.query("delete from public.notifications where id = $1", [n.id]));
    if (del.affectedRows !== 1) throw new Error("deleting a shown notification");
    for (const c of ["visible_at", "created_at", "user_id", "title", "body", "data"]) {
      if ((await one(db.query("select has_column_privilege('authenticated', 'public.notifications', $1, 'update') as ok", [c]))).ok) throw new Error(`the API may update ${c}`);
    }
  } finally {
    await db.query("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0 where id = 1");
  }
});

// --- account deletion ----------------------------------------------------------------------------------------------
await expectOk("deleting an account deletes its time", async () => {
  if (!(await activityOf(D))) throw new Error("setup");
  await as(D, () => db.query("select public.delete_my_account()"));
  if ((await one(db.query("select count(*)::int as n from public.user_activity where user_id = $1", [D]))).n !== 0) throw new Error("the time survived");
  if (Object.keys(await status(V, [D])).length !== 0) throw new Error("still answered");
});

// --- realtime ------------------------------------------------------------------------------------------------------
await expectOk("realtime publication: user_activity is taken back out if someone added it; conversation_members stays in", async () => {
  await db.exec("alter publication supabase_realtime add table public.user_activity");
  await db.exec(read(MIGRATION));
  const tables = (await rows(db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'"))).map((r) => r.tablename);
  if (tables.includes("user_activity") || !tables.includes("conversation_members")) throw new Error(tables.join());
});

// A stand-in for Supabase's realtime schema: Realtime Authorization asks whether the user may read a presence message
// on the channel's topic (receive) and insert one (track), with realtime.topic() set to that topic.
await db.exec(`create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text not null, extension text not null, event text, payload jsonb, private boolean not null default true, inserted_at timestamptz not null default now());
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '')::text $$;
  grant usage on schema realtime to anon, authenticated;
  grant select, insert on realtime.messages to anon, authenticated;
  grant usage on sequence realtime.messages_id_seq to anon, authenticated;`);
const TOPIC = "presence:active";
const onTopic = (uid, topic, fn) => {
  const run = async () => {
    await db.query("select set_config('realtime.topic', $1, false)", [topic]);
    try { return await fn(); } finally { await db.query("select set_config('realtime.topic', '', false)"); }
  };
  return uid ? as(uid, run) : asAnon(run);
};
const receives = (uid, topic, extension) => onTopic(uid, topic, async () => (await one(db.query("select count(*)::int as n from realtime.messages where topic = $1 and extension = $2", [topic, extension]))).n > 0);
const tracks = (uid, topic, extension) => onTopic(uid, topic, async () => {
  try {
    await db.query("insert into realtime.messages (topic, extension) values ($1, $2)", [topic, extension]);
    return true;
  } catch (e) {
    if (e.message.includes("row-level security")) return false;
    throw e;
  }
});
const presencePolicies = async () => (await rows(db.query("select policyname, cmd, roles::text[] as roles from pg_policies where schemaname = 'realtime' and tablename = 'messages' order by policyname"))).map((r) => `${r.policyname}:${r.cmd}:${r.roles.join("+")}`).join(", ");

await expectOk("presence policies: none were made without a realtime schema; with one, a re-run makes the two (and only two, however often it runs)", async () => {
  if ((await presencePolicies()) !== "") throw new Error("policies before the realtime schema existed");
  await db.exec(read(MIGRATION));
  await db.exec(read(MIGRATION));
  const got = await presencePolicies();
  if (got !== "presence_active_insert:INSERT:authenticated, presence_active_select:SELECT:authenticated") throw new Error(got);
});
// One message of each kind on each topic, as Realtime's own check would insert before asking.
for (const topic of [TOPIC, "online", "conversation:1", "presence:active:x"]) for (const extension of ["presence", "broadcast"]) {
  await db.query("insert into realtime.messages (topic, extension) values ($1, $2)", [topic, extension]);
}
await expectOk("presence policies: Vera, who shows her status, receives and tracks presence on presence:active", async () => {
  if (!(await receives(V, TOPIC, "presence"))) throw new Error("cannot receive");
  if (!(await tracks(V, TOPIC, "presence"))) throw new Error("cannot track");
});
await expectOk("presence policies: nothing else on that topic (no broadcasts), and nothing on any other topic", async () => {
  if (await receives(V, TOPIC, "broadcast")) throw new Error("receives broadcasts");
  if (await tracks(V, TOPIC, "broadcast")) throw new Error("sends broadcasts");
  for (const topic of ["online", "conversation:1", "presence:active:x"]) for (const extension of ["presence", "broadcast"]) {
    if (await receives(V, topic, extension)) throw new Error(`receives ${extension} on ${topic}`);
    if (await tracks(V, topic, extension)) throw new Error(`sends ${extension} on ${topic}`);
  }
});
await expectOk("presence policies: nothing for Hana, who hides her status, or signed out", async () => {
  for (const [who, uid] of [["Hana", H], ["signed out", null]]) {
    if (await receives(uid, TOPIC, "presence")) throw new Error(`${who} receives`);
    if (await tracks(uid, TOPIC, "presence")) throw new Error(`${who} tracks`);
  }
});
await expectOk("presence policies: Vera hiding her status shuts her out; showing it again lets her back in", async () => {
  await setShown(V, false);
  if ((await receives(V, TOPIC, "presence")) || (await tracks(V, TOPIC, "presence"))) throw new Error("hidden Vera got in");
  await setShown(V, true);
  if (!(await receives(V, TOPIC, "presence")) || !(await tracks(V, TOPIC, "presence"))) throw new Error("Vera is still out");
});
done("MIGRATION-22 ACTIVITY STATUS");
