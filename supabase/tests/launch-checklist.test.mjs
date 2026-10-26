// "Test before launch": the user's seven checks, each proven in PGlite against every migration.
// Usage: node supabase/tests/launch-checklist.test.mjs
import { boot, read, expectOk, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const MFA = { aal: "aal2" };
const fails = async (fn, re) => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`wrong error: ${e.message}`); } throw new Error("no error"); };
const ORIGIN = "https://dskbzoqreandwwpxiplh.supabase.co/storage/v1/object/public/uploads/";
// Re-running migration 14 by hand: harmless up to migration 17. Migration 18 replaced four of its invitation functions with
// new return types, so from then on a re-run is refused outright (it would revert 18's invitation rules); refused inside a
// transaction, as the setup script and the SQL editor run it, it changes nothing.
const rerun14 = async (dbx, readx) => {
  const has18 = (await dbx.query("select to_regprocedure('public.admin_invite_resend(text)') is not null as x")).rows[0].x;
  if (!has18) return dbx.exec(readx("migrations/20261023000000_admin.sql"));
  await dbx.exec("begin");
  try { await dbx.exec(readx("migrations/20261023000000_admin.sql")); throw new Error("re-running 14 after 18 was not refused"); }
  catch (e) { if (!/cannot change return type/.test(e.message)) throw e; }
  finally { await dbx.exec("rollback"); }
};

// ---- a small world: an owner, a moderator, two students with content ----------------------------
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
const MOD = await mk("mod@txstate.edu", "Mona Moderator");
await as(OWNER, () => db.query("select public.admin_staff_add('mod@txstate.edu','moderator')"), MFA);
const S = await mk("sam@txstate.edu", "Sam Student"), T = await mk("tina@txstate.edu", "Tina Student");
const media = await one(db.query("insert into public.media (owner_id, provider_asset_id, playback_id, status) values ($1,'asset_sam_1','pb_sam_1','ready') returning id", [S]));
const VIDEO = JSON.stringify([{ media_id: media.id, playback_id: "pb_sam_1", poster_url: null, width: 720, height: 1280, duration_seconds: 10 }]);
const IMAGES = [`${ORIGIN}apartments/${S}/one.jpg`, `${ORIGIN}apartments/${S}/two.jpg`];
const apt = (await as(S, () => one(db.query(
  "insert into public.apartments (owner_id, university_id, title, description, price_per_month, address, images, videos, latitude, longitude) values ($1,$2,'Sunny room by the river','Automated test listing, bright and quiet.',650,'1 Test Street',$3,$4::jsonb,29.8899,-97.94) returning id",
  [S, TX, IMAGES, VIDEO])))).id;
const reel = (await as(S, () => one(db.query("insert into public.feed_posts (author_id, kind, body, videos) values ($1,'reel','Campus tour reel',$2::jsonb) returning id", [S, VIDEO])))).id;
const buzz = (await as(S, () => one(db.query("select public.buzz_create(p_topic => 'housing', p_title => 'Is the river district safe at night?') as id")))).id;
const conv = (await as(S, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [T])))).id;
await as(S, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'hi Tina')", [conv, S]));
await as(T, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1,'apartment',$2,'spam')", [T, apt]));
const ADMIN_RPCS = [
  "select * from public.admin_staff_list()", "select * from public.admin_invites_list()", "select * from public.admin_audit_list()",
  "select public.admin_staff_add('x@txstate.edu','moderator')", `select public.admin_staff_set_role('${OWNER}','moderator')`, `select public.admin_staff_remove('${OWNER}')`,
  `select public.admin_user_suspend('${T}','spam')`, `select public.admin_user_unsuspend('${T}')`, "select * from public.admin_restrictions_list()",
  "select public.admin_user_search('sam')", `select public.admin_user_get('${S}')`,
  `select public.admin_content_hide('apartment','${apt}','spam')`, `select public.admin_content_restore('apartment','${apt}')`, `select public.admin_content_delete('apartment','${apt}','spam')`, `select public.admin_content_get('buzz','${buzz}')`,
  "select * from public.admin_reports_list()", "select * from public.admin_media_jobs_list()", "select * from public.admin_media_jobs_stats()",
];

