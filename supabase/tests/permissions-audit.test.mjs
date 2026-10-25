// Production-readiness audit of the database surface, against every migration: which functions and
// tables the API roles (anon, authenticated) can reach, that every admin_* function refuses students,
// the report column grants, the closed tables and sequences, the quarantine bucket, and that the
// service role can do exactly the media worker's work. Usage: node supabase/tests/permissions-audit.test.mjs
import { boot, read, expectOk, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const MFA = { aal: "aal2" };
const fails = async (fn, re) => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`wrong error: ${e.message}`); } throw new Error("no error"); };
const asService = async (fn) => { await db.exec("set role service_role;"); try { return await fn(); } finally { await db.exec("reset role;"); } };
const ORIGIN = "https://dskbzoqreandwwpxiplh.supabase.co/storage/v1/object/public/uploads/";

await expectOk("migration 17 re-runs cleanly", () => db.exec(read("migrations/20261026000000_hardening.sql")));

// ---- a small world --------------------------------------------------------------------------------
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
const S = await mk("sam@txstate.edu", "Sam Student"), T = await mk("tina@txstate.edu", "Tina Student");
const media = await one(db.query("insert into public.media (owner_id, provider_asset_id, playback_id, status) values ($1,'asset_sam_1','pb_sam_1','ready') returning id", [S]));
const VIDEO = JSON.stringify([{ media_id: media.id, playback_id: "pb_sam_1", poster_url: null, width: 720, height: 1280, duration_seconds: 10 }]);
const apt = (await as(S, () => one(db.query(
  "insert into public.apartments (owner_id, university_id, title, description, price_per_month, address, images, videos, latitude, longitude) values ($1,$2,'Sunny room','Bright.',650,'1 Test Street',$3,$4::jsonb,29.8899,-97.94) returning id",
  [S, TX, [`${ORIGIN}apartments/${S}/one.jpg`], VIDEO])))).id;
