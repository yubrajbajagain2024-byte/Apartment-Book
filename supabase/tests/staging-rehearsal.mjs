// Staging rehearsal for migrations 16 and 17. Builds a database in the state production is in
// (migrations 1-15 applied and tracked, real-looking data, a pending owner invitation, pending
// media jobs), serves it over the Postgres wire protocol, and drives the REAL setup script against
// it: dry run, the out-of-order guard, the upgrade, a re-run. Then checks that no data changed,
// that no media job was executed, the owner sign-in + two-factor flow at the database level, and
// that the website/app paths students use still work. Usage: node supabase/tests/staging-rehearsal.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { boot, expectOk, done } from "./harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Production since 2026-10-25 22:31 UTC: everything through 17. Pending: 18 (staff invitation emails).
const LAST_LIVE = "20261103100100_hardening.sql";
const NEW = ["20261103100200_staff_invite_email.sql"];
const PORT = 55433;
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`;
const ORIGIN = "https://dskbzoqreandwwpxiplh.supabase.co/storage/v1/object/public/uploads/";
const OWNER_EMAIL = "owner.rehearsal@gmail.com";

const { db, mk, as } = await boot({ upTo: LAST_LIVE });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const fails = async (fn, re) => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`wrong error: ${e.message}`); } throw new Error("no error"); };
const MFA = { aal: "aal2" };
/** A session with exactly these claims and NO automatic factor (harness `as` adds one for aal2). */
const asRaw = async (uid, claims, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, ...claims })}', false);`); try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claims', '', false);"); } };