// 1 -------------------------------------------------------------------------------------------------
await expectOk("1. Normal users cannot access admin data or actions", async () => {
  for (const q of ADMIN_RPCS) {
    await fails(() => as(T, () => db.query(q), MFA), /^Not allowed$/);  // even with a second factor
    await fails(() => as(T, () => db.query(q)), /^Not allowed$/);
  }
  for (const t of ["staff", "staff_invites", "staff_audit_log", "account_restrictions", "media_jobs"]) {
    await fails(() => as(T, () => db.query(`select * from public.${t}`), MFA), /permission denied/);
    await fails(() => asAnon(() => db.query(`select * from public.${t}`)), /permission denied/);
  }
  for (const q of ["select * from public.admin_me()", "select * from public.admin_staff_list()", "select * from public.admin_reports_list()", "select * from public.media_jobs_claim()"]) await fails(() => asAnon(() => db.query(q)), /permission denied/);
  await fails(() => as(T, () => db.query("select * from public.media_jobs_claim()"), MFA), /permission denied/); // worker functions are for the service role only
  if ((await as(T, () => rows(db.query("select * from public.admin_me()")), MFA)).length) throw new Error("admin_me told a student something");
});

// 2 -------------------------------------------------------------------------------------------------
await expectOk("2. Users cannot give themselves admin permissions", async () => {
  await fails(() => as(T, () => db.query("insert into public.staff (user_id, role) values ($1,'owner')", [T]), MFA), /permission denied/);
  await fails(() => as(T, () => db.query("update public.staff set role = 'owner'"), MFA), /permission denied/);
  await fails(() => as(T, () => db.query("insert into public.staff_invites (email, role) values ('tina@txstate.edu','owner')"), MFA), /permission denied/);
  await fails(() => as(T, () => db.query("select public.admin_bootstrap_owner('tina@txstate.edu')"), MFA), /permission denied/);
  await fails(() => as(T, () => db.query("select public.admin_staff_add('tina@txstate.edu','owner')"), MFA), /^Not allowed$/);
  await fails(() => as(MOD, () => db.query("select public.admin_staff_set_role($1,'owner')", [MOD]), MFA), /^Not allowed$/); // a moderator cannot promote anyone, including themselves
  await fails(() => as(MOD, () => db.query("select public.admin_staff_add('mod@txstate.edu','owner')"), MFA), /^Not allowed$/);
  await fails(() => as(OWNER, () => db.query("select public.admin_staff_set_role($1,'owner')", [OWNER]), MFA), /cannot change your own role/);
  if ((await one(db.query("select count(*)::int n from public.staff"))).n !== 2) throw new Error("the team changed");
});

