// Migration 41 (Trust & Safety, ported from UniVerse) against PGlite: the tables are closed to the API; the staff
// functions answer everyone else "not found"; the moderator vs admin matrix; the audited, admin-only unmask; the
// append-only audit log; appeals (reviewer is not the actor); posting status for mutes, suspensions, bans and warnings;
// reporter trust and the auto-hide thresholds; banned addresses cannot sign up again; the reports insert policy refuses
// Buzz; and UniVerse's named-account firewall: nothing a moderator can read names a buzz's author, and acting on a buzz
// moves nothing a moderator can see on that person's account.
//
// Buzz content is reached through migration 42's adapters (buzz_v2_snapshot, buzz_v2_author_of, buzz_v2_set_status,
// buzz_v2_set_locked, buzz_v2_staff_context). When that migration is present this file uses it (and writes buzzes with
// buzz_v2_create / buzz_v2_reply as the website's server would); when it is not, a minimal stand-in for the five
// adapters over the pre-v2 tables is installed below, so this lane can be tested on its own.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION } from "../../packages/shared/src/buzz/constants.ts";

const MIGRATION = "migrations/20261103000000_trust_safety.sql";
const { db, mk, as, asAnon, asService } = await boot();
await expectOk("the Trust & Safety migration re-runs cleanly", async () => { await db.exec(read(MIGRATION)); });

const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const sql1 = async (text, params = []) => (await one(db.query(text, params)));
/** Call `select <expr> as r` as a signed-in user and return r. */
const call = (uid, expr, params = []) => as(uid, async () => (await one(db.query(`select ${expr} as r`, params))).r);
const callService = (expr, params = []) => asService(async () => (await one(db.query(`select ${expr} as r`, params))).r);
const check = (cond, message) => { if (!cond) throw new Error(message); };
const NIL = "00000000-0000-0000-0000-000000000000";

// --- Buzz: the real migration 42, or a stand-in for its adapters ------------------------------------------------
const V2 = (await sql1("select to_regprocedure('public.buzz_v2_snapshot(text,uuid)') is not null as ok")).ok
  && (await sql1("select to_regprocedure('public.buzz_v2_create(uuid,jsonb,text,boolean,jsonb)') is not null as ok")).ok;
console.log(V2 ? "  · Buzz: migration 42 is present; testing against its adapters" : "  · Buzz: migration 42 is not here yet; using the stand-in adapters");
if (!V2) {
  await db.exec(`
    alter table public.buzz_posts add column if not exists status text not null default 'active';
    alter table public.buzz_posts add column if not exists locked boolean not null default false;
    alter table public.buzz_posts add column if not exists auto_hide_immune boolean not null default false;
    alter table public.buzz_comments add column if not exists status text not null default 'active';
    alter table public.buzz_comments add column if not exists auto_hide_immune boolean not null default false;
    create or replace function public.buzz_v2_snapshot(p_entity_type text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
    declare b public.buzz_posts; c public.buzz_comments;
    begin
      if p_entity_type = 'buzz' then
        select * into b from public.buzz_posts where id = p_id;
        if not found then return null; end if;
        return jsonb_build_object('entityType', 'buzz', 'entityId', b.id, 'status', b.status, 'universityId', b.university_id, 'surface', 'buzz', 'label', 'buzz',
          'autoHideImmune', b.auto_hide_immune, 'createdAt', floor(extract(epoch from b.visible_at) / 60) * 60000, 'href', '/buzz/' || b.id,
          'fields', jsonb_build_array(jsonb_build_object('field', 'title', 'text', b.title), jsonb_build_object('field', 'body', 'text', b.body)), 'media', '[]'::jsonb, 'parent', null);
      elsif p_entity_type = 'buzz_reply' then
        select * into c from public.buzz_comments where id = p_id;
        if not found then return null; end if;
        return jsonb_build_object('entityType', 'buzz_reply', 'entityId', c.id, 'status', c.status, 'universityId', (select university_id from public.buzz_posts where id = c.post_id),
          'surface', 'buzz_reply', 'label', 'reply', 'autoHideImmune', c.auto_hide_immune, 'createdAt', floor(extract(epoch from c.visible_at) / 60) * 60000, 'href', '/buzz/' || c.post_id,
          'fields', jsonb_build_array(jsonb_build_object('field', 'body', 'text', c.body)), 'media', '[]'::jsonb,
          'parent', jsonb_build_object('entityType', case when c.parent_id is null then 'buzz' else 'buzz_reply' end, 'entityId', coalesce(c.parent_id, c.post_id)));
      end if;
      return null;
    end $$;
    create or replace function public.buzz_v2_author_of(p_entity_type text, p_id uuid) returns uuid language sql stable security definer set search_path = public as $$
      select case when p_entity_type = 'buzz' then (select author_id from public.buzz_posts where id = p_id) else (select author_id from public.buzz_comments where id = p_id) end
    $$;
    create or replace function public.buzz_v2_set_status(p_entity_type text, p_id uuid, p_status text, p_immune boolean default null) returns void language plpgsql security definer set search_path = public as $$
    begin
      if p_entity_type = 'buzz' then update public.buzz_posts set status = p_status, auto_hide_immune = coalesce(p_immune, auto_hide_immune) where id = p_id;
      else update public.buzz_comments set status = p_status, auto_hide_immune = coalesce(p_immune, auto_hide_immune) where id = p_id; end if;
    end $$;
    create or replace function public.buzz_v2_set_locked(p_id uuid, p_locked boolean) returns void language sql security definer set search_path = public as $$
      update public.buzz_posts set locked = p_locked where id = p_id
    $$;
    create or replace function public.buzz_v2_staff_context(p_entity_type text, p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
      select jsonb_build_object('entityType', p_entity_type,
        'root', jsonb_build_object('id', b.id, 'kind', 'buzz', 'alias', jsonb_build_object('emoji', '🪐', 'label', 'Anon Comet', 'color', '#f87171'), 'text', b.body, 'locked', b.locked),
        'parents', '[]'::jsonb, 'siblings', '[]'::jsonb)
      from public.buzz_posts b
      where b.id = case when p_entity_type = 'buzz' then p_id else (select post_id from public.buzz_comments where id = p_id) end
    $$;
    revoke all on function public.buzz_v2_snapshot(text, uuid), public.buzz_v2_author_of(text, uuid), public.buzz_v2_set_status(text, uuid, text, boolean),
      public.buzz_v2_set_locked(uuid, boolean), public.buzz_v2_staff_context(text, uuid) from public, anon, authenticated;
  `);
}

const accepted = new Set();
async function acceptGate(uid) {
  if (!V2 || accepted.has(uid)) return;
  await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [BUZZ_GUIDELINES_VERSION]));
  accepted.add(uid);
}
/** A buzz as the website's server writes it (migration 42), or straight into the pre-v2 table. Returns its id. */
async function postBuzz(author, text, title = "") {
  if (V2) {
    await acceptGate(author);
    // Buzz's own rate limits are migration 42's to test; these fixtures write more than 6 an hour per author.
    await db.query("delete from public.buzz_rate_log where user_id = $1", [author]);
    const r = await callService("public.buzz_v2_create($1, $2::jsonb, 'active', false, null)", [author, JSON.stringify({ text, ...(title ? { title } : {}), scope: "campus" })]);
    return r.id;
  }
  return (await sql1(
    "insert into public.buzz_posts (author_id, alias, university_id, title, body) select $1, 'Student 10001', p.university_id, $2, $3 from public.profiles p where p.id = $1 returning id",
    [author, title || "A buzz title", text],
  )).id;
}
async function replyBuzz(author, thread, text) {
  if (V2) {
    await acceptGate(author);
    await db.query("delete from public.buzz_rate_log where user_id = $1", [author]);
    const r = await callService("public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null)", [author, thread, JSON.stringify({ text })]);
    return r.id;
  }
  return (await sql1("insert into public.buzz_comments (post_id, author_id, alias, body) values ($1, $2, 'Student 10002', $3) returning id", [thread, author, text])).id;
}
const buzzStatus = async (type, id) => (await sql1("select public.ts_snapshot($1, $2) ->> 'status' as s", [type, id])).s;

// --- people ---------------------------------------------------------------------------------------------------
const people = {};
async function person(key, email, name, { old = true } = {}) {
  const id = await mk(email, name);
  if (old) await db.query("update public.profiles set created_at = now() - interval '60 days' where id = $1", [id]);
  const p = await sql1("select p.id, p.full_name, p.username, u.email from public.profiles p join auth.users u on u.id = p.id where p.id = $1", [id]);
  people[key] = p;
  return id;
}
const MOD = await person("mod", "mod.riley@txstate.edu", "Riley Moderate");
const MOD2 = await person("mod2", "mod.second@txstate.edu", "Sam Secondmod");
const ADMIN = await person("admin", "admin.dana@txstate.edu", "Dana Adminton");
const ADMIN2 = await person("admin2", "admin.victor@txstate.edu", "Victor Overseer");
const AUTHOR = await person("author", "zelda.q@txstate.edu", "Zelda Quorvex");
const AUTHOR2 = await person("author2", "yusuf.k@txstate.edu", "Yusuf Kestrelwind");
const PUB = await person("pub", "pat.public@txstate.edu", "Pat Publicposter");
const R = [];
for (let i = 1; i <= 6; i++) R.push(await person(`r${i}`, `reporter${i}@txstate.edu`, `Reporter Number${i}`));
const NEW = [];
for (let i = 1; i <= 3; i++) NEW.push(await person(`n${i}`, `newbie${i}@txstate.edu`, `Newbie Fresh${i}`, { old: false }));
const USER = await person("user", "plain.user@txstate.edu", "Plain Userperson");
const F1 = await person("f1", "fresh.reporter@txstate.edu", "Fiona Reportwell");
const F2 = await person("f2", "fresh.second@txstate.edu", "Felix Flagsworth");
const TARGET = await person("target", "tess.target@txstate.edu", "Tess Targetable");
for (const [uid, role] of [[MOD, "moderator"], [MOD2, "moderator"], [ADMIN, "admin"], [ADMIN2, "admin"]]) {
  await db.query("insert into public.staff_members (user_id, role) values ($1, $2)", [uid, role]);
}
const identityOf = (key) => [people[key].id, people[key].full_name, people[key].username, people[key].email];

/** No identity string of `key` anywhere in `payload` (UniVerse assertNoIdentityLeak). */
function noIdentity(label, payload, keys) {
  const s = JSON.stringify(payload);
  for (const key of keys) for (const needle of identityOf(key)) if (needle && s.includes(needle)) throw new Error(`${label} leaks ${key}'s identity (${needle}): ${s.slice(0, 400)}`);
}
/** No identity-like key anywhere (UniVerse assertNoForbiddenKeys). */
const FORBIDDEN_KEYS = ["authorId", "author_id", "userId", "user_id", "handle", "displayName", "avatar", "avatarUrl", "email", "profile", "reporter", "targetUserId"];
function noForbiddenKeys(label, value, allow = []) {
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.includes(k) && !allow.includes(k) && x !== null) throw new Error(`${label}: forbidden key ${path}.${k}`);
      walk(x, `${path}.${k}`);
    }
  };
  walk(value, "$");
}