// ---- production-like state ------------------------------------------------------------------------
const fs = await import("node:fs");
const liveMigrations = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql") && f <= LAST_LIVE).sort();
await db.exec("create table public._migrations (name text primary key, applied_at timestamptz not null default now()); alter table public._migrations enable row level security;");
for (const m of liveMigrations) await db.query("insert into public._migrations (name) values ($1)", [m]);
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
// The live owner situation: bootstrapped as an invitation for an outside address that has no account yet.
if ((await one(db.query("select public.admin_bootstrap_owner($1) as r", [OWNER_EMAIL]))).r !== "invited") throw new Error("bootstrap setup");
const S = await mk("sam@txstate.edu", "Sam Student"), T = await mk("tina@txstate.edu", "Tina Student"), U = await mk("uma@txstate.edu", "Uma Student");
const media = await one(db.query("insert into public.media (owner_id, provider_asset_id, playback_id, status) values ($1,'asset_sam_1','pb_sam_1','ready') returning id", [S]));
const VIDEO = JSON.stringify([{ media_id: media.id, playback_id: "pb_sam_1", poster_url: null, width: 720, height: 1280, duration_seconds: 10 }]);
const apt = (await as(S, () => one(db.query("insert into public.apartments (owner_id, university_id, title, description, price_per_month, address, images, videos, latitude, longitude) values ($1,$2,'Sunny room','Bright.',650,'1 Test Street',$3,$4::jsonb,29.8899,-97.94) returning id", [S, TX, [`${ORIGIN}apartments/${S}/one.jpg`], VIDEO])))).id;
const item = (await as(T, () => one(db.query("insert into public.items (seller_id, university_id, title, description, price, category, condition, images) values ($1,$2,'Desk lamp','Works.',10,'furniture','good',$3) returning id", [T, TX, [`${ORIGIN}items/${T}/lamp.jpg`]])))).id;
await as(S, () => db.query("insert into public.feed_posts (author_id, kind, body) values ($1,'post','Hello campus')", [S]));
await as(S, () => db.query("select public.buzz_create(p_topic => 'housing', p_title => 'Is the river district safe at night?')"));
const conv = (await as(S, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [T])))).id;
await as(S, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'hi Tina')", [conv, S]));
const report = (await as(U, () => one(db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1,'apartment',$2,'spam') returning id", [U, apt])))).id;
// Moderation already in use: one hidden item (pending quarantine job) and one suspension, done by a moderator.
const TMP = await mk("mod@txstate.edu", "Mona Moderator");
await db.query("insert into public.staff (user_id, role) values ($1, 'moderator')", [TMP]);
await as(TMP, () => db.query("select public.admin_content_hide('item', $1, 'Duplicate listing')", [item]), MFA);
await as(TMP, () => db.query("select public.admin_user_suspend($1, 'Spam', null, null)", [U]), MFA);

const TABLES = (await rows(db.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '_migrations' order by 1"))).map((r) => r.relname);
async function snapshot() {
  const out = {};
  for (const t of TABLES) out[t] = Number((await one(db.query(`select count(*) as n from public.${t}`))).n);
  out["auth.users"] = Number((await one(db.query("select count(*) as n from auth.users"))).n);
  out.pendingJobs = Number((await one(db.query("select count(*) as n from public.media_jobs where done_at is null"))).n);
  out.jobAttempts = Number((await one(db.query("select coalesce(sum(attempts),0) as n from public.media_jobs"))).n);
  out.hiddenItem = (await one(db.query("select hidden_at is not null as h from public.items where id = $1", [item]))).h;
  return out;
}
const tracked = async () => (await rows(db.query("select name from public._migrations order by name"))).map((r) => r.name);
const fnExists = async (name) => Boolean((await one(db.query("select to_regprocedure($1) as p", [name]))).p);
const before = await snapshot();
if (before.pendingJobs < 1) throw new Error("expected a pending media job in the staged state");

// ---- the real setup script, over the wire ---------------------------------------------------------
const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
await server.start();
function setup(extra = {}) {
  const env = { ...process.env, SUPABASE_DB_URL: DB_URL, SKIP_SEED: "1", ...extra };
  delete env.SUPABASE_ACCESS_TOKEN; delete env.SUPABASE_PROJECT_REF; delete env.ADMIN_OWNER_EMAIL;
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  // Async on purpose: this process serves the database, so a blocking spawn would deadlock.
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts/supabase-setup.mjs")], { cwd: ROOT, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 240000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
try {
  await expectOk("dry run lists exactly the pending migration and changes nothing", async () => {
    const r = await setup({ DRY_RUN: "1" });
    if (r.code !== 0) throw new Error(r.out);
    const listed = [...r.out.matchAll(/^\s+- (\S+\.sql)$/gm)].map((m) => m[1]);
    if (listed.join() !== NEW.join()) throw new Error("listed: " + listed.join() + "\n" + r.out);
    if ((await tracked()).length !== liveMigrations.length || (await fnExists("public.admin_invite_resend(text)"))) throw new Error("dry run changed the database");
  });
  await expectOk("out-of-order guard: with migration 13's tracking row missing, the script refuses and applies nothing", async () => {
    const m13 = "20260922000000_buzz_reply_votes.sql";
    await db.query("delete from public._migrations where name = $1", [m13]);
    try {
      const r = await setup();
      if (r.code === 0 || !/refusing to apply 20260922000000_buzz_reply_votes\.sql/.test(r.out)) throw new Error(r.out);
      if (await fnExists("public.admin_invite_resend(text)")) throw new Error("18 was applied anyway");
    } finally { await db.query("insert into public._migrations (name) values ($1) on conflict do nothing", [m13]); }
  });
  await expectOk("a failing migration rolls back completely: no partial objects, no tracking row (the script's transaction wrapper)", async () => {
    const c = new pg.Client({ connectionString: DB_URL, ssl: false }); await c.connect();
    try { await c.query("begin;\ncreate table public._rehearsal_probe (id int);\nselect 1/0;\n;\ninsert into public._migrations (name) values ('zz_probe.sql') on conflict do nothing;\ncommit;"); throw new Error("no error"); }
    catch (e) { if (!/division by zero/.test(e.message)) throw e; }
    finally { await c.end(); }
    await db.exec("rollback").catch(() => undefined);
    if ((await one(db.query("select to_regclass('public._rehearsal_probe') as t"))).t) throw new Error("partial table left behind");
    if ((await tracked()).includes("zz_probe.sql")) throw new Error("tracking row written");
  });
  await expectOk("the upgrade applies the pending migration and records it", async () => {
    const r = await setup();
    if (r.code !== 0) throw new Error(r.out);
    if (!NEW.every((m) => r.out.includes(`${m}: applied`))) throw new Error(r.out);
    const t = await tracked(); if (!NEW.every((m) => t.includes(m)) || t.length !== liveMigrations.length + NEW.length) throw new Error(t.join());
    for (const f of ["public.admin_invite_resend(text)", "public.admin_invite_email_result(text,boolean,uuid,text)", "public.admin_overview_stats()"]) if (!(await fnExists(f))) throw new Error("missing " + f);
  });
  await expectOk("running the script again applies nothing (both reported as already applied)", async () => {
    const r = await setup();
    if (r.code !== 0 || !NEW.every((m) => r.out.includes(`${m}: already applied`)) || / applied$/m.test(r.out.replace(/already applied/g, ""))) throw new Error(r.out);
  });
} finally { await server.stop(); }

// ---- after the upgrade ----------------------------------------------------------------------------
await expectOk("no row of any table changed in number, the hidden item is still hidden, and no media job was claimed or executed", async () => {
  const after = await snapshot();
  const diff = Object.keys(before).filter((k) => before[k] !== after[k]).map((k) => `${k}: ${before[k]} -> ${after[k]}`);
  if (diff.length) throw new Error(diff.join("; "));
});
await expectOk("the pending owner invitation survived the upgrade: not sent, bootstrap (does not expire), unbound", async () => {
  const i = (await db.query("select * from public.staff_invites where email = $1", [OWNER_EMAIL])).rows[0];
  if (!i || i.email_status !== "not_sent" || i.auth_user_id !== null || i.invited_by !== null) throw new Error(JSON.stringify(i));
});
await expectOk("migration 17 is still in effect: no TRUNCATE for API roles, delete_my_account not callable by anon", async () => {
  const t = await rows(db.query("select table_name, grantee from information_schema.role_table_grants where table_schema = 'public' and privilege_type = 'TRUNCATE' and grantee in ('anon','authenticated')"));
  if (t.length) throw new Error(JSON.stringify(t.slice(0, 3)));
  if ((await one(db.query("select has_function_privilege('anon', 'public.delete_my_account()', 'execute') as x"))).x) throw new Error("anon can call delete_my_account");
});

let OWNER;
await expectOk("owner sign-up: the account created from the dashboard (confirmed) claims the pending owner invitation at once", async () => {
  OWNER = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, '{\"full_name\":\"Rehearsal Owner\"}', now()) returning id", [OWNER_EMAIL]))).id;
  const s = await one(db.query("select role from public.staff where user_id = $1", [OWNER])); if (s?.role !== "owner") throw new Error(JSON.stringify(s));
  if ((await one(db.query("select count(*)::int as n from public.staff_invites"))).n !== 0) throw new Error("invitation not consumed");
});
await expectOk("password only (aal1): admin_me says owner, not verified, not enrolled; every dashboard function demands two-factor", async () => {
  const me = await asRaw(OWNER, { aal: "aal1" }, () => one(db.query("select * from public.admin_me()")));
  if (me.role !== "owner" || me.mfa_verified || me.mfa_enrolled || !me.last_owner) throw new Error(JSON.stringify(me));
  for (const q of ["select public.admin_overview_stats()", "select * from public.admin_users_list()", "select * from public.admin_hidden_content_list()", `select * from public.admin_report_get('${report}')`])
    await fails(() => asRaw(OWNER, { aal: "aal1" }, () => db.query(q)), /Two-factor authentication required/);
});
await expectOk("a forged aal2 claim without a verified authenticator is refused; an unverified (half-finished) one too", async () => {
  await fails(() => asRaw(OWNER, { aal: "aal2" }, () => db.query("select public.admin_overview_stats()")), /Two-factor authentication required/);
  await db.query("insert into auth.mfa_factors (user_id, status, friendly_name) values ($1, 'unverified', 'Authenticator app')", [OWNER]);
  await fails(() => asRaw(OWNER, { aal: "aal2" }, () => db.query("select public.admin_overview_stats()")), /Two-factor authentication required/);
});
await expectOk("enrolment verified + aal2: everything opens, the counts match the staged data, and the enrolment is in the audit log", async () => {
  await db.query("update auth.mfa_factors set status = 'verified' where user_id = $1", [OWNER]);
  const s = await asRaw(OWNER, { aal: "aal2" }, async () => (await one(db.query("select public.admin_overview_stats() as s"))).s);
  if (Number(s.reports_open) !== 1 || Number(s.suspended_active) !== 1 || Number(s.hidden_content) !== 1 || Number(s.staff_total) !== 2 || Number(s.media_pending) !== before.pendingJobs) throw new Error(JSON.stringify(s));
  const hidden = await asRaw(OWNER, { aal: "aal2" }, () => rows(db.query("select * from public.admin_hidden_content_list()")));
  if (hidden.length !== 1 || hidden[0].target_id !== item) throw new Error(JSON.stringify(hidden));
  const r = await asRaw(OWNER, { aal: "aal2" }, () => one(db.query("select * from public.admin_report_get($1)", [report])));
  if (r.status !== "open" || r.target_author_id !== S) throw new Error(JSON.stringify(r));
  const users = await asRaw(OWNER, { aal: "aal2" }, () => rows(db.query("select * from public.admin_users_list('suspended')")));
  if (users.map((u) => u.user_id).join() !== U) throw new Error(JSON.stringify(users));
  const log = (await rows(db.query("select action from public.staff_audit_log where actor_id = $1 or target_id = $2 order by id", [OWNER, OWNER]))).map((x) => x.action);
  if (!log.includes("invite.accepted") || !log.includes("security.mfa_enrolled")) throw new Error(log.join());
});
await expectOk("removing the authenticator locks everything again even though the session still says aal2", async () => {
  await db.query("delete from auth.mfa_factors where user_id = $1", [OWNER]);
  await fails(() => asRaw(OWNER, { aal: "aal2" }, () => db.query("select public.admin_overview_stats()")), /Two-factor authentication required/);
});
await expectOk("website and app paths still work for students after the upgrade (read, post, message, report); the hidden item stays invisible", async () => {
  await as(T, async () => {
    const list = await rows(db.query("select id from public.apartments"));
    if (!list.some((a) => a.id === apt)) throw new Error("apartment not visible");
    await db.query("insert into public.feed_posts (author_id, kind, body) values ($1,'post','After the upgrade')", [T]);
    await db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'still works')", [conv, T]);
    await db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1,'apartment',$2,'other')", [T, apt]);
  });
  const seen = await as(S, () => rows(db.query("select id from public.items where id = $1", [item])));
  if (seen.length) throw new Error("hidden item visible to another student");
  await fails(() => as(U, () => db.query("insert into public.feed_posts (author_id, kind, body) values ($1,'post','x')", [U])), /suspended/);
});

done("STAGING REHEARSAL");
