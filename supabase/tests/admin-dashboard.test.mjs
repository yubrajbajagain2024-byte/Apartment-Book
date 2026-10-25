// Migration 16 (dashboard queries for the admin app): the staff gate on every function, the
// overview counts, browsing people, the hidden-content list (no Buzz author, published time only)
// and fetching one report. Usage: node supabase/tests/admin-dashboard.test.mjs
import { boot, read, expectOk, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const MFA = { aal: "aal2" };
const fails = async (fn, re) => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`wrong error: ${e.message}`); } throw new Error("no error"); };
const ORIGIN = "https://dskbzoqreandwwpxiplh.supabase.co/storage/v1/object/public/uploads/";

await expectOk("migration 16 re-runs cleanly", () => db.exec(read("migrations/20261025000000_admin_dashboard.sql")));

// ---- a small world --------------------------------------------------------------------------------
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
const MOD = await mk("mod@txstate.edu", "Mona Moderator");
await as(OWNER, () => db.query("select public.admin_staff_add('mod@txstate.edu','moderator')"), MFA);
const S = await mk("sam@txstate.edu", "Sam Student"), T = await mk("tina@txstate.edu", "Tina Student");
// Distinct creation times so "newest first" and paging are deterministic (PGlite's now() has millisecond resolution).
await db.query("update public.profiles set created_at = now() - interval '4 days' where id = $1", [OWNER]);
await db.query("update public.profiles set created_at = now() - interval '3 days' where id = $1", [MOD]);
await db.query("update public.profiles set created_at = now() - interval '2 days' where id = $1", [S]);
await db.query("update public.profiles set created_at = now() - interval '10 days' where id = $1", [T]);
const IMAGES = [`${ORIGIN}apartments/${S}/one.jpg`];
const apt = (await as(S, () => one(db.query(
  "insert into public.apartments (owner_id, university_id, title, description, price_per_month, address, images, latitude, longitude) values ($1,$2,'Sunny room by the river','Bright and quiet.',650,'1 Test Street',$3,29.8899,-97.94) returning id",
  [S, TX, IMAGES])))).id;