const report = (await as(T, () => one(db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1,'apartment',$2,'spam') returning id", [T, apt])))).id;

// ---- the function surface -------------------------------------------------------------------------
const fns = await rows(db.query(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
  has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('service_role', p.oid, 'execute') as svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname`));
const INTERNAL = ["admin_content_snapshot", "admin_content_table"];
const adminApi = fns.filter((f) => f.name.startsWith("admin_") && f.name !== "admin_bootstrap_owner" && !INTERNAL.includes(f.name));
await expectOk(`every admin_* function (${adminApi.length}) is granted to authenticated and never to anon`, async () => {
  const bad = adminApi.filter((f) => f.anon || !f.auth).map((f) => f.name);
  if (bad.length) throw new Error(bad.join(", "));
});
await expectOk("admin_bootstrap_owner cannot be called by anon, authenticated or service_role", async () => {
  const f = fns.find((x) => x.name === "admin_bootstrap_owner"); if (!f || f.anon || f.auth || f.svc) throw new Error(JSON.stringify(f));
  await fails(() => asService(() => db.query("select public.admin_bootstrap_owner('x@txstate.edu')")), /permission denied/);
});
await expectOk("internal helpers (staff_*, media_*, snapshot, storage path, triggers) are not executable by API roles", async () => {
  const internal = fns.filter((f) => /^(staff_|media_(?!jobs_)|admin_content_(snapshot|table)$|storage_path_from_url|moderation_sync_copies|enqueue_media_on_delete|keep_moderation_columns|block_suspended_writes|notify$)/.test(f.name));
  if (internal.length < 20) throw new Error(`only ${internal.length} internal functions found`);
  const bad = internal.filter((f) => f.anon || f.auth).map((f) => f.name);
  if (bad.length) throw new Error(bad.join(", "));
});
await expectOk("media_jobs_claim/done/failed are service-role only", async () => {
  const jobs = fns.filter((f) => f.name.startsWith("media_jobs_") && !f.name.startsWith("media_jobs_list"));
  const names = jobs.map((f) => f.name).sort().join(); if (names !== "media_jobs_claim,media_jobs_done,media_jobs_failed") throw new Error(names);
  const bad = jobs.filter((f) => f.anon || f.auth || !f.svc).map((f) => f.name); if (bad.length) throw new Error(bad.join(", "));
});
await expectOk("delete_my_account is for signed-in users only (anon revoked by migration 17)", async () => {
  const f = fns.find((x) => x.name === "delete_my_account"); if (!f || f.anon || !f.auth) throw new Error(JSON.stringify(f));
  await fails(() => asAnon(() => db.query("select public.delete_my_account()")), /permission denied|Not authenticated/);
});
/** `select * from fn(null::uuid, null::text)` for a function's identity arguments. */
const nullCall = (f) => {
  const args = f.args.trim() ? f.args.split(",").map((a) => { const parts = a.trim().split(" "); parts.shift(); return `null::${parts.join(" ")}`; }).join(", ") : "";
  return /^(TABLE|SETOF)/i.test(f.result) ? `select * from public.${f.name}(${args})` : `select public.${f.name}(${args})`;
};
await expectOk("called by a student (with or without a second factor) every admin_* function answers 'Not allowed'; admin_me answers 'not staff'", async () => {
  for (const f of adminApi) {
    const q = nullCall(f);
    if (f.name === "admin_me") { if ((await as(S, () => rows(db.query(q)), MFA)).length !== 0) throw new Error("admin_me returned a row for a student"); continue; }
    await fails(() => as(S, () => db.query(q)), /Not allowed/).catch((e) => { throw new Error(`${f.name} (aal1): ${e.message}`); });
    await fails(() => as(S, () => db.query(q), MFA), /Not allowed/).catch((e) => { throw new Error(`${f.name} (aal2): ${e.message}`); });
  }
});
await expectOk("called by a visitor every admin_* function is refused before doing anything", async () => {
  for (const f of adminApi) await fails(() => asAnon(() => db.query(nullCall(f))), /permission denied|Not authenticated/).catch((e) => { throw new Error(`${f.name}: ${e.message}`); });
});

// ---- tables ---------------------------------------------------------------------------------------
await expectOk("row-level security is enabled on every table in public", async () => {
  const off = await rows(db.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity"));
  if (off.length) throw new Error(off.map((r) => r.relname).join(", "));
});
await expectOk("closed tables have no privileges at all for API roles, and a student's select is refused", async () => {
  const closed = ["staff", "staff_invites", "staff_audit_log", "account_restrictions", "media_jobs", "buzz_secrets", "buzz_rate_log"];
  const grants = await rows(db.query("select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') and table_name = any($1)", [closed]));
  if (grants.length) throw new Error(JSON.stringify(grants));
  for (const t of closed) await fails(() => as(S, () => db.query(`select * from public.${t}`), MFA), /permission denied/);
});
await expectOk("TRUNCATE is revoked from API roles on every public table (migration 17), and the default for new tables too", async () => {
  const left = await rows(db.query("select table_name, grantee from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC') and privilege_type = 'TRUNCATE'"));
  if (left.length) throw new Error(JSON.stringify(left));
  await db.exec("create table public._audit_probe (id int)");
  try {
    const probe = await rows(db.query("select grantee from information_schema.role_table_grants where table_schema = 'public' and table_name = '_audit_probe' and privilege_type = 'TRUNCATE' and grantee in ('anon','authenticated')"));
    if (probe.length) throw new Error("a new table still gets TRUNCATE for " + probe.map((r) => r.grantee).join(", "));
  } finally { await db.exec("drop table public._audit_probe"); }
});
await expectOk("reports: a reporter reads only the 8 public columns of their own report; review columns, updates and deletes are refused", async () => {
  const mine = await as(T, () => rows(db.query("select id, status, reason from public.reports where reporter_id = $1", [T])), MFA);
  if (mine.length !== 1) throw new Error("reporter cannot see their own report");
  await fails(() => as(T, () => db.query("select decision from public.reports"), MFA), /permission denied/);
  await fails(() => as(T, () => db.query("select notes, reviewed_by, reviewed_at from public.reports"), MFA), /permission denied/);
  const cols = (await rows(db.query("select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'reports' and grantee = 'authenticated' and privilege_type = 'SELECT' order by 1"))).map((r) => r.column_name).join(",");
  if (cols !== "created_at,details,id,reason,reporter_id,status,target_id,target_type") throw new Error(cols);
  const upd = await as(T, () => db.query("update public.reports set status = 'reviewed' where id = $1", [report]), MFA).then((r) => r.affectedRows ?? 0, () => 0);
  const del = await as(T, () => db.query("delete from public.reports where id = $1", [report]), MFA).then((r) => r.affectedRows ?? 0, () => 0);
  if (upd || del) throw new Error(`reporter changed their report: update=${upd} delete=${del}`);
  if ((await one(db.query("select status from public.reports where id = $1", [report]))).status !== "open") throw new Error("report changed");
});
await expectOk("the id sequences of the closed tables are not usable by API roles", async () => {
  const seqs = await rows(db.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S' and (c.relname like 'staff_audit_log%' or c.relname like 'media_jobs%' or c.relname like 'buzz_comments%')"));
  if (seqs.length < 3) throw new Error("sequences not found: " + JSON.stringify(seqs));
  for (const s of seqs) for (const role of ["anon", "authenticated"]) {
    const ok = (await one(db.query("select has_sequence_privilege($1, $2, 'USAGE') as u, has_sequence_privilege($1, $2, 'SELECT') as s", [role, `public.${s.relname}`])));
    if (ok.u || ok.s) throw new Error(`${role} can use ${s.relname}`);
  }
});

// ---- storage --------------------------------------------------------------------------------------
await expectOk("the quarantine bucket is private and no storage policy mentions it", async () => {
  const b = await one(db.query("select public from storage.buckets where id = 'quarantine'")); if (!b || b.public !== false) throw new Error(JSON.stringify(b));
  const pol = await rows(db.query("select policyname from pg_policies where schemaname = 'storage' and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%quarantine%'"));
  if (pol.length) throw new Error(pol.map((p) => p.policyname).join(", "));
});

// ---- the service role can do exactly the worker's work ---------------------------------------------
let claimed;
await expectOk("service role: hiding queues jobs, the worker claims them, refreshes the hidden listing's video snapshot without un-hiding it, updates the media row and marks done", async () => {
  await as(OWNER, () => db.query("select public.admin_content_hide('apartment', $1, 'Looks fake')", [apt]), MFA);
  claimed = await asService(() => rows(db.query("select * from public.media_jobs_claim(10)")));
  if (claimed.map((j) => j.kind).sort().join() !== "mux_disable,quarantine") throw new Error(JSON.stringify(claimed.map((j) => j.kind)));
  const before = await one(db.query("select hidden_at from public.apartments where id = $1", [apt]));
  const newVideos = JSON.stringify([{ media_id: media.id, playback_id: "pb_new", poster_url: "https://image.mux.com/pb_new/thumbnail.jpg", width: 720, height: 1280, duration_seconds: 10 }]);
  await asService(() => db.query("update public.apartments set videos = $1::jsonb where id = $2", [newVideos, apt]));
  await asService(() => db.query("update public.media set playback_id = 'pb_new', poster_url = 'x' where provider_asset_id = 'asset_sam_1'"));
  const after = await one(db.query("select hidden_at, videos, hidden_reason from public.apartments where id = $1", [apt]));
  if (!after.hidden_at || String(after.hidden_at) !== String(before.hidden_at) || after.hidden_reason !== "Looks fake") throw new Error("the service-role update changed the moderation state");
  if (after.videos[0].playback_id !== "pb_new") throw new Error("snapshot not refreshed");
  for (const j of claimed) await asService(() => db.query("select public.media_jobs_done($1)", [j.id]));
  if ((await one(db.query("select count(*)::int as n from public.media_jobs where done_at is null"))).n !== 0) throw new Error("jobs still pending");
});
await expectOk("service role: deleting the media row while its mux_delete job is pending collapses into that job (one pending row, then done)", async () => {
  await as(OWNER, () => db.query("select public.admin_content_delete('apartment', $1, 'spam')", [apt]), MFA);
  const pending = await rows(db.query("select id, kind, ref from public.media_jobs where done_at is null and kind = 'mux_delete'"));
  if (pending.length !== 1 || pending[0].ref !== "asset_sam_1") throw new Error(JSON.stringify(pending));
  await asService(() => db.query("select * from public.media_jobs_claim(10)"));
  await asService(() => db.query("delete from public.media where provider_asset_id = 'asset_sam_1'"));
  const again = await rows(db.query("select id from public.media_jobs where done_at is null and kind = 'mux_delete' and ref = 'asset_sam_1'"));
  if (again.length !== 1 || again[0].id !== pending[0].id) throw new Error("a second mux_delete job appeared: " + JSON.stringify(again));
  await asService(() => db.query("select public.media_jobs_done($1)", [pending[0].id]));
  if ((await one(db.query("select count(*)::int as n from public.media_jobs where done_at is null and ref = 'asset_sam_1'"))).n !== 0) throw new Error("not done");
});
await expectOk("service role: a failed job keeps its error and comes back; a user cannot report on jobs", async () => {
  await as(OWNER, () => db.query("select public.admin_user_suspend($1, 'test')", [T]), MFA);
  await db.query("insert into public.media_jobs (kind, ref, target_type, target_id) values ('quarantine', 'apartments/x/y.jpg', 'apartment', $1)", [apt]);
  const [job] = await asService(() => rows(db.query("select * from public.media_jobs_claim(10)")));
  await asService(() => db.query("select public.media_jobs_failed($1, 'Mux is not configured')", [job.id]));
  const row = await one(db.query("select last_error, attempts, done_at from public.media_jobs where id = $1", [job.id]));
  if (row.last_error !== "Mux is not configured" || row.attempts !== 1 || row.done_at !== null) throw new Error(JSON.stringify(row));
  await fails(() => as(S, () => db.query("select public.media_jobs_done($1)", [job.id]), MFA), /permission denied/);
});

done("PERMISSIONS AUDIT");