// =================================================================================================================
// 1. Closed to the API
// =================================================================================================================
const TABLES = ["staff_members", "mod_queue", "moderation_events", "moderation_actions", "strikes", "user_sanctions", "appeals", "audit_log", "banned_emails", "moderation_rule_state", "ts_secrets"];
for (const t of TABLES) {
  await expectError(`tables: ${t} cannot be read by a signed-in user`, () => as(USER, () => db.query(`select * from public.${t}`)), "permission denied");
  await expectError(`tables: ${t} cannot be read signed out`, () => asAnon(() => db.query(`select * from public.${t}`)), "permission denied");
}
await expectError("tables: nobody writes the queue from the API", () => as(MOD, () => db.query("insert into public.mod_queue (entity_type, surface, source, priority) values ('post','post','system','p0')")), "permission denied");
await expectError("tables: staff cannot grant themselves through the API either", () => as(USER, () => db.query("insert into public.staff_members (user_id, role) values ($1, 'admin')", [USER])), "permission denied");
await expectOk("tables: none of them is in the realtime publication", async () => {
  const pub = await rows(db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = any($1)", [TABLES]));
  check(pub.length === 0, "published: " + pub.map((r) => r.tablename).join());
});
await expectOk("functions: the engine's and the write API's helpers are not callable by signed-in people", async () => {
  for (const f of ["ts_writer_context($1)", "ts_record_blocked($1, 'buzz', 'x', null)", "ts_file_report($1, 'post', $1, 'spam', null, null)", "ts_posting_status($1, 'buzz')",
    "ts_enqueue('post', $1, 'post', null, null, 'system', null, 'none', 'p0', null, '[]', null, 0, 0)", "ts_apply_moderation('post', $1, 'post', $1, null, '{}')",
    "ts_author_of('buzz', $1)", "ts_reporter_trust($1)", "ts_role_of($1)", "ts_seal('x', 'y')"]) {
    let refused = false;
    try { await as(USER, () => db.query(`select public.${f}`, f.includes("$1") ? [USER] : [])); } catch (e) { refused = /permission denied/.test(e.message); }
    check(refused, `${f} is callable by a signed-in user`);
  }
});
await expectOk("functions: the write API's two (writer context, blocked write) run for the service role", async () => {
  const ctx = await callService("public.ts_writer_context($1)", [USER]);
  check(ctx.userId === USER && ctx.role === "user" && Array.isArray(ctx.recentHashes), JSON.stringify(ctx));
});

// =================================================================================================================
// 2. Non-staff: not found, everywhere
// =================================================================================================================
const STAFF_CALLS = [
  ["staff_queue", "public.staff_queue('priority', 10, 0, '{}'::jsonb)"],
  ["staff_queue_counts", "public.staff_queue_counts()"],
  ["staff_queue_item", `public.staff_queue_item('${NIL}')`],
  ["staff_claim", `public.staff_claim('${NIL}')`],
  ["staff_release", `public.staff_release('${NIL}')`],
  ["staff_act", `public.staff_act('${NIL}', 'approve', 'spam_scam', null, null, null)`],
  ["staff_bulk", `public.staff_bulk(array['${NIL}']::uuid[], 'approve', 'spam_scam', null)`],
  ["staff_unmask", `public.staff_unmask('buzz', '${NIL}', 'credible_threat', '${"x".repeat(40)}', 'UNMASK', null)`],
  ["staff_audit", "public.staff_audit(10, 0, '{}'::jsonb)"],
  ["staff_users", "public.staff_users('re', 20, 0)"],
  ["staff_user", `public.staff_user('${NIL}')`],
  ["staff_sanction", `public.staff_sanction('${NIL}', 'warning', null, 'all', 'spam_scam', 'a long enough note')`],
  ["staff_lift", "public.staff_lift('x', 'a long enough note')"],
  ["staff_grant_role", `public.staff_grant_role('${NIL}', 'moderator')`],
  ["staff_appeals", "public.staff_appeals('open', 10, 0)"],
  ["staff_decide_appeal", `public.staff_decide_appeal('${NIL}', 'upheld', 'a long enough note', null)`],
  ["staff_metrics", "public.staff_metrics(null, null)"],
  ["staff_rule_packs", "public.staff_rule_packs()"],
  ["staff_set_rule_pack", "public.staff_set_rule_pack('admin.spam', false, null)"],
];
await expectOk("non-staff: every staff function answers 'not found', and signed out cannot call them at all", async () => {
  for (const [name, expr] of STAFF_CALLS) {
    let msg = "";
    try { await call(USER, expr); } catch (e) { msg = e.message; }
    check(msg.startsWith("ts:not_found:"), `${name} as a regular user: ${msg || "no error"}`);
    msg = "";
    try { await asAnon(() => db.query(`select ${expr}`)); } catch (e) { msg = e.message; }
    check(/permission denied/.test(msg), `${name} signed out: ${msg || "no error"}`);
  }
});
await expectOk("ts_staff_role(): null for everyone else, the role for staff; signed out cannot ask", async () => {
  check((await call(USER, "public.ts_staff_role()")) === null, "a user has a role");
  check((await call(MOD, "public.ts_staff_role()")) === "moderator", "moderator");
  check((await call(ADMIN, "public.ts_staff_role()")) === "admin", "admin");
});
await expectError("ts_staff_role(): signed out is refused", () => asAnon(() => db.query("select public.ts_staff_role()")), "permission denied");

// =================================================================================================================
// 3. Reports: the insert policy, the server's columns, the queue
// =================================================================================================================
const postOf = async (author, body) => (await sql1("insert into public.feed_posts (author_id, body) values ($1, $2) returning id", [author, body])).id;
const PUBPOST = await postOf(PUB, "Selling my old textbooks, ask me anything about them");
const B_REPORTED = await postBuzz(AUTHOR, "the dining hall closes too early on weekends, honestly");

for (const type of ["buzz", "buzz_reply", "buzz_comment"]) {
  await expectError(`reports: the API cannot report ${type} (Buzz reports go through buzz_v2_report)`, () =>
    as(R[0], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, 'harassment')", [R[0], type, B_REPORTED])), "row-level security");
}
await expectOk("reports: a public report from the API files a queue item, and the server sets eligibility and weight", async () => {
  await as(R[0], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason, details) values ($1, 'post', $2, 'spam', 'looks like spam')", [R[0], PUBPOST]));
  const r = await sql1("select * from public.reports where reporter_id = $1 and target_id = $2", [R[0], PUBPOST]);
  check(r.eligible === true && r.weight === 1 && r.status === "open" && r.queue_id, JSON.stringify(r));
  const q = await sql1("select * from public.mod_queue where id = $1", [r.queue_id]);
  check(q.entity_type === "post" && q.source === "user_report" && q.report_count === 1 && q.reporter_weight === 1 && q.author_id === PUB && q.category === "spam_scam" && q.priority === "p2", JSON.stringify(q));
});
await expectOk("reports: a repeat is a quiet no-op (one report per person and thing)", async () => {
  await as(R[0], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'scam')", [R[0], PUBPOST]));
  const n = (await sql1("select count(*)::int as n from public.reports where reporter_id = $1 and target_id = $2", [R[0], PUBPOST])).n;
  check(n === 1, `${n} reports`);
  check((await sql1("select report_count from public.mod_queue where entity_type = 'post' and entity_id = $1 and status <> 'closed'", [PUBPOST])).report_count === 1, "the queue counted the repeat");
});
await expectOk("reports: values the server owns cannot be sent (status, weight, eligibility, queue link)", async () => {
  let refused = false;
  try {
    await as(R[1], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason, weight, eligible, status) values ($1, 'post', $2, 'spam', 2, true, 'actioned')", [R[1], PUBPOST]));
  } catch (e) { refused = /permission denied/.test(e.message); }
  check(refused, "the API set weight / eligible / status");
});
await expectError("reports: a reporter cannot read their own weight (it would tell them their trust)", () => as(R[0], () => db.query("select weight from public.reports")), "permission denied");
await expectOk("reports: a reporter still reads their own reports' public columns", async () => {
  const mine = await as(R[0], () => rows(db.query("select id, target_type, status from public.reports")));
  check(mine.length === 1 && mine[0].target_type === "post", JSON.stringify(mine));
});
await expectError("reports: not your own content", () => as(PUB, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')", [PUB, PUBPOST])), "ts:validation_failed:You can't report your own content.");
await expectError("reports: not something that does not exist", () => as(R[1], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')", [R[1], NIL])), "ts:not_found:");
await expectOk("reports (Buzz, through ts_file_report): filed once, then alreadyReported; Buzz errors speak Buzz", async () => {
  const first = await sql1("select public.ts_file_report($1, 'buzz', $2, 'harassment', null, null) as r", [R[1], B_REPORTED]);
  const again = await sql1("select public.ts_file_report($1, 'buzz', $2, 'hate', null, null) as r", [R[1], B_REPORTED]);
  check(first.r.alreadyReported === false && again.r.alreadyReported === true, JSON.stringify([first, again]));
  const q = await sql1("select * from public.mod_queue where entity_type = 'buzz' and entity_id = $1 and status <> 'closed'", [B_REPORTED]);
  check(q && q.author_id === AUTHOR && q.surface === "buzz" && q.report_count === 1, JSON.stringify(q));
});
await expectError("reports (Buzz): 'Something else' needs a note of 10+ characters", () => db.query("select public.ts_file_report($1, 'buzz', $2, 'other', 'short', null)", [R[2], B_REPORTED]), "buzz:validation_failed:Tell us a bit more");
await expectError("reports (Buzz): your own buzz", () => db.query("select public.ts_file_report($1, 'buzz', $2, 'harassment', null, null)", [AUTHOR, B_REPORTED]), "buzz:own_item:");
await expectError("reports (Buzz): a buzz that does not exist", () => db.query("select public.ts_file_report($1, 'buzz', $2, 'harassment', null, null)", [R[2], NIL]), "buzz:not_found:That buzz isn't available.");
await expectError("reports (Buzz): old reasons are for public content only", () => db.query("select public.ts_file_report($1, 'buzz', $2, 'spam', null, null)", [R[2], B_REPORTED]), "buzz:validation_failed:Pick a reason.");

// =================================================================================================================
// 4. Reporter trust and auto-hide
// =================================================================================================================
await expectOk("trust: normal by default; low after 3 dismissed in 30 days under 20 % confirmed; high after 5 confirmed at 70 %+; bad faith is low", async () => {
  const trust = async (uid) => (await sql1("select public.ts_reporter_trust($1) as t", [uid])).t;
  check((await trust(R[5])) === "normal", "default");
  const targets = [];
  for (let i = 0; i < 6; i++) targets.push(await postOf(PUB, `trust probe post number ${i}`));
  for (const t of targets) await db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')", [R[5], t]);
  await db.query("update public.reports set status = 'dismissed', closed_at = now() where reporter_id = $1 and target_id = any($2)", [R[5], targets.slice(0, 3)]);
  check((await trust(R[5])) === "low", "3 dismissed, 0 confirmed is not low");
  await db.query("update public.reports set status = 'actioned', closed_at = now() where reporter_id = $1 and target_id = any($2)", [R[5], targets]);
  check((await trust(R[5])) === "high", "6 confirmed of 6 is not high");
  await db.query("update public.reports set bad_faith = true where reporter_id = $1 and target_id = $2", [R[5], targets[0]]);
  check((await trust(R[5])) === "low", "bad faith is not low");
  await db.query("delete from public.reports where reporter_id = $1", [R[5]]);
});

const fileBuzzReport = (uid, type, id, reason = "harassment", note = null) => db.query("select public.ts_file_report($1, $2, $3, $4, $5, null)", [uid, type, id, reason, note]);
await expectOk("auto-hide: two eligible reporters do not hide a buzz; the third does (status hidden, author told, P1)", async () => {
  const b = await postBuzz(AUTHOR2, "the shuttle schedule changed again without any notice");
  await fileBuzzReport(R[0], "buzz", b);
  await fileBuzzReport(R[1], "buzz", b);
  check((await buzzStatus("buzz", b)) === "active", "hidden after 2");
  await fileBuzzReport(R[2], "buzz", b);
  check((await buzzStatus("buzz", b)) === "hidden", "not hidden after 3");
  const q = await sql1("select priority, report_count, reporter_weight from public.mod_queue where entity_type = 'buzz' and entity_id = $1 and status <> 'closed'", [b]);
  check(q.priority === "p0" || q.priority === "p1", "priority " + q.priority);
  check(q.report_count === 3 && q.reporter_weight === 3, JSON.stringify(q));
  const n = await sql1("select * from public.notifications where user_id = $1 and type = 'moderation' order by created_at desc limit 1", [AUTHOR2]);
  check(n && n.actor_id === null && /hidden while our team reviews it/.test(n.title) && n.data.event === "content_hidden", JSON.stringify(n));
  noIdentity("the author's hidden notice", n, ["r1", "r2", "r3"]);
});
await expectOk("auto-hide: three brand-new accounts (under 24 hours) carry no weight and hide nothing", async () => {
  const b = await postBuzz(AUTHOR2, "the library wifi drops every afternoon around three");
  for (const n of NEW) await fileBuzzReport(n, "buzz", b);
  check((await buzzStatus("buzz", b)) === "active", "new accounts hid it");
  const w = await rows(db.query("select eligible, weight from public.reports where target_id = $1", [b]));
  check(w.length === 3 && w.every((x) => x.eligible === false && x.weight === 0), JSON.stringify(w));
});
await expectOk("auto-hide: 'I'm worried about this person' never hides; it goes to P0 wellbeing", async () => {
  const b = await postBuzz(AUTHOR2, "rough week, just needed to say it somewhere honestly");
  for (const r of R.slice(0, 4)) await fileBuzzReport(r, "buzz", b, "self_harm");
  check((await buzzStatus("buzz", b)) === "active", "self_harm reports hid it");
  const q = await sql1("select priority, label, category from public.mod_queue where entity_type = 'buzz' and entity_id = $1", [b]);
  check(q.priority === "p0" && q.label === "wellbeing" && q.category === "self_harm", JSON.stringify(q));
});
await expectOk("auto-hide: two reports of a threat hide anything", async () => {
  const b = await postBuzz(AUTHOR2, "something weird is planned at the stadium, stay away saturday");
  await fileBuzzReport(R[0], "buzz", b, "threat");
  await fileBuzzReport(R[1], "buzz", b, "threat");
  check((await buzzStatus("buzz", b)) === "hidden", "two threat reports did not hide it");
});
await expectOk("auto-hide: content the engine flagged hides one report sooner (2 for a buzz)", async () => {
  const b = await postBuzz(AUTHOR2, "the parking office keeps ticketing the visitor lot for no reason");
  await db.query("select public.ts_apply_moderation('buzz', $1, 'buzz', $2, null, $3::jsonb)", [b, AUTHOR2, JSON.stringify({
    events: [{ field: "body", action: "flag", visibility: "visible", category: "harassment_bullying", subcode: "targeted_insult", severity: "medium", ruleIds: ["har.test.v1"], matches: [], signals: {}, textHash: "abc", engineVersion: "1" }],
    queue: { source: "rule_flag", category: "harassment_bullying", severity: "medium", priority: "p2", label: null, ruleIds: ["har.test.v1"], aiVerdict: null },
  })]);
  await fileBuzzReport(R[0], "buzz", b);
  await fileBuzzReport(R[1], "buzz", b);
  check((await buzzStatus("buzz", b)) === "hidden", "a flagged buzz needed more than 2");
});
await expectOk("auto-hide: an approved buzz is immune to report-based auto-hide (reports still queue)", async () => {
  const b = await postBuzz(AUTHOR2, "the gym should open earlier during finals week, change my mind");
  await fileBuzzReport(R[0], "buzz", b);
  const q = (await sql1("select id from public.mod_queue where entity_type = 'buzz' and entity_id = $1 and status <> 'closed'", [b])).id;
  await call(MOD, "public.staff_act($1, 'approve', 'harassment_bullying', null, null, null)", [q]);
  for (const r of R.slice(1, 5)) await fileBuzzReport(r, "buzz", b);
  check((await buzzStatus("buzz", b)) === "active", "an approved buzz was hidden");
  check((await sql1("select count(*)::int as n from public.mod_queue where entity_type = 'buzz' and entity_id = $1 and status <> 'closed'", [b])).n === 1, "new reports did not queue");
});
await expectOk("auto-hide: public content has no hidden state, so the threshold raises its item to P1 instead (posts hide at 5)", async () => {
  const p = await postOf(PUB, "a perfectly normal post about the weather on campus");
  for (const r of R.slice(0, 5)) await as(r, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'harassment')", [r, p]));
  check((await sql1("select count(*)::int as n from public.feed_posts where id = $1", [p])).n === 1, "the post was deleted by reports");
  const q = await sql1("select priority from public.mod_queue where entity_type = 'post' and entity_id = $1", [p]);
  check(q.priority === "p1", "priority " + q.priority);
});

// =================================================================================================================
// 5. Posting status (mute / suspension / ban / warning) and the public-write guard
// =================================================================================================================
const posting = (uid, scope = "buzz") => sql1("select public.ts_posting_status($1, $2) as s", [uid, scope]).then((r) => r.s);
const sanction = async (uid, kind, { scope = "all", expires = "now() + interval '1 day'", effective = "now() - interval '1 minute'", origin = "public" } = {}) =>
  (await sql1(`insert into public.user_sanctions (user_id, kind, scope, origin, category, starts_at, effective_at, expires_at) values ($1, $2, $3, $4, 'spam_scam', ${effective}, ${effective}, ${kind === "mute" || kind === "suspension" ? expires : "null"}) returning id`, [uid, kind, scope, origin])).id;
await expectOk("posting: allowed with nothing on the account", async () => {
  const s = await posting(TARGET);
  check(s.allowed === true && s.reason === null && s.mutedUntil === null && s.warningId === null, JSON.stringify(s));
});
await expectOk("posting: a mute refuses with its end time; a Buzz-only mute leaves public posting alone", async () => {
  const id = await sanction(TARGET, "mute", { scope: "buzz_only" });
  const buzz = await posting(TARGET, "buzz");
  check(buzz.allowed === false && buzz.reason === "muted" && typeof buzz.mutedUntil === "number" && buzz.mutedUntil > Date.now(), JSON.stringify(buzz));
  check((await posting(TARGET, "public")).allowed === true, "a buzz_only mute blocked public posting");
  await db.query("update public.user_sanctions set lifted_at = now() where id = $1", [id]);
  check((await posting(TARGET)).allowed === true, "a lifted mute still blocks");
});
await expectOk("posting: a mute that has not started yet (anon-origin delay) does not block yet", async () => {
  const id = await sanction(TARGET, "mute", { effective: "now() + interval '20 minutes'" });
  check((await posting(TARGET)).allowed === true, "blocked before it started");
  await db.query("update public.user_sanctions set lifted_at = now() where id = $1", [id]);
});
await expectOk("posting: a suspension says suspended (until); a ban says banned and outranks it", async () => {
  const s1 = await sanction(TARGET, "suspension");
  const sus = await posting(TARGET);
  check(sus.allowed === false && sus.reason === "suspended" && sus.mutedUntil > Date.now(), JSON.stringify(sus));
  const b = await sanction(TARGET, "ban");
  const ban = await posting(TARGET);
  check(ban.allowed === false && ban.reason === "banned" && ban.mutedUntil === null, JSON.stringify(ban));
  await db.query("update public.user_sanctions set lifted_at = now() where id = any($1)", [[s1, b]]);
});
let WARNING;
await expectOk("posting: a warning not yet acknowledged blocks with its id; acknowledging it (ack_sanction) clears it", async () => {
  WARNING = await sanction(TARGET, "warning");
  const w = await posting(TARGET);
  check(w.allowed === false && w.reason === "warning" && w.warningId === WARNING, JSON.stringify(w));
  await as(TARGET, () => db.query("select public.ack_sanction($1)", [WARNING]));
  check((await posting(TARGET)).allowed === true, "still blocked after acknowledging");
});
await expectError("ack_sanction: someone else's notice is not found", () => as(USER, () => db.query("select public.ack_sanction($1)", [WARNING])), "ts:not_found:");
await expectOk("guard: a muted account cannot post, comment or list publicly, but still answers in its chats; a suspended one cannot message", async () => {
  const m = await sanction(TARGET, "mute");
  let msg = "";
  try { await as(TARGET, () => db.query("insert into public.feed_posts (author_id, body) values ($1, 'muted post attempt')", [TARGET])); } catch (e) { msg = e.message; }
  check(/You're muted right now/.test(msg), "post: " + (msg || "no error"));
  const conv = await as(TARGET, async () => (await one(db.query("select public.get_or_create_direct_conversation($1) as id", [USER]))).id);
  await as(TARGET, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'still talking in my chats')", [conv, TARGET]));
  await db.query("update public.user_sanctions set lifted_at = now() where id = $1", [m]);
  const s = await sanction(TARGET, "suspension");
  msg = "";
  try { await as(TARGET, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'suspended message attempt')", [conv, TARGET])); } catch (e) { msg = e.message; }
  check(/suspended/.test(msg), "message while suspended: " + (msg || "no error"));
  await db.query("update public.user_sanctions set lifted_at = now() where id = $1", [s]);
  await as(TARGET, () => db.query("insert into public.feed_posts (author_id, body) values ($1, 'back to normal')", [TARGET]));
});
await expectOk("writer context: posting status for Buzz, polls unlock, strike points, rule packs, recent hashes (blocked texts do not count)", async () => {
  await db.query("select public.ts_record_events('buzz', $1, 'buzz', $2, null, $3::jsonb)", [B_REPORTED, AUTHOR, JSON.stringify([{ field: "body", action: "allow", visibility: "visible", textHash: "hash-allowed" }])]);
  await callService("public.ts_record_blocked($1, 'buzz', 'blocked text here', $2::jsonb)", [AUTHOR, JSON.stringify({ events: [{ field: "body", action: "block", visibility: "visible", category: "spam_scam", textHash: "hash-blocked" }], queue: null })]);
  const ctx = await callService("public.ts_writer_context($1)", [AUTHOR]);
  check(ctx.recentHashes.includes("hash-allowed") && !ctx.recentHashes.includes("hash-blocked"), JSON.stringify(ctx.recentHashes));
  check(ctx.posting.allowed === true && ctx.posting.pollsUnlockAt === null && ctx.activeStrikePoints === 0 && ctx.countryCode === "US", JSON.stringify(ctx));
  check(ctx.enabledRulePacks.length === 12 && ctx.enabledRulePacks.includes("baseline") && ctx.disabledRulePacks.length === 0, JSON.stringify(ctx.enabledRulePacks));
  const fresh = await callService("public.ts_writer_context($1)", [NEW[0]]);
  check(typeof fresh.posting.pollsUnlockAt === "number" && fresh.treatedAsNew === true && fresh.accountAgeMs < 86400000, JSON.stringify(fresh));
});

// =================================================================================================================
// 6. Banned addresses cannot sign up again
// =================================================================================================================
await expectOk("ban: an admin's ban puts the address on the list; deleting the account does not free it; signing up again is refused", async () => {
  const victim = await person("banned", "Banned.Person@txstate.edu", "Banned Personson");
  await call(ADMIN, "public.staff_sanction($1, 'ban', null, 'all', 'hate', 'repeated hate speech after two suspensions')", [victim]);
  check((await sql1("select count(*)::int as n from public.banned_emails where email_hash = public.ts_email_hash('banned.person@txstate.edu')")).n === 1, "not on the list");
  check((await posting(victim)).reason === "banned", "posting still allowed");
  await db.query("delete from auth.users where id = $1", [victim]);
  let msg = "";
  try { await mk("banned.person@TXSTATE.edu", "Again Person"); } catch (e) { msg = e.message; }
  check(/can't be used to sign up/.test(msg), "re-registration: " + (msg || "allowed"));
  msg = "";
  try { await mk("someone@gmail.com", "Wrong Domain"); } catch (e) { msg = e.message; }
  check(/university email/.test(msg), "the university-domain check is gone: " + msg);
});
await expectOk("ban: lifting the last ban takes the address off the list", async () => {
  const v = await person("banned2", "second.banned@txstate.edu", "Second Bannedone");
  const detail = await call(ADMIN, "public.staff_sanction($1, 'ban', null, 'all', 'spam_scam', 'ban evasion confirmed by the team')", [v]);
  const ban = detail.sanctions.find((s) => s.kind === "ban");
  await call(ADMIN, "public.staff_lift($1, 'lifted after a second look at it')", [ban.id]);
  check((await sql1("select count(*)::int as n from public.banned_emails where email_hash = public.ts_email_hash('second.banned@txstate.edu')")).n === 0, "still on the list");
  check((await posting(v)).allowed === true, "still banned");
});

// =================================================================================================================
// 7. The queue: views, claim lease, conflict of interest, the moderator vs admin matrix, bulk
// =================================================================================================================
const queueIdOf = async (type, id) => (await sql1("select id from public.mod_queue where entity_type = $1 and entity_id = $2 order by created_at desc limit 1", [type, id])).id;
await expectOk("queue: a moderator sees the open items, priority first; the item carries no author, for Buzz or public content", async () => {
  const page = await call(MOD, "public.staff_queue('priority', 50, 0, '{}'::jsonb)");
  check(Array.isArray(page.items) && page.items.length > 0, JSON.stringify(page));
  const order = page.items.map((i) => i.priority);
  check(order.join() === [...order].sort().join(), "not priority-ordered: " + order.join());
  for (const item of page.items) noForbiddenKeys("queue item", item);
  const buzz = page.items.find((i) => i.entityId === B_REPORTED);
  check(buzz && buzz.anon === true && buzz.excerpt.includes("dining hall") && buzz.reportCount >= 1 && buzz.createdAt % 60000 === 0, JSON.stringify(buzz));
  const counts = await call(MOD, "public.staff_queue_counts()");
  check(counts.priority === page.items.length && typeof counts.held === "number" && typeof counts.auto_hidden === "number" && counts.wellbeing >= 1, JSON.stringify(counts));
});
await expectOk("queue: auto_hidden lists hidden Buzz, wellbeing the self-harm items, reports the reported ones", async () => {
  const hidden = await call(MOD, "public.staff_queue('auto_hidden', 50, 0, '{}'::jsonb)");
  check(hidden.items.length >= 1 && hidden.items.every((i) => i.contentStatus === "hidden" || ["community_score", "ai_flag"].includes(i.source)), JSON.stringify(hidden.items));
  const wb = await call(MOD, "public.staff_queue('wellbeing', 50, 0, '{}'::jsonb)");
  check(wb.items.length >= 1 && wb.items.every((i) => i.label === "wellbeing"), JSON.stringify(wb.items));
  const rep = await call(MOD, "public.staff_queue('reports', 50, 0, '{}'::jsonb)");
  check(rep.items.every((i) => i.reportCount > 0 || i.source === "user_report"), "reports view");
});
await expectOk("claim: opening an item claims it for 10 minutes; another moderator sees 'being reviewed' and cannot act; after the lease they can", async () => {
  const p = await postOf(PUB, "lease probe post that someone reported for spam");
  await as(R[3], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')", [R[3], p]));
  const q = await queueIdOf("post", p);
  const mine = await call(MOD, "public.staff_queue_item($1)", [q]);
  check(mine.claimedByMe === true && mine.status === "claimed", JSON.stringify({ c: mine.claimedByMe, s: mine.status }));
  const theirs = await call(MOD2, "public.staff_queue_item($1)", [q]);
  check(theirs.claimedByOther === true && theirs.claimedByMe === false, "MOD2 view");
  let msg = "";
  try { await call(MOD2, "public.staff_act($1, 'approve', 'spam_scam', null, null, null)", [q]); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:conflict:Being reviewed"), "act while claimed: " + msg);
  msg = "";
  try { await call(MOD2, "public.staff_claim($1)", [q]); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:conflict:"), "claim while claimed: " + msg);
  const mineView = await call(MOD, "public.staff_queue('mine', 50, 0, '{}'::jsonb)");
  check(mineView.items.some((i) => i.id === q), "not in Mine");
  await db.query("update public.mod_queue set claimed_at = now() - interval '11 minutes' where id = $1", [q]);
  const done1 = await call(MOD2, "public.staff_act($1, 'approve', 'spam_scam', null, null, null)", [q]);
  check(done1.status === "closed" && done1.resolution === "approved", JSON.stringify({ s: done1.status, r: done1.resolution }));
  const rep = await sql1("select status, closed_at from public.reports where target_id = $1", [p]);
  check(rep.status === "dismissed" && rep.closed_at, JSON.stringify(rep));
  const n = await sql1("select * from public.notifications where user_id = $1 and type = 'moderation' order by created_at desc limit 1", [R[3]]);
  check(n && /didn't find a violation/.test(n.title) && n.actor_id === null && n.data.outcome === "no_violation", JSON.stringify(n));
});
await expectOk("conflict of interest: a moderator who reported an item neither sees nor acts on it; another one does", async () => {
  const p = await postOf(PUB, "conflict of interest probe post");
  await as(MOD, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'harassment')", [MOD, p]));
  const q = await queueIdOf("post", p);
  let msg = "";
  try { await call(MOD, "public.staff_queue_item($1)", [q]); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:not_found:"), "detail: " + msg);
  msg = "";
  try { await call(MOD, "public.staff_act($1, 'approve', 'harassment_bullying', null, null, null)", [q]); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:not_found:"), "act: " + msg);
  const list = await call(MOD, "public.staff_queue('priority', 100, 0, '{}'::jsonb)");
  check(!list.items.some((i) => i.id === q), "listed for the reporter");
  check((await call(MOD2, "public.staff_queue_item($1)", [q])).id === q, "MOD2 cannot see it");
  await call(MOD2, "public.staff_release($1)", [q]);
});
await expectOk("matrix: admin-only functions answer moderators 'not found'; admin-only actions answer 'forbidden'", async () => {
  for (const expr of ["public.staff_rule_packs()", "public.staff_set_rule_pack('admin.spam', false, null)", `public.staff_grant_role('${USER}', 'moderator')`,
    "public.staff_lift('x', 'a long enough note')", `public.staff_unmask('buzz', '${B_REPORTED}', 'credible_threat', '${"x".repeat(40)}', 'UNMASK', null)`]) {
    let msg = "";
    try { await call(MOD, expr); } catch (e) { msg = e.message; }
    check(msg.startsWith("ts:not_found:"), `${expr} as moderator: ${msg || "no error"}`);
  }
  const p = await postOf(PUB, "matrix probe post to act on");
  await as(R[4], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'harassment')", [R[4], p]));
  const q = await queueIdOf("post", p);
  for (const action of ["suspend_7d", "suspend_30d", "ban", "escalate_external", "lift_sanction"]) {
    let msg = "";
    try { await call(MOD, "public.staff_act($1, $2, 'harassment_bullying', $3, $4::jsonb, null)", [q, action, "n".repeat(40), JSON.stringify({ confirmText: "BAN", reference: "X-1" })]); } catch (e) { msg = e.message; }
    check(msg === "ts:forbidden:Admins only.", `${action}: ${msg || "no error"}`);
  }
  const packs = await call(ADMIN, "public.staff_rule_packs()");
  check(packs.length === 12 && packs.every((x) => x.enabled), JSON.stringify(packs));
  await call(MOD, "public.staff_release($1)", [q]);
});
await expectOk("validation: notes, unknown actions, the typed BAN, the outside reference, and wellbeing never sanctions", async () => {
  const p = await postOf(PUB, "validation probe post");
  await as(R[4], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'harassment')", [R[4], p]));
  const q = await queueIdOf("post", p);
  const attempt = async (action, category, note, opts) => { try { await call(ADMIN, "public.staff_act($1, $2, $3, $4, $5::jsonb, null)", [q, action, category, note, JSON.stringify(opts ?? {})]); return "ok"; } catch (e) { return e.message; } };
  check((await attempt("remove", "harassment_bullying", null)).includes("Add a note"), "remove without a note");
  check((await attempt("nuke", "harassment_bullying", null)).includes("Unknown action"), "unknown action");
  check((await attempt("remove", "not_a_category", "a long enough note")).includes("Pick the guideline"), "bad category");
  check((await attempt("ban", "harassment_bullying", "n".repeat(40))).includes("Type BAN"), "ban without BAN");
  check((await attempt("ban", "harassment_bullying", "too short ban", { confirmText: "BAN" })).includes("at least 30"), "short ban note");
  check((await attempt("escalate_external", "harassment_bullying", "n".repeat(20))).includes("reference"), "no reference");
  check((await attempt("remove_and_warn", "self_harm", "n".repeat(20))).includes("never sanction"), "self-harm sanction");
  await call(ADMIN, "public.staff_release($1)", [q]);
});
await expectOk("remove + mute on public content: deleted, a strike, a mute, reporters told it was actioned; history without actor names for moderators", async () => {
  const p = await postOf(PUB, "rude post that gets removed by an admin");
  await as(R[4], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'harassment')", [R[4], p]));
  const q = await queueIdOf("post", p);
  await db.query("update public.mod_queue set severity = 'high' where id = $1", [q]);
  const d = await call(ADMIN, "public.staff_act($1, 'remove_and_mute_24h', 'harassment_bullying', 'clearly targeted at a classmate', null, null)", [q]);
  check(d.status === "closed" && d.resolution === "sanctioned", JSON.stringify({ s: d.status, r: d.resolution }));
  check((await sql1("select count(*)::int as n from public.feed_posts where id = $1", [p])).n === 0, "not deleted");
  const strike = await sql1("select points, origin from public.strikes where user_id = $1 and entity_id = $2", [PUB, p]);
  check(strike.points === 3 && strike.origin === "public", JSON.stringify(strike));
  const mute = await sql1("select * from public.user_sanctions where user_id = $1 and kind = 'mute' and lifted_at is null", [PUB]);
  check(mute && mute.origin === "public" && Math.round((new Date(mute.expires_at) - new Date(mute.effective_at)) / 3600000) === 24 && new Date(mute.effective_at) <= new Date(), JSON.stringify(mute));
  check((await sql1("select status from public.reports where reporter_id = $1 and target_id = $2", [R[4], p])).status === "actioned", "report not actioned");
  const notice = await sql1("select title from public.notifications where user_id = $1 and type = 'moderation' and data ->> 'event' = 'content_removed' order by created_at desc limit 1", [PUB]);
  check(/was removed for breaking our guideline on Harassment & bullying/.test(notice.title), JSON.stringify(notice));
  const asMod = await call(MOD, "public.staff_queue('closed', 50, 0, $1::jsonb)", [JSON.stringify({ q: String(q).slice(0, 8) })]);
  check(asMod.items.some((i) => i.id === q), "closed view by id prefix");
  const detail = await call(MOD, "public.staff_queue_item($1)", [q]);
  check(detail.history[0].actorName === null && detail.history[0].actorRole === "admin", JSON.stringify(detail.history));
  check(detail.author.kind === "public" && detail.author.user.id === PUB && detail.author.sanctions.some((s) => s.kind === "mute"), JSON.stringify(detail.author));
  await db.query("update public.user_sanctions set lifted_at = now() where user_id = $1", [PUB]);
});
await expectOk("lock_thread only on Buzz roots; escalate leaves the moderator queues; zero tolerance suspends", async () => {
  const b = await postBuzz(AUTHOR2, "a thread that keeps getting heated in the replies");
  await fileBuzzReport(R[0], "buzz", b);
  const qb = await queueIdOf("buzz", b);
  const locked = await call(MOD, "public.staff_act($1, 'lock_thread', 'harassment_bullying', 'locking the pile-on here', null, null)", [qb]);
  check(locked.status !== "closed", "locking closed the item");
  if (!V2) check((await sql1("select locked from public.buzz_posts where id = $1", [b])).locked === true, "not locked");
  await call(MOD, "public.staff_act($1, 'unlock_thread', 'harassment_bullying', 'unlocking it again now', null, null)", [qb]);
  if (!V2) check((await sql1("select locked from public.buzz_posts where id = $1", [b])).locked === false, "not unlocked");
  const p = await postOf(PUB, "post to escalate to an admin");
  await as(R[1], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'harassment')", [R[1], p]));
  const qp = await queueIdOf("post", p);
  let msg = "";
  try { await call(MOD, "public.staff_act($1, 'lock_thread', 'harassment_bullying', 'locking the pile-on here', null, null)", [qp]); } catch (e) { msg = e.message; }
  check(msg.includes("Only Buzz threads"), "lock on a post: " + msg);
  const esc = await call(MOD, "public.staff_act($1, 'escalate', 'harassment_bullying', 'needs admin eyes on this', null, null)", [qp]);
  check(esc.status === "escalated", "not escalated");
  msg = "";
  try { await call(MOD, "public.staff_queue_item($1)", [qp]); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:not_found:"), "the moderator still sees the escalated item");
  check((await call(ADMIN, "public.staff_queue('escalated', 50, 0, '{}'::jsonb)")).items.some((i) => i.id === qp), "not in the admin's Escalated");
  check((await call(MOD, "public.staff_queue('escalated', 50, 0, '{}'::jsonb)")).items.length === 0, "moderators see Escalated");
  const z = await postOf(USER, "a post that turns out to be zero tolerance");
  await as(R[2], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'minor_safety')", [R[2], z]));
  const qz = await queueIdOf("post", z);
  await call(MOD, "public.staff_act($1, 'remove', 'sexual_minors', 'zero tolerance content here', null, null)", [qz]);
  check((await posting(USER)).reason === "suspended", "zero tolerance did not suspend");
  await db.query("update public.user_sanctions set lifted_at = now() where user_id = $1", [USER]);
});
await expectOk("bulk: 1-50 ids; P0 and wellbeing items are skipped; one audit row per item, sharing the batch id", async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const p = await postOf(PUB, `bulk probe post ${i}`);
    await as(R[0], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')", [R[0], p]));
    ids.push(await queueIdOf("post", p));
  }
  const wb = (await rows(db.query("select id from public.mod_queue where label = 'wellbeing' and status <> 'closed' limit 1")))[0].id;
  let msg = "";
  try { await call(MOD, "public.staff_bulk($1::uuid[], 'approve', 'spam_scam', null)", [Array.from({ length: 51 }, () => NIL)]); } catch (e) { msg = e.message; }
  check(msg.includes("between 1 and 50"), "51 ids: " + msg);
  const res = await call(MOD, "public.staff_bulk($1::uuid[], 'approve', 'spam_scam', null)", [[...ids, wb, NIL]]);
  const by = new Map(res.results.map((r) => [r.id, r]));
  for (const id of ids) check(by.get(id)?.ok === true, "not approved: " + JSON.stringify(by.get(id)));
  check(by.get(wb)?.error === "not_bulk_eligible" && by.get(NIL)?.error === "not_found", JSON.stringify(res.results));
  check((await sql1("select count(*)::int as n from public.audit_log where batch_id = $1", [res.batchId])).n === 3, "audit rows per batch");
});

// =================================================================================================================
// 8. The named-account firewall (UniVerse's named-account firewall test + hardening/buzz-staff-firewall)
// =================================================================================================================
const FIREWALL_TEXT = "zq firewall probe text kilo lima about the fourth floor";
const BF = await postBuzz(AUTHOR, FIREWALL_TEXT);
const REPLY = await replyBuzz(AUTHOR, BF, "zq reply probe from the same author in this thread");
await fileBuzzReport(F1, "buzz", BF, "harassment", "they keep doing this every week, ask zelda.q@txstate.edu");
const QF = await queueIdOf("buzz", BF);
await db.query("update public.mod_queue set severity = 'high', category = 'harassment_bullying' where id = $1", [QF]);
await fileBuzzReport(F2, "buzz_reply", REPLY);
const QR = await queueIdOf("buzz_reply", REPLY);
let before;
await expectOk("firewall: list and detail of a Buzz item are blind for moderators AND admins (no author, no reporter, blind panel)", async () => {
  before = await call(MOD, "public.staff_user($1)", [AUTHOR]);
  check(before.strikePoints === 0 && before.openQueueItems === 0 && before.sanctions.length === 0 && before.email === null, JSON.stringify(before));
  for (const who of [MOD, ADMIN]) {
    const list = await call(who, "public.staff_queue('priority', 100, 0, '{}'::jsonb)");
    noIdentity("queue list", list, ["author"]);
    const d = await call(who, "public.staff_queue_item($1)", [QF]);
    noIdentity("queue detail", d, ["author", "f1"]);
    noForbiddenKeys("queue detail", d);
    check(d.author.kind === "blind" && ["30d+", "<30d"].includes(d.author.accountAge) && d.author.strikePoints === "0", JSON.stringify(d.author));
    check(d.fields.some((f) => f.text.includes("zq firewall probe")), "the content is missing for staff");
    check(d.reports.length === 1 && d.reports[0].reporter === null && d.reports[0].reporterTrust === "normal" && d.reports[0].note.includes("[email]"), JSON.stringify(d.reports));
    check(d.canUnmask === (who === ADMIN), "canUnmask for " + who);
    check(/^Strike points after this violation: (0|1|2|3-5|6\+) → /.test(d.suggestion?.reason ?? ""), "the hint quotes an exact tally: " + JSON.stringify(d.suggestion));
    check(d.context && d.context.root, "no blind thread context");
    await call(who, "public.staff_release($1)", [QF]);
  }
  check((await sql1("select count(*)::int as n from public.audit_log where action = 'reporter_viewed'")).n === 0, "reporter identity was looked at on Buzz");
});
let acted;
await expectOk("firewall: a moderator removes and mutes the buzz's author blind; the answer names nobody", async () => {
  acted = await call(MOD, "public.staff_act($1, 'remove_and_mute_24h', 'harassment_bullying', 'pile-on call aimed at a floor mate @someone', null, null)", [QF]);
  noIdentity("action answer", acted, ["author"]);
  noForbiddenKeys("action answer", acted);
  check(acted.resolution === "sanctioned" && acted.history.every((h) => h.actorName === null), JSON.stringify(acted.history));
  check(acted.history.some((h) => (h.note ?? "").includes("@…")), "the note kept a handle: " + JSON.stringify(acted.history));
  check((await buzzStatus("buzz", BF)) === "removed", "not removed");
  const mute = await sql1("select * from public.user_sanctions where user_id = $1 and kind = 'mute'", [AUTHOR]);
  check(mute.origin === "anon", "origin " + mute.origin);
  const delayMin = (new Date(mute.effective_at) - new Date(mute.created_at)) / 60000;
  check(delayMin >= 4.9 && delayMin <= 30.1, `a non-P0 Buzz mute must start 5-30 minutes later, not ${delayMin}`);
  const notice = await sql1("select visible_at from public.notifications where user_id = $1 and data ->> 'event' = 'muted'", [AUTHOR]);
  check(new Date(notice.visible_at).getTime() === new Date(mute.effective_at).getTime(), "the mute notice shows before the mute starts");
  check((await sql1("select origin from public.strikes where user_id = $1", [AUTHOR])).origin === "anon", "strike origin");
  const userTargeted = await sql1("select count(*)::int as n from public.audit_log a join public.mod_queue q on q.id = a.queue_id where q.entity_type in ('buzz','buzz_reply') and a.target_type = 'user'");
  check(userTargeted.n === 0, "a user-targeted audit row exists for a Buzz item");
  const leaked = await sql1("select count(*)::int as n from public.audit_log where metadata::text like '%' || $1 || '%'", [AUTHOR]);
  check(leaked.n === 0, "the author's id is in audit metadata");
});
await expectOk("firewall: nothing a moderator sees about the author moved; no Buzz text, no anon-origin row, no user-targeted audit row", async () => {
  const after = await call(MOD, "public.staff_user($1)", [AUTHOR]);
  check(JSON.stringify(after) === JSON.stringify(before), "moderator view changed: " + JSON.stringify({ before, after }));
  const search = await call(MOD, "public.staff_users('Zelda', 20, 0)");
  check(search.items.some((u) => u.user.id === AUTHOR), "search");
  const audit = await call(MOD, "public.staff_audit(200, 0, '{}'::jsonb)");
  check(audit.items.length > 0, "no audit rows for the moderator");
  for (const body of [after, search, audit]) check(!JSON.stringify(body).includes("zq firewall"), "Buzz text in a named payload");
  for (const row of audit.items) {
    check(!(row.targetType === "user" && row.targetId === AUTHOR), "user-targeted row: " + JSON.stringify(row));
    check(!JSON.stringify(row.metadata ?? {}).includes(AUTHOR), "author in metadata: " + JSON.stringify(row));
  }
  noIdentity("moderator audit", audit, ["author"]);
  for (const view of ["priority", "wellbeing", "held", "auto_hidden", "reports", "escalated", "appeals", "mine", "closed"]) {
    noIdentity(`queue view ${view}`, await call(MOD, `public.staff_queue('${view}', 100, 0, '{}'::jsonb)`), ["author"]);
  }
  const reply = await call(MOD, "public.staff_queue_item($1)", [QR]);
  noIdentity("reply detail", reply, ["author"]);
  check(reply.author.kind === "blind" && reply.author.strikePoints === "3-5" && reply.author.sanction === null, JSON.stringify(reply.author));
  await call(MOD, "public.staff_release($1)", [QR]);
});
await expectOk("firewall: on a PUBLIC item by the same author, a moderator's ladder hint counts public-origin strikes only (it agrees with the panel); an admin's counts all", async () => {
  const p = await postOf(AUTHOR, "a public post by the same author as the buzz");
  await as(R[4], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'harassment')", [R[4], p]));
  const q = await queueIdOf("post", p);
  await db.query("update public.mod_queue set severity = 'medium' where id = $1", [q]);
  const asMod = await call(MOD2, "public.staff_queue_item($1)", [q]);
  await call(MOD2, "public.staff_release($1)", [q]);
  check(asMod.author.kind === "public" && asMod.author.strikePoints === 0, JSON.stringify(asMod.author));
  check(/^2 active strike points after this violation/.test(asMod.suggestion?.reason ?? ""), "moderator hint: " + JSON.stringify(asMod.suggestion));
  const asAdmin = await call(ADMIN2, "public.staff_queue_item($1)", [q]);
  await call(ADMIN2, "public.staff_release($1)", [q]);
  check(/^5 active strike points after this violation/.test(asAdmin.suggestion?.reason ?? ""), "admin hint: " + JSON.stringify(asAdmin.suggestion));
  check(asAdmin.author.sanctions.some((s) => s.origin === "anon") && !asMod.author.sanctions.some((s) => s.origin === "anon"), "anon-origin rows on the public author panel");
  check(!JSON.stringify(asMod).includes("zq firewall") && !JSON.stringify(asAdmin).includes("zq firewall"), "Buzz text on a public item's author panel");
});
await expectOk("firewall: the blind panel moves with Buzz history only, never with what staff do to the named account (no oracle)", async () => {
  const base = await call(MOD2, "public.staff_queue_item($1)", [QR]);
  await call(MOD2, "public.staff_release($1)", [QR]);
  await call(MOD2, "public.staff_sanction($1, 'mute', 3600000, 'all', 'spam_scam', 'probe: repeated low-effort spam')", [AUTHOR]);
  await call(MOD2, "public.staff_sanction($1, 'warning', null, 'all', 'spam_scam', 'probe: repeated low-effort spam')", [AUTHOR]);
  const after = await call(MOD2, "public.staff_queue_item($1)", [QR]);
  await call(MOD2, "public.staff_release($1)", [QR]);
  check(JSON.stringify({ a: base.author, s: base.suggestion }) === JSON.stringify({ a: after.author, s: after.suggestion }), "the blind panel reacted to a public sanction: " + JSON.stringify([base.author, after.author, base.suggestion, after.suggestion]));
  await db.query("update public.user_sanctions set lifted_at = now() where user_id = $1 and origin = 'public'", [AUTHOR]);
});
await expectOk("firewall: admins see the anon-origin rows on the account, sealed, day-floored, without the excerpt; the true strike total; the email", async () => {
  const asAdmin = await call(ADMIN, "public.staff_user($1)", [AUTHOR]);
  const anon = asAdmin.sanctions.filter((s) => s.origin === "anon");
  check(anon.some((s) => s.kind === "mute") && anon.some((s) => s.kind === "removal"), JSON.stringify(asAdmin.sanctions));
  for (const s of anon) {
    check(!("contentExcerpt" in s) && !("contentLabel" in s), "excerpt on a staff row");
    check(s.id.startsWith("sx_") && s.startsAt % 86400000 === 0 && s.createdAt % 86400000 === 0, JSON.stringify(s));
  }
  check(asAdmin.strikePoints === 3 && asAdmin.email === people.author.email, JSON.stringify(asAdmin));
  check(!JSON.stringify(asAdmin).includes("zq firewall"), "Buzz text on the admin's user page");
  const audit = await call(ADMIN, "public.staff_audit(200, 0, $1::jsonb)", [JSON.stringify({ action: "sanction_apply" })]);
  const row = audit.items.find((r) => r.targetId === BF);
  check(row && row.metadata.sanctionId, "the content-targeted sanction row");
  check(!asAdmin.sanctions.some((s) => s.id === row.metadata.sanctionId), "the user page shows the raw anon-origin sanction id (joinable without unmask)");
  const blind = await call(ADMIN, "public.staff_lift($1, 'lifting to review the context of it')", [row.metadata.sanctionId]);
  check(blind.lifted === true && blind.origin === "anon" && !("user" in blind), "a raw-id lift named the account: " + JSON.stringify(blind));
  noIdentity("raw-id lift", blind, ["author"]);
});

// =================================================================================================================
// 9. Appeals: blind, reviewer is not the actor
// =================================================================================================================
let APPEAL;
await expectOk("appeals: the author sees their removal notice (with their own excerpt) and appeals it; a staff appeal item is blind", async () => {
  const mine = await call(AUTHOR, "public.my_sanctions()");
  const removal = mine.find((s) => s.kind === "removal");
  check(removal && removal.contentExcerpt.includes("zq firewall") && removal.canAppeal && removal.guidelineAnchor === "harassment", JSON.stringify(mine));
  const receipt = await call(AUTHOR, "public.submit_appeal($1, $2)", [removal.id, "That was a joke among friends on the floor, nobody was hurt."]);
  APPEAL = receipt.id;
  check(receipt.status === "open", JSON.stringify(receipt));
  const n = await sql1("select title from public.notifications where user_id = $1 and data ->> 'event' = 'appeal_received'", [AUTHOR]);
  check(n && /received your appeal/.test(n.title), "no receipt notice");
  const staffNotice = await sql1("select count(*)::int as n from public.notifications where user_id = $1 and type = 'staff' and data ->> 'event' = 'appeal_new'", [MOD2]);
  check(staffNotice.n === 1, "the possible reviewer was not told");
  check((await sql1("select count(*)::int as n from public.notifications where user_id = $1 and data ->> 'event' = 'appeal_new'", [MOD])).n === 0, "the actor was told to review their own action");
  for (const who of [MOD, MOD2, ADMIN]) {
    const list = await call(who, "public.staff_appeals('open', 50, 0)");
    noIdentity("appeals list", list, ["author"]);
    noForbiddenKeys("appeals list", list);
    const a = list.items.find((x) => x.id === APPEAL);
    check(a && a.sanction.origin === "anon" && a.sanction.id === APPEAL && a.createdAt % 86400000 === 0 && a.contentExcerpt.includes("zq firewall"), JSON.stringify(a));
    check(a.canReview === (who !== MOD), `canReview for ${who}: ${a.canReview}`);
    const item = await call(who, "public.staff_queue_item($1)", [a.queueId]);
    noIdentity("appeal queue item", item, ["author"]);
    check(item.author.kind === "blind", "the appeal item names the author");
    await call(who, "public.staff_release($1)", [a.queueId]);
  }
});
await expectError("appeals: the moderator who acted cannot decide it", () => call(MOD, "public.staff_decide_appeal($1, 'reversed', 'we got this one wrong', null)", [APPEAL]), "ts:forbidden:A different staff member must review this appeal.");
await expectError("appeals: one per notice", async () => {
  const removal = (await call(AUTHOR, "public.my_sanctions()")).find((s) => s.kind === "removal");
  await call(AUTHOR, "public.submit_appeal($1, $2)", [removal.id, "Please look again at this one, it was a joke."]);
}, "ts:conflict:You already appealed this notice.");
await expectOk("appeals: another moderator reverses it; content back up, strike revoked, notice lifted, the author told; decided once", async () => {
  const decided = await call(MOD2, "public.staff_decide_appeal($1, 'reversed', 'public figure, no classmate named', null)", [APPEAL]);
  check(decided.status === "reversed", JSON.stringify(decided));
  check((await buzzStatus("buzz", BF)) === "active", "content not restored");
  check((await sql1("select public.ts_strike_points($1) as p", [AUTHOR])).p === 0, "strike not revoked");
  const n = await sql1("select title from public.notifications where user_id = $1 and data ->> 'event' = 'appeal_result'", [AUTHOR]);
  check(/accepted/.test(n.title), JSON.stringify(n));
  check((await sql1("select status from public.mod_queue where appeal_id = $1", [APPEAL])).status === "closed", "the appeal item is open");
  check((await sql1("select count(*)::int as n from public.audit_log where action = 'appeal_decide' and target_id = $1", [String(APPEAL)])).n === 1, "not audited");
  let msg = "";
  try { await call(ADMIN, "public.staff_decide_appeal($1, 'upheld', 'already decided here', null)", [APPEAL]); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:conflict:"), "decided twice: " + msg);
});
await expectOk("appeals: warnings cannot be appealed; appeals need 10+ characters; suspension appeals are for admins", async () => {
  const w = await sanction(AUTHOR2, "warning");
  let msg = "";
  try { await call(AUTHOR2, "public.submit_appeal($1, $2)", [w, "I disagree with this warning entirely."]); } catch (e) { msg = e.message; }
  check(msg.includes("Warnings can't be appealed"), "warning: " + msg);
  await as(AUTHOR2, () => db.query("select public.ack_sanction($1)", [w]));
  const p = await postOf(PUB, "a post that gets an admin suspension");
  await as(R[2], () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'threat')", [R[2], p]));
  const q = await queueIdOf("post", p);
  await call(ADMIN, "public.staff_act($1, 'suspend_7d', 'threat_violence', 'credible enough to suspend', null, null)", [q]);
  const s = (await call(PUB, "public.my_sanctions()")).find((x) => x.kind === "suspension");
  msg = "";
  try { await call(PUB, "public.submit_appeal($1, 'short')", [s.id]); } catch (e) { msg = e.message; }
  check(msg.includes("at least 10"), "short appeal: " + msg);
  const r = await call(PUB, "public.submit_appeal($1, $2)", [s.id, "I would like a second look at this decision please."]);
  const modView = (await call(MOD, "public.staff_appeals('open', 50, 0)")).items.find((x) => x.id === r.id);
  check(modView && modView.canReview === false && modView.sanction.origin === "public", JSON.stringify(modView));
  msg = "";
  try { await call(MOD, "public.staff_decide_appeal($1, 'upheld', 'stands as decided', null)", [r.id]); } catch (e) { msg = e.message; }
  check(msg.includes("admin only"), "moderator decided a suspension appeal: " + msg);
  msg = "";
  try { await call(ADMIN, "public.staff_decide_appeal($1, 'upheld', 'stands as decided', null)", [r.id]); } catch (e) { msg = e.message; }
  check(msg.includes("different staff member"), "the acting admin decided: " + msg);
  const reduced = await call(ADMIN2, "public.staff_decide_appeal($1, 'reduced', 'shorter is enough for this one', $2)", [r.id, Date.now() + 3600000]);
  check(reduced.status === "reduced", JSON.stringify(reduced));
  const left = await posting(PUB);
  check(left.reason === "suspended" && left.mutedUntil < Date.now() + 2 * 3600000, JSON.stringify(left));
  await db.query("update public.user_sanctions set lifted_at = now() where user_id = $1", [PUB]);
});

// =================================================================================================================
// 10. Unmask: admins only, a reason, typed UNMASK, audited first, every other admin told, 10 a day
// =================================================================================================================
const UB = await postBuzz(AUTHOR2, "do not come to the engineering building tomorrow, trust me");
await fileBuzzReport(R[3], "buzz", UB, "threat");
const UQ = await queueIdOf("buzz", UB);
const GOOD_REASON = "Vague warning to avoid a building tomorrow; campus safety asked us to identify the account tonight.";
const unmask = (uid, type, id, code, reason, confirm, caseRef = null) => call(uid, "public.staff_unmask($1, $2, $3, $4, $5, $6)", [type, id, code, reason, confirm, caseRef]);
const unmaskRows = () => rows(db.query("select * from public.audit_log where action in ('buzz_unmask', 'buzz_unmask_subject') order by seq"));
await expectOk("unmask: moderators get 'not found'; a short reason, padding, no UNMASK, a bad code, the wrong type or no queue item are refused, and none writes an audit row", async () => {
  const tries = [
    [MOD, "buzz", UB, "credible_threat", GOOD_REASON, "UNMASK", "ts:not_found:"],
    [ADMIN, "buzz", UB, "credible_threat", "too short", "UNMASK", "ts:validation_failed:Write at least 30"],
    [ADMIN, "buzz", UB, "credible_threat", `   ${"y".repeat(25)}        `, "UNMASK", "ts:validation_failed:Write at least 30"],
    [ADMIN, "buzz", UB, "credible_threat", GOOD_REASON, "unmask", "ts:validation_failed:Type UNMASK"],
    [ADMIN, "buzz", UB, "credible_threat", GOOD_REASON, null, "ts:validation_failed:Type UNMASK"],
    [ADMIN, "buzz", UB, "curiosity", GOOD_REASON, "UNMASK", "ts:validation_failed:Pick a reason code"],
    [ADMIN, "post", UB, "credible_threat", GOOD_REASON, "UNMASK", "ts:validation_failed:"],
    [ADMIN, "buzz", await postBuzz(AUTHOR2, "a buzz nobody ever reported or flagged"), "credible_threat", GOOD_REASON, "UNMASK", "ts:not_found:No queue item"],
  ];
  for (const [who, type, id, code, reason, confirm, expected] of tries) {
    let msg = "";
    try { await unmask(who, type, id, code, reason, confirm); } catch (e) { msg = e.message; }
    check(msg.startsWith(expected), `${expected}: got ${msg || "no error"}`);
    check(!identityOf("author2").some((s) => msg.includes(s)), "an error message names the author");
  }
  check((await unmaskRows()).length === 0, "a refused unmask wrote an audit row");
});
await expectOk("unmask: the audit row is written BEFORE the author is looked up (a probe in the adapter checks it)", async () => {
  const def = (await sql1("select pg_get_functiondef('public.buzz_v2_author_of(text,uuid)'::regprocedure) as d")).d;
  await db.exec(`
    alter function public.buzz_v2_author_of(text, uuid) rename to buzz_v2_author_of_real;
    create function public.buzz_v2_author_of(p_entity_type text, p_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
    begin
      if not exists (select 1 from public.audit_log a where a.action = 'buzz_unmask' and a.target_id = p_id::text) then
        raise exception 'probe: the author was looked up before the buzz_unmask audit row';
      end if;
      return public.buzz_v2_author_of_real(p_entity_type, p_id);
    end $$;`);
  try {
    const u = await unmask(ADMIN, "buzz", UB, "credible_threat", GOOD_REASON, "UNMASK", "CASE-17");
    check(u.user.id === AUTHOR2 && u.user.email === people.author2.email && u.user.username === people.author2.username && u.user.fullName === people.author2.full_name, JSON.stringify(u));
    check(typeof u.user.universityName === "string" && typeof u.user.createdAt === "number", JSON.stringify(u.user));
    check(u.expiresAt - Date.now() > 4 * 60000 && u.expiresAt - Date.now() <= 5 * 60000 + 5000, "expiresAt " + u.expiresAt);
    const audit = await unmaskRows();
    check(audit.map((a) => a.action).join() === "buzz_unmask,buzz_unmask_subject", audit.map((a) => a.action).join());
    check(audit[0].id === u.auditId && audit[0].reason === GOOD_REASON && audit[0].reason_code === "credible_threat" && audit[0].queue_id === UQ && audit[0].metadata.caseRef === "CASE-17", JSON.stringify(audit[0]));
    check(Number(audit[0].seq) < Number(audit[1].seq), "the subject row came first");
    check(audit[1].metadata.unmaskId === u.auditId && typeof audit[1].metadata.subjectTag === "string" && audit[1].metadata.subjectTag.length === 32, JSON.stringify(audit[1].metadata));
    for (const a of audit) for (const s of identityOf("author2")) check(!JSON.stringify(a).includes(s), "the audit trail stores the identity readably");
  } finally {
    await db.exec(`drop function public.buzz_v2_author_of(text, uuid); alter function public.buzz_v2_author_of_real(text, uuid) rename to buzz_v2_author_of;`);
    if ((await sql1("select pg_get_functiondef('public.buzz_v2_author_of(text,uuid)'::regprocedure) as d")).d !== def) throw new Error("the adapter was not restored");
  }
});
await expectOk("unmask: every other admin is told (no identity), the unmasking admin is not; moderators never see the rows", async () => {
  const alert = await sql1("select * from public.notifications where user_id = $1 and type = 'staff' and data ->> 'event' = 'unmask_alert'", [ADMIN2]);
  check(alert && alert.title === "An admin unmasked a Buzz author · credible_threat" && alert.link === "/admin/audit" && alert.actor_id === null, JSON.stringify(alert));
  noIdentity("unmask alert", alert, ["author2"]);
  check((await sql1("select count(*)::int as n from public.notifications where user_id = $1 and data ->> 'event' = 'unmask_alert'", [ADMIN])).n === 0, "the unmasking admin was alerted");
  check((await sql1("select count(*)::int as n from public.notifications where user_id = any($1) and data ->> 'event' = 'unmask_alert'", [[MOD, MOD2]])).n === 0, "moderators were alerted");
  const modAudit = await call(MOD, "public.staff_audit(200, 0, $1::jsonb)", [JSON.stringify({ action: "buzz_unmask" })]);
  check(modAudit.items.length === 0, "a moderator reads buzz_unmask rows");
  const adminAudit = await call(ADMIN2, "public.staff_audit(200, 0, $1::jsonb)", [JSON.stringify({ action: "buzz_unmask_subject" })]);
  check(adminAudit.items.length === 1, "admins read the subject row");
  noIdentity("admin audit of the subject row", adminAudit, ["author2"]);
  const metrics = await call(MOD, "public.staff_metrics(null, null)");
  check(metrics.unmasksByReason.credible_threat === 1, JSON.stringify(metrics.unmasksByReason));
});
await expectOk("unmask: a blocked threat (no content) is unmaskable by its queue id; blocked spam is not; a queue id never stands in for real content", async () => {
  const threatQ = await callService("public.ts_record_blocked($1, 'buzz', $2, $3::jsonb)", [AUTHOR2, "the guy on the 3rd floor, i'm gonna k1ll you tomorrow", JSON.stringify({
    events: [{ field: "body", action: "block", visibility: "visible", category: "threat_violence", subcode: "threat_person", severity: "critical", ruleIds: ["thr.direct.v1"], textHash: "" }],
    queue: { source: "rule_block_escalation", category: "threat_violence", severity: "critical", priority: "p0", label: null, ruleIds: ["thr.direct.v1"], aiVerdict: null },
  })]);
  const q = await sql1("select * from public.mod_queue where id = $1", [threatQ]);
  check(q.entity_id === null && q.blocked_text.includes("k1ll") && q.author_id === AUTHOR2 && q.source === "rule_block_escalation", JSON.stringify(q));
  const modDetail = await call(MOD, "public.staff_queue_item($1)", [threatQ]);
  check(modDetail.canUnmask === false && modDetail.author.kind === "blind" && modDetail.fields[0].text.includes("k1ll"), JSON.stringify(modDetail.fields));
  noIdentity("blocked item for a moderator", modDetail, ["author2"]);
  await call(MOD, "public.staff_release($1)", [threatQ]);
  const adminDetail = await call(ADMIN, "public.staff_queue_item($1)", [threatQ]);
  check(adminDetail.canUnmask === true, "admins cannot unmask a blocked threat");
  await call(ADMIN, "public.staff_release($1)", [threatQ]);
  const u = await unmask(ADMIN, "buzz", threatQ, "credible_threat", GOOD_REASON, "UNMASK");
  check(u.user.id === AUTHOR2, JSON.stringify(u.user));
  const spamQ = await callService("public.ts_record_blocked($1, 'buzz', 'dm me for cheap essays, guaranteed A', $2::jsonb)", [AUTHOR2, JSON.stringify({
    events: [{ field: "body", action: "block", category: "spam_scam", severity: "high", textHash: "" }],
    queue: { source: "rule_block_escalation", category: "spam_scam", severity: "high", priority: "p1", label: null, ruleIds: [], aiVerdict: null },
  })]);
  let msg = "";
  try { await unmask(ADMIN, "buzz", spamQ, "credible_threat", GOOD_REASON, "UNMASK"); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:forbidden:"), "blocked spam: " + msg);
  msg = "";
  try { await unmask(ADMIN, "buzz", UQ, "credible_threat", GOOD_REASON, "UNMASK"); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:not_found:"), "an entity's queue id worked as a second door: " + msg);
});
await expectOk("unmask: at most 10 a day per admin", async () => {
  const done = (await sql1("select count(*)::int as n from public.audit_log where actor_id = $1 and action = 'buzz_unmask'", [ADMIN])).n;
  for (let i = done; i < 10; i++) await unmask(ADMIN, "buzz", UB, "credible_threat", GOOD_REASON, "UNMASK");
  let msg = "";
  try { await unmask(ADMIN, "buzz", UB, "credible_threat", GOOD_REASON, "UNMASK"); } catch (e) { msg = e.message; }
  check(msg.startsWith("ts:rate_limited:"), "the 11th unmask: " + (msg || "allowed"));
  check((await unmask(ADMIN2, "buzz", UB, "legal_request", GOOD_REASON, "UNMASK")).user.id === AUTHOR2, "the limit is per admin");
});

// =================================================================================================================
// 11. The audit log is append-only
// =================================================================================================================
await expectError("audit: an update is refused, even for the database owner", () => db.query("update public.audit_log set action = 'x'"), "ts:append_only:audit_log is append-only");
await expectError("audit: a delete is refused", () => db.query("delete from public.audit_log"), "ts:append_only:audit_log is append-only");
await expectError("audit: a truncate is refused", () => db.query("truncate public.audit_log"), "ts:append_only:audit_log is append-only");
await expectOk("audit: a moderator reads only their own rows; every mutation above wrote one", async () => {
  const mine = await call(MOD, "public.staff_audit(500, 0, '{}'::jsonb)");
  check(mine.items.length > 0 && mine.items.every((r) => r.actor?.id === MOD), "a moderator read someone else's rows");
  const all = await call(ADMIN, "public.staff_audit(500, 0, '{}'::jsonb)");
  check(all.items.some((r) => r.actor?.id === MOD2) && all.items.some((r) => r.actor === null), "admins do not see everything");
  const page = await call(ADMIN, "public.staff_audit(2, 0, '{}'::jsonb)");
  check(page.items.length === 2 && page.nextOffset === 2, JSON.stringify(page.nextOffset));
});

// =================================================================================================================
// 12. Users, roles, direct sanctions, rule packs, metrics
// =================================================================================================================
await expectOk("users: search by name or username (admins also by email; moderators never see email)", async () => {
  const mod = await call(MOD, "public.staff_users('quorvex', 20, 0)");
  check(mod.items.length === 1 && mod.items[0].user.id === AUTHOR && mod.items[0].email === null, JSON.stringify(mod));
  check((await call(MOD, "public.staff_users('zelda.q@', 20, 0)")).items.length === 0, "moderators search by email");
  const admin = await call(ADMIN, "public.staff_users('zelda.q@', 20, 0)");
  check(admin.items.length === 1 && admin.items[0].email === people.author.email, JSON.stringify(admin));
  check((await call(MOD, "public.staff_users('a', 20, 0)")).items.length === 0, "one character searched");
  check((await call(MOD, "public.staff_users('%', 20, 0)")).items.length === 0, "% is a wildcard");
});
await expectOk("direct sanctions: moderators warn and mute (up to 7 days) regular accounts; suspensions, longer mutes and staff are admin only", async () => {
  const tries = [
    ["suspension", null, TARGET, "ts:forbidden:Suspensions and bans are admin only."],
    ["mute", 8 * 86400000, TARGET, "ts:forbidden:Moderators can mute for up to 7 days."],
    ["warning", null, MOD2, "ts:forbidden:Only admins can sanction staff."],
    ["warning", null, MOD, "ts:validation_failed:You can't sanction yourself."],
  ];
  for (const [kind, dur, who, expected] of tries) {
    let msg = "";
    try { await call(MOD, "public.staff_sanction($1, $2, $3, 'all', 'spam_scam', 'repeated referral spam in chats')", [who, kind, dur]); } catch (e) { msg = e.message; }
    check(msg === expected, `${kind}: ${msg || "no error"}`);
  }
  let msg = "";
  try { await call(MOD, "public.staff_sanction($1, 'mute', null, 'all', 'spam_scam', 'short')", [TARGET]); } catch (e) { msg = e.message; }
  check(msg.includes("at least 10"), "short note: " + msg);
  const d = await call(MOD, "public.staff_sanction($1, 'mute', $2, 'all', 'spam_scam', 'repeated referral spam in three group chats')", [TARGET, 72 * 3600000]);
  const mute = d.sanctions.find((s) => s.kind === "mute");
  check(mute && mute.origin === "public" && d.status === "active" && d.strikePoints === 0, JSON.stringify(d));
  check((await posting(TARGET, "public")).reason === "muted", "the direct mute does not hold");
  const lifted = await call(ADMIN, "public.staff_lift($1, 'lifted after a second look')", [mute.id]);
  check(lifted.user.id === TARGET && (await posting(TARGET)).allowed, "lift");
  check((await sql1("select count(*)::int as n from public.audit_log where action = 'sanction_lift' and target_id = $1", [String(TARGET)])).n === 1, "lift not audited");
});
await expectOk("roles: an admin grants and revokes (audited, never their own); the console role follows", async () => {
  const d = await call(ADMIN, "public.staff_grant_role($1, 'moderator')", [USER]);
  check(d.role === "moderator" && (await call(USER, "public.ts_staff_role()")) === "moderator", JSON.stringify(d));
  check((await sql1("select count(*)::int as n from public.audit_log where action = 'role_grant' and target_id = $1", [String(USER)])).n === 1, "not audited");
  await call(ADMIN, "public.staff_grant_role($1, 'user')", [USER]);
  check((await call(USER, "public.ts_staff_role()")) === null, "not revoked");
  let msg = "";
  try { await call(ADMIN, "public.staff_grant_role($1, 'user')", [ADMIN]); } catch (e) { msg = e.message; }
  check(msg.includes("your own role"), "own role: " + msg);
});
await expectOk("rule packs: admins toggle (audited); the engine context follows; the baseline pack stays on", async () => {
  const off = await call(ADMIN, "public.staff_set_rule_pack('admin.spam', false, 'too many false positives this week')");
  check(off.id === "admin.spam" && off.enabled === false && off.updatedBy === people.admin.full_name, JSON.stringify(off));
  const ctx = await callService("public.ts_writer_context($1)", [AUTHOR2]);
  check(!ctx.enabledRulePacks.includes("admin.spam") && ctx.disabledRulePacks.includes("admin.spam"), JSON.stringify(ctx.enabledRulePacks));
  check((await sql1("select count(*)::int as n from public.audit_log where action = 'rule_pack_toggle' and target_id = 'admin.spam'")).n === 1, "not audited");
  let msg = "";
  try { await call(ADMIN, "public.staff_set_rule_pack('baseline', false, null)"); } catch (e) { msg = e.message; }
  check(msg.includes("baseline pack stays on"), "baseline: " + msg);
  await call(ADMIN, "public.staff_set_rule_pack('admin.spam', true, null)");
});
await expectOk("metrics: the shape, from the moderation tables only, with no person in it", async () => {
  const m = await call(MOD, "public.staff_metrics(null, null)");
  for (const k of ["openByPriority", "timeToFirstAction", "rulePrecision", "autoHideReversalRate", "activeSanctions", "unmasksByReason", "perDay", "reportsPer1k", "range"]) check(k in m, "missing " + k);
  check(["p0", "p1", "p2", "p3"].every((p) => typeof m.openByPriority[p] === "number") && m.timeToFirstAction.p0.slaMin === 60 && m.timeToFirstAction.p3.slaMin === 4320, JSON.stringify(m.timeToFirstAction));
  check(m.perDay.length >= 30 && m.perDay.length <= 32 && m.perDay.some((d) => d.actions > 0), JSON.stringify(m.perDay.slice(-2)));
  check(m.range.to - m.range.from === 30 * 86400000, JSON.stringify(m.range));
  noIdentity("metrics", m, ["author", "author2", "pub", "r1", "r2", "r3"]);
});
await expectOk("notifications: 'moderation' and 'staff' are valid types; every notice above has no actor", async () => {
  const bad = await sql1("select count(*)::int as n from public.notifications where type in ('moderation', 'staff') and actor_id is not null");
  check(bad.n === 0, "a moderation notice has an actor");
  check((await sql1("select count(*)::int as n from public.notifications where type = 'moderation'")).n > 5, "moderation notices missing");
});
await expectOk("the migration re-runs on a database with data in it, and nothing changes", async () => {
  const counts = async () => (await sql1(`select (select count(*) from public.mod_queue)::int as q, (select count(*) from public.audit_log)::int as a, (select count(*) from public.reports)::int as r,
    (select count(*) from public.user_sanctions)::int as s, (select count(*) from public.moderation_rule_state)::int as p`));
  const b = await counts();
  await db.exec(read(MIGRATION));
  const a = await counts();
  check(JSON.stringify(a) === JSON.stringify(b), JSON.stringify({ b, a }));
});
if (V2) {
  await expectOk("41 → 42 → 41 → 42 runs clean with Buzz notifications present (the type check keeps every type it had)", async () => {
    const t = await postBuzz(USER, "a thread someone else replies to before the re-runs");
    // published now (Buzz jitters a new thread's visibility by up to 3 minutes; nobody can reply before that)
    await db.query("update public.buzz_posts set visible_at = now() - interval '1 minute' where id = $1", [t]);
    await replyBuzz(AUTHOR2, t, "a reply that notifies the thread's author");
    const types = async () => (await rows(db.query("select distinct type from public.notifications order by type"))).map((r) => r.type).join();
    const before = await types();
    check(before.includes("buzz_reply") && before.includes("moderation") && before.includes("staff"), "fixtures missing: " + before);
    const V2_MIGRATION = "migrations/20261103000100_buzz_v2.sql";
    await db.exec(read(MIGRATION));
    await db.exec(read(V2_MIGRATION));
    await db.exec(read(MIGRATION));
    await db.exec(read(V2_MIGRATION));
    check((await types()) === before, `notification types changed: ${before} → ${await types()}`);
    const def = (await sql1("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notifications_type_check'")).d;
    for (const ty of ["moderation", "staff", "buzz_reply", "buzz_milestone", "buzz_poll_closed", "snap", "message"]) check(def.includes(`'${ty}'`), `${ty} dropped from the check: ${def}`);
  });
}

done("MIGRATION-41 TRUST & SAFETY");