const buzz = (await as(S, () => one(db.query("select public.buzz_create(p_topic => 'housing', p_title => 'Is the river district safe at night?', p_body => 'Asking for a friend.') as id")))).id;
const conv = (await as(S, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [T])))).id;
await as(S, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'hi Tina')", [conv, S]));
const report = (await as(T, () => one(db.query("insert into public.reports (reporter_id, target_type, target_id, reason, details) values ($1,'apartment',$2,'spam','Looks fake') returning id", [T, apt])))).id;
const buzzReport = (await as(T, () => one(db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1,'buzz',$2,'harassment') returning id", [T, buzz])))).id;

const CALLS = [
  "select public.admin_overview_stats()",
  "select * from public.admin_users_list()",
  "select * from public.admin_hidden_content_list()",
  `select * from public.admin_report_get('${report}')`,
];

// ---- the gate -------------------------------------------------------------------------------------
await expectOk("a student is refused by every function, with and without a second factor", async () => {
  for (const q of CALLS) {
    await fails(() => as(S, () => db.query(q)), /Not allowed/);
    await fails(() => as(S, () => db.query(q), MFA), /Not allowed/);
  }
});
await expectOk("a visitor is refused by every function", async () => {
  for (const q of CALLS) await fails(() => asAnon(() => db.query(q)), /permission denied|Not authenticated/);
});
await expectOk("a moderator without a verified second factor is refused by every function", async () => {
  for (const q of CALLS) await fails(() => as(MOD, () => db.query(q)), /Two-factor authentication required/);
});
await expectOk("a suspended moderator is refused", async () => {
  await as(OWNER, () => db.query("select public.admin_user_suspend($1, 'test suspension')", [MOD]), MFA);
  for (const q of CALLS) await fails(() => as(MOD, () => db.query(q), MFA), /suspended/);
  await as(OWNER, () => db.query("select public.admin_user_unsuspend($1)", [MOD]), MFA);
});

// ---- overview counts ------------------------------------------------------------------------------
const stats = () => as(MOD, async () => (await one(db.query("select public.admin_overview_stats() as s"))).s, MFA);
await expectOk("overview: users, listings, posts, reports, staff and media counts match the tables", async () => {
  const s = await stats();
  const n = async (q) => Number((await one(db.query(q))).n);
  const expected = {
    users_total: await n("select count(*) n from public.profiles"),
    users_new_7d: 3, // owner, mod, sam; tina joined 10 days ago
    suspended_active: 0,
    reports_open: 2,
    reports_closed_7d: 0,
    hidden_content: 0,
    listings_total: 1,
    posts_total: 0,
    buzz_total: 1,
    media_pending: await n("select count(*) n from public.media_jobs where done_at is null"),
    media_failing: 0,
    staff_total: 2,
  };
  for (const [k, v] of Object.entries(expected)) if (Number(s[k]) !== v) throw new Error(`${k}: ${s[k]} (expected ${v})`);
  if (!("users_active_24h" in s)) throw new Error("users_active_24h missing");
});
await expectOk("overview: a suspension, a hide, a resolved report and a failing media job move the counts", async () => {
  await as(MOD, () => db.query("select public.admin_user_suspend($1, 'Spam listings')", [T]), MFA);
  await as(MOD, () => db.query("select public.admin_content_hide('apartment', $1, 'Looks fake')", [apt]), MFA);
  await as(MOD, () => db.query("select public.admin_content_hide('buzz', $1, 'Harassment')", [buzz]), MFA);
  await as(MOD, () => db.query("select public.admin_report_resolve($1, 'content_hidden', 'hidden')", [report]), MFA);
  await db.query("update public.media_jobs set attempts = 3 where kind = 'quarantine' and done_at is null");
  const s = await stats();
  const want = { suspended_active: 1, hidden_content: 2, reports_open: 1, reports_closed_7d: 1 };
  for (const [k, v] of Object.entries(want)) if (Number(s[k]) !== v) throw new Error(`${k}: ${s[k]} (expected ${v})`);
  if (Number(s.media_pending) < 1 || Number(s.media_failing) < 1) throw new Error(`media: ${JSON.stringify(s)}`);
});

// ---- people ---------------------------------------------------------------------------------------
await expectOk("users list: newest first with email, suspension and staff role; filters and paging work; bad filter refused", async () => {
  const all = await as(MOD, () => rows(db.query("select * from public.admin_users_list()")), MFA);
  if (all.map((r) => r.user_id).join() !== [S, MOD, OWNER, T].join()) throw new Error("order: " + all.map((r) => r.full_name).join(", "));
  const tina = all.find((r) => r.user_id === T); if (!tina.suspended || tina.email !== "tina@txstate.edu" || tina.staff_role !== null || tina.university_name !== "Texas State University") throw new Error(JSON.stringify(tina));
  const mona = all.find((r) => r.user_id === MOD); if (mona.staff_role !== "moderator" || mona.suspended) throw new Error(JSON.stringify(mona));
  const suspended = await as(MOD, () => rows(db.query("select * from public.admin_users_list('suspended')")), MFA);
  if (suspended.map((r) => r.user_id).join() !== T) throw new Error("suspended filter: " + JSON.stringify(suspended));
  const staff = await as(MOD, () => rows(db.query("select * from public.admin_users_list('staff')")), MFA);
  if (staff.map((r) => r.user_id).join() !== [MOD, OWNER].join()) throw new Error("staff filter: " + JSON.stringify(staff));
  const page1 = await as(MOD, () => rows(db.query("select * from public.admin_users_list('all', 2)")), MFA);
  const page2 = await as(MOD, () => rows(db.query("select * from public.admin_users_list('all', 2, $1)", [page1[1].created_at])), MFA);
  if (page1.length !== 2 || page2.map((r) => r.user_id).join() !== [OWNER, T].join()) throw new Error("paging: " + JSON.stringify(page2.map((r) => r.full_name)));
  await fails(() => as(MOD, () => db.query("select * from public.admin_users_list('everyone')"), MFA), /Invalid filter/);
});

// ---- hidden content -------------------------------------------------------------------------------
await expectOk("hidden list: both hidden rows, newest hide first, with reason, title and preview; the apartment names its author", async () => {
  await db.query("update public.apartments set hidden_at = now() - interval '1 hour' where id = $1", [apt]); // the Buzz hide is the newer one
  const list = await as(MOD, () => rows(db.query("select * from public.admin_hidden_content_list()")), MFA);
  if (list.map((r) => `${r.target_type}:${r.target_id}`).join("|") !== `buzz:${buzz}|apartment:${apt}`) throw new Error(JSON.stringify(list));
  const a = list[1];
  if (a.hidden_reason !== "Looks fake" || a.title !== "Sunny room by the river" || a.preview !== "Bright and quiet." || a.author_id !== S || a.author_name !== "Sam Student") throw new Error(JSON.stringify(a));
});
await expectOk("hidden list: the Buzz row has no author and shows the published time, not the real one", async () => {
  await db.query("update public.buzz_posts set visible_at = created_at + interval '7 minutes' where id = $1", [buzz]);
  const b = (await as(MOD, () => rows(db.query("select * from public.admin_hidden_content_list('buzz')")), MFA))[0];
  const real = await one(db.query("select created_at, visible_at from public.buzz_posts where id = $1", [buzz]));
  if (b.author_id !== null || b.author_name !== null) throw new Error("Buzz author leaked: " + JSON.stringify(b));
  if (new Date(b.created_at).getTime() !== new Date(real.visible_at).getTime() || new Date(b.created_at).getTime() === new Date(real.created_at).getTime()) throw new Error("Buzz time: " + JSON.stringify({ b: b.created_at, real }));
  if (b.title !== "Is the river district safe at night?" || b.hidden_reason !== "Harassment") throw new Error(JSON.stringify(b));
});
await expectOk("hidden list: type filter, paging by hidden_at, invalid type refused, restored content drops out", async () => {
  const apts = await as(MOD, () => rows(db.query("select * from public.admin_hidden_content_list('apartment')")), MFA);
  if (apts.length !== 1 || apts[0].target_id !== apt) throw new Error(JSON.stringify(apts));
  const first = await as(MOD, () => rows(db.query("select * from public.admin_hidden_content_list(null, 1)")), MFA);
  const second = await as(MOD, () => rows(db.query("select * from public.admin_hidden_content_list(null, 1, $1)", [first[0].hidden_at])), MFA);
  if (first[0].target_type !== "buzz" || second[0]?.target_type !== "apartment") throw new Error("paging: " + JSON.stringify([first, second]));
  await fails(() => as(MOD, () => db.query("select * from public.admin_hidden_content_list('profile')"), MFA), /Invalid content type/);
  await as(MOD, () => db.query("select public.admin_content_restore('apartment', $1)", [apt]), MFA);
  const after = await as(MOD, () => rows(db.query("select * from public.admin_hidden_content_list()")), MFA);
  if (after.length !== 1 || after[0].target_type !== "buzz") throw new Error(JSON.stringify(after));
  if (Number((await stats()).hidden_content) !== 1) throw new Error("stats did not follow the restore");
});

// ---- one report -----------------------------------------------------------------------------------
await expectOk("report get: the resolved apartment report with its reviewer, preview and author; unknown id refused", async () => {
  const r = await as(MOD, () => one(db.query("select * from public.admin_report_get($1)", [report])), MFA);
  if (r.status !== "reviewed" || r.decision !== "content_hidden" || r.notes !== "hidden" || r.reviewer_name !== "Mona Moderator") throw new Error(JSON.stringify(r));
  if (r.reporter_name !== "Tina Student" || r.reporter_email !== "tina@txstate.edu" || r.details !== "Looks fake") throw new Error(JSON.stringify(r));
  if (r.target_preview !== "Sunny room by the river" || r.target_hidden !== false || r.target_exists !== true || r.target_author_id !== S) throw new Error(JSON.stringify(r));
  await fails(() => as(MOD, () => db.query("select * from public.admin_report_get('00000000-0000-0000-0000-000000000000')"), MFA), /Report not found/);
});
await expectOk("report get: a Buzz report never names the author, and shows the thread as hidden", async () => {
  const r = await as(MOD, () => one(db.query("select * from public.admin_report_get($1)", [buzzReport])), MFA);
  if (r.target_author_id !== null || r.target_hidden !== true || r.target_exists !== true || r.target_preview !== "Is the river district safe at night?") throw new Error(JSON.stringify(r));
});
await expectOk("the audit log did not grow from any of the reads (only the hide/suspend/resolve actions wrote)", async () => {
  const actions = (await rows(db.query("select action from public.staff_audit_log order by id"))).map((r) => r.action);
  const reads = actions.filter((a) => !/^(owner\.|staff\.|invite\.|security\.|user\.|content\.(hide|restore)|report\.)/.test(a));
  if (reads.length) throw new Error("unexpected log rows: " + reads.join(", "));
});

done("ADMIN DASHBOARD");