// 3 -------------------------------------------------------------------------------------------------
await expectOk("3. Suspensions work on web and mobile, including existing sessions", async () => {
  // Sam is signed in (an issued token). The moderator suspends Sam; Sam's very next writes fail.
  await as(MOD, () => db.query("select public.admin_user_suspend($1,'Repeated spam listings', now() + interval '7 days')", [S]), MFA);
  const mine = await as(S, () => rows(db.query("select * from public.my_restriction()"))); if (mine.length !== 1 || mine[0].reason !== "Repeated spam listings") throw new Error(JSON.stringify(mine));
  if ((await one(db.query("select banned_until from auth.users where id=$1", [S]))).banned_until === null) throw new Error("next login not blocked");
  const SUSPENDED = /Your account is suspended/;
  await fails(() => as(S, () => db.query("insert into public.apartments (owner_id, title, description, price_per_month, address) values ($1,'Another room','Ten characters at least.',500,'2 Test St')", [S])), SUSPENDED);
  await fails(() => as(S, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'still here')", [S])), SUSPENDED);
  await fails(() => as(S, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'one more')", [conv, S])), SUSPENDED);
  await fails(() => as(S, () => db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'nice')", [reel, S])), SUSPENDED);
  await fails(() => as(S, () => db.query("select public.buzz_create(p_topic => 'rant', p_title => 'They cannot stop me')")), SUSPENDED);
  await fails(() => as(S, () => db.query("select public.get_or_create_direct_conversation($1)", [OWNER])), SUSPENDED);
  await fails(() => as(S, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads',$1,$2)", [`apartments/${S}/new.jpg`, S])), /row-level security/);
  await fails(() => as(S, () => db.query("update public.profiles set bio = 'new bio' where id = $1", [S])), /row-level security/);
  // Sam can still read, and sees their own listing with the reason it is gone for others; Tina does not see it at all.
  if ((await as(S, () => rows(db.query("select id from public.apartments where id=$1", [apt])))).length !== 1) throw new Error("owner lost sight of own listing");
  if ((await as(T, () => rows(db.query("select id from public.apartments where id=$1", [apt])))).length !== 0) throw new Error("suspended user's listing still public");
  if ((await asAnon(() => rows(db.query("select id from public.feed_posts where id=$1", [reel])))).length !== 0) throw new Error("suspended user's reel still public");
  // Buzz is anonymous: the suspension changes nothing there (otherwise it would point at the author).
  if ((await asAnon(() => rows(db.query("select * from public.buzz_get($1)", [buzz])))).length !== 1) throw new Error("Buzz thread vanished with the suspension");
  // Lifting it brings everything back, on the same session.
  await as(MOD, () => db.query("select public.admin_user_unsuspend($1,'Appeal accepted')", [S]), MFA);
  if ((await one(db.query("select banned_until from auth.users where id=$1", [S]))).banned_until !== null) throw new Error("banned_until not cleared");
  await as(S, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'back again')", [S]));
  if ((await as(T, () => rows(db.query("select id from public.apartments where id=$1", [apt])))).length !== 1) throw new Error("listing did not come back");
});

// 4 -------------------------------------------------------------------------------------------------
await expectOk("4. Removed content cannot be fetched through another route", async () => {
  await as(MOD, () => db.query("select public.admin_content_hide('apartment',$1,'Scam listing reported twice')", [apt]), MFA);
  await as(MOD, () => db.query("select public.admin_content_hide('post',$1,'Not a campus tour')", [reel]), MFA);
  await as(MOD, () => db.query("select public.admin_content_hide('buzz',$1,'Doxxing')", [buzz]), MFA);
  for (const who of [(fn) => as(T, fn), (fn) => asAnon(fn), (fn) => as(MOD, fn, MFA)]) { // other users, visitors, and staff reading as ordinary users
    if ((await who(() => rows(db.query("select id from public.apartments where id=$1", [apt])))).length) throw new Error("detail page: hidden listing readable by id");
    if ((await who(() => rows(db.query("select id from public.apartments where title ilike '%river%'")))).length) throw new Error("search: hidden listing found by text");
    if ((await who(() => rows(db.query("select id from public.apartments where owner_id=$1", [S])))).length) throw new Error("profile: hidden listing listed under its owner");
    if ((await who(() => rows(db.query("select id from public.apartments_within($1, 5000)", [TX])))).some((r) => r.id === apt)) throw new Error("map: hidden listing in the radius search");
    if ((await who(() => rows(db.query("select source_id from public.reels_feed()")))).some((r) => r.source_id === reel || r.source_id === apt)) throw new Error("reels feed: hidden reel or tour still served");
    if ((await who(() => rows(db.query("select id from public.feed_posts where id=$1", [reel])))).length) throw new Error("hidden reel readable by id");
    if ((await who(() => rows(db.query("select * from public.buzz_get($1)", [buzz])))).length) throw new Error("hidden Buzz thread readable by id");
    if ((await who(() => rows(db.query("select id from public.buzz_feed()")))).some((r) => r.id === buzz)) throw new Error("hidden Buzz thread in the feed");
  }
  if ((await as(S, () => rows(db.query("select * from public.buzz_get($1)", [buzz])))).length) throw new Error("a hidden Buzz thread must be gone for its author too (same behaviour for every viewer)");
  const own = await as(S, () => one(db.query("select hidden_reason from public.apartments where id=$1", [apt]))); if (own?.hidden_reason !== "Scam listing reported twice") throw new Error("owner does not see the reason");
  // The photos and the video are queued to be pulled out of public reach.
  const jobs = await rows(db.query("select kind, ref from public.media_jobs where done_at is null order by id"));
  const q = jobs.filter((j) => j.kind === "quarantine").map((j) => j.ref).sort(); if (q.join() !== [`apartments/${S}/one.jpg`, `apartments/${S}/two.jpg`].join()) throw new Error("quarantine jobs: " + JSON.stringify(jobs));
  if (!jobs.some((j) => j.kind === "mux_disable" && j.ref === "asset_sam_1")) throw new Error("no mux_disable job");
});

// 5 -------------------------------------------------------------------------------------------------
await expectOk("5. Restoring content works", async () => {
  await as(MOD, () => db.query("select public.admin_content_restore('apartment',$1)", [apt]), MFA);
  await as(MOD, () => db.query("select public.admin_content_restore('post',$1)", [reel]), MFA);
  await as(MOD, () => db.query("select public.admin_content_restore('buzz',$1)", [buzz]), MFA);
  if ((await as(T, () => rows(db.query("select id, hidden_at from public.apartments where id=$1", [apt])))).length !== 1) throw new Error("listing not back for others");
  if (!(await asAnon(() => rows(db.query("select source_id from public.reels_feed()")))).some((r) => r.source_id === reel)) throw new Error("reel not back in the feed");
  if ((await asAnon(() => rows(db.query("select * from public.buzz_get($1)", [buzz])))).length !== 1) throw new Error("Buzz thread not back");
  const pending = await rows(db.query("select kind, ref from public.media_jobs where done_at is null order by id"));
  if (pending.some((j) => j.kind === "quarantine" || j.kind === "mux_disable")) throw new Error("hide jobs still pending after restore: " + JSON.stringify(pending));
  if (pending.filter((j) => j.kind === "release").length !== 2 || !pending.some((j) => j.kind === "mux_enable" && j.ref === "asset_sam_1")) throw new Error("release/enable jobs missing: " + JSON.stringify(pending));
  const superseded = await rows(db.query("select count(*)::int n from public.media_jobs where done_at is not null and last_error = 'superseded'")); if (superseded[0].n < 3) throw new Error("hide jobs were not superseded");
});

// 6 -------------------------------------------------------------------------------------------------
await expectOk("6. Every action records its reason and administrator", async () => {
  const log = await as(OWNER, () => rows(db.query("select * from public.admin_audit_list(200)")), MFA);
  const need = { "user.suspend": "Repeated spam listings", "content.hide": "Scam listing reported twice" };
  for (const [action, reason] of Object.entries(need)) {
    const row = log.find((l) => l.action === action && l.details.reason === reason);
    if (!row) throw new Error(`no ${action} row with its reason`);
    if (row.actor_id !== MOD || row.actor_email !== "mod@txstate.edu" || row.actor_name !== "Mona Moderator") throw new Error(`${action}: administrator missing: ${JSON.stringify(row)}`);
  }
  const lifted = log.find((l) => l.action === "user.unsuspend"); if (!lifted || lifted.details.note !== "Appeal accepted" || lifted.actor_id !== MOD) throw new Error("unsuspend not logged with its note");
  const restored = log.find((l) => l.action === "content.restore" && l.target_id === apt); if (!restored || restored.actor_id !== MOD) throw new Error("restore not logged");
  // Permanent deletion is a separate, admin-only act: a moderator cannot, the owner can, and the log keeps what was deleted and why.
  await fails(() => as(MOD, () => db.query("select public.admin_content_delete('post',$1,'Spam')", [reel]), MFA), /^Not allowed$/);
  await fails(() => as(OWNER, () => db.query("select public.admin_content_delete('post',$1,'')", [reel]), MFA), /reason/);
  await as(OWNER, () => db.query("select public.admin_content_delete('post',$1,'Spam account, reel removed for good')", [reel]), MFA);
  if ((await as(S, () => rows(db.query("select id from public.feed_posts where id=$1", [reel])))).length) throw new Error("deleted reel still exists");
  const del = (await as(OWNER, () => rows(db.query("select * from public.admin_audit_list(5)")), MFA)).find((l) => l.action === "content.delete");
  if (!del || del.actor_id !== OWNER || del.details.reason !== "Spam account, reel removed for good" || del.details.snapshot?.body !== "Campus tour reel" || del.details.snapshot?.author_id !== S) throw new Error(JSON.stringify(del));
  // Audit rows cannot be edited or removed through the API by anyone.
  await fails(() => as(OWNER, () => db.query("delete from public.staff_audit_log"), MFA), /permission denied/);
});

// 7 -------------------------------------------------------------------------------------------------
await expectOk("7. Failed media cleanup is retried", async () => {
  // The deleted reel queued its Mux asset for deletion; the worker (service role) claims it, fails, and gets it back later.
  const before = await one(db.query("select id, attempts from public.media_jobs where kind = 'mux_delete' and ref = 'asset_sam_1' and done_at is null")); if (!before) throw new Error("no mux_delete job for the deleted reel");
  await db.exec("set role service_role");
  try {
    const claimed = await rows(db.query("select * from public.media_jobs_claim(50)"));
    const job = claimed.find((j) => j.id === before.id); if (!job || job.attempts !== 1) throw new Error("claim did not hand out the job once: " + JSON.stringify(claimed.map((j) => [j.kind, j.ref, j.attempts])));
    if ((await rows(db.query("select * from public.media_jobs_claim(50)"))).length) throw new Error("claimed jobs were handed out twice");
    await db.query("select public.media_jobs_failed($1, 'Mux: 503 Service Unavailable')", [before.id]);
  } finally { await db.exec("reset role"); }
  let j = await one(db.query("select attempts, last_error, next_attempt_at > now() as later, done_at from public.media_jobs where id=$1", [before.id]));
  if (j.attempts !== 1 || j.last_error !== "Mux: 503 Service Unavailable" || j.later !== true || j.done_at !== null) throw new Error("failure not recorded for a later retry: " + JSON.stringify(j));
  // Staff can see it is failing and push it to run again now.
  const listed = (await as(MOD, () => rows(db.query("select * from public.admin_media_jobs_list()")), MFA)).find((x) => x.id === before.id); if (!listed || listed.last_error !== "Mux: 503 Service Unavailable") throw new Error("failing job not shown to staff");
  await as(MOD, () => db.query("select public.admin_media_jobs_retry($1)", [before.id]), MFA);
  j = await one(db.query("select next_attempt_at <= now() as due, last_error from public.media_jobs where id=$1", [before.id])); if (j.due !== true || j.last_error !== null) throw new Error("retry did not make the job due");
  await db.exec("set role service_role");
  try {
    const again = (await rows(db.query("select * from public.media_jobs_claim(50)"))).find((x) => x.id === before.id); if (!again || again.attempts !== 2) throw new Error("retry not claimed");
    await db.query("select public.media_jobs_done($1)", [before.id]);
  } finally { await db.exec("reset role"); }
  j = await one(db.query("select done_at, last_error from public.media_jobs where id=$1", [before.id])); if (j.done_at === null || j.last_error !== null) throw new Error("not finished");
  const stats = await as(MOD, () => one(db.query("select * from public.admin_media_jobs_stats()")), MFA); if (Number(stats.done) < 1) throw new Error("stats: " + JSON.stringify(stats));
  const retry = (await as(OWNER, () => rows(db.query("select * from public.admin_audit_list(10)")), MFA)).find((l) => l.action === "media.retry"); if (!retry || retry.actor_id !== MOD) throw new Error("retry not logged");
});
// Follow-ups from the second review of migration 15 ----------------------------------------------------
await expectOk("8. Review follow-ups: finite end dates, re-running migration 14 keeps the suspension gate, moderators do not learn a deleted Buzz author, deletion logs replies, a running media job is not retried", async () => {
  // a non-finite end date would break Supabase Auth's user loading
  await fails(() => as(MOD, () => db.query("select public.admin_user_suspend($1,'test infinity','infinity'::timestamptz)", [T]), MFA), /within 100 years/);
  await fails(() => as(MOD, () => db.query("select public.admin_user_suspend($1,'too long', now() + interval '200 years')", [T]), MFA), /within 100 years/);
  // re-applying migration 14 by hand after 15 must not revert 15's gate (after 18 the re-run is refused and changes nothing)
  await rerun14(db, read);
  const MOD2 = await mk("mod2@txstate.edu", "Max Moderator"); await as(OWNER, () => db.query("select public.admin_staff_add('mod2@txstate.edu','moderator')"), MFA);
  await as(OWNER, () => db.query("select public.admin_user_suspend($1,'Leaked a report')", [MOD2]), MFA);
  await fails(() => as(MOD2, () => db.query("select * from public.admin_staff_list()"), MFA), /Your account is suspended/);
  await fails(() => as(MOD2, () => db.query("select public.delete_my_account()"), MFA), /Contact support/);
  await as(OWNER, () => db.query("select public.admin_user_unsuspend($1)", [MOD2]), MFA);
  // permanent deletion keeps the cascaded replies in the log; moderators read the text but not the identity
  const thread = (await as(S, () => one(db.query("select public.buzz_create(p_topic => 'rant', p_title => 'Thread with evidence') as id")))).id;
  await as(T, () => db.query("select public.buzz_reply($1,'a reply with evidence')", [thread]));
  await as(OWNER, () => db.query("select public.admin_content_delete('buzz',$1,'Harassment thread, removed with its replies')", [thread]), MFA);
  const ownerView = (await as(OWNER, () => rows(db.query("select * from public.admin_audit_list(10)")), MFA)).find((l) => l.action === "content.delete" && l.target_id === thread);
  if (!ownerView || ownerView.details.snapshot.author_id !== S || ownerView.details.children_count !== 1 || ownerView.details.children[0].body !== "a reply with evidence" || ownerView.details.children[0].author_id !== T) throw new Error(JSON.stringify(ownerView?.details));
  const modView = (await as(MOD, () => rows(db.query("select * from public.admin_audit_list(10)")), MFA)).find((l) => l.action === "content.delete" && l.target_id === thread);
  if (!modView || modView.details.snapshot.title !== "Thread with evidence" || "author_id" in modView.details.snapshot || "author_email" in modView.details.snapshot || "children" in modView.details) throw new Error("moderator saw the identity: " + JSON.stringify(modView.details));
  // a job a worker just claimed cannot be handed out again by a retry until it fails or goes stale
  await as(MOD, () => db.query("select public.admin_content_hide('apartment',$1,'Checking the retry guard')", [apt]), MFA);
  const pending = await one(db.query("select id from public.media_jobs where kind = 'quarantine' and done_at is null order by id limit 1"));
  await db.exec("set role service_role"); try { await db.query("select * from public.media_jobs_claim(50)"); } finally { await db.exec("reset role"); }
  await fails(() => as(MOD, () => db.query("select public.admin_media_jobs_retry($1)", [pending.id]), MFA), /running right now/);
  await db.exec("set role service_role"); try { await db.query("select public.media_jobs_failed($1,'Storage: 500')", [pending.id]); } finally { await db.exec("reset role"); }
  await as(MOD, () => db.query("select public.admin_media_jobs_retry($1)", [pending.id]), MFA);
  await as(MOD, () => db.query("select public.admin_content_restore('apartment',$1)", [apt]), MFA);
});
done("LAUNCH-CHECKLIST");
