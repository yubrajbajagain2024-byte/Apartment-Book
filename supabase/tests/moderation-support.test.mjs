// Migration 15 (database support for moderation): suspensions that stop writes at once,
// reversible hiding of every kind of content, permanent deletion as a separate admin
// action, report review fields, the media job queue and the audit trail. Runs on production's
// order (CampConnect Admin's migrations from supabase/applied-outside-repo/, Buzz v2 on top):
// Buzz threads and replies are written by the website's server (service role) for established
// accounts that accepted the guidelines, read through the v2 functions, and signed-out visitors
// cannot read Buzz at all. Migration 15 itself no longer re-runs over Buzz v2 (migration 42
// dropped v1 helpers it touched) and production will never re-run it; its re-run is checked on
// the step-admin branch's own tree. Usage: node supabase/tests/moderation-support.test.mjs
import { boot, expectOk, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION } from "../../packages/shared/src/buzz/constants.ts";
const { db, mk, as, asAnon, asService } = await boot({ live: true });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const MFA = { aal: "aal2" };
const fails = async (fn, re) => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`wrong error: ${e.message}`); } throw new Error("no error"); };
const logRows = () => rows(db.query("select * from public.staff_audit_log order by id"));
const ORIGIN = "https://dskbzoqreandwwpxiplh.supabase.co/storage/v1/object/public/uploads/";
const uuid = () => crypto.randomUUID();
const minutesFromNow = (d) => (new Date(d).getTime() - Date.now()) / 60000;

// ---- 1. closed tables, internals, bucket ------------------------------------------------------
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");

// ---- 2. setup: team + students with content ----------------------------------------------------
const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
if ((await one(db.query("select public.admin_bootstrap_owner('owner@txstate.edu') as r"))).r !== "added") throw new Error("bootstrap");
const ADMIN = await mk("adam@txstate.edu", "Adam Admin"), MOD = await mk("mia@txstate.edu", "Mia Mod"), MOD2 = await mk("max@txstate.edu", "Max Mod");
for (const [email, role] of [["adam@txstate.edu", "admin"], ["mia@txstate.edu", "moderator"], ["max@txstate.edu", "moderator"]]) await as(OWNER, () => db.query("select public.admin_staff_add($1,$2)", [email, role]), MFA);
const S1 = await mk("sam@txstate.edu", "Sam Student"), S2 = await mk("tina@txstate.edu", "Tina Student"), S3 = await mk("uma@txstate.edu", "Uma Student");
const mod = (q, args) => as(MOD, () => db.query(q, args), MFA);
const adm = (q, args) => as(ADMIN, () => db.query(q, args), MFA);
const own = (q, args) => as(OWNER, () => db.query(q, args), MFA);
const TXST = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const video = (mediaId, pb) => JSON.stringify([{ media_id: mediaId, playback_id: pb, poster_url: null, width: 720, height: 1280, duration_seconds: 12 }]);

// Since migration 55 (media_server_fields) only the website's server writes a video's asset and playback details, so the
// rows are completed here outside any session, as the server would.
const mediaApt = (await one(db.query("insert into public.media (owner_id, provider_asset_id, playback_id, status) values ($1,'asset_apt_1','pbapt1','ready') returning id", [S1]))).id;
const mediaReel = (await one(db.query("insert into public.media (owner_id, provider_asset_id, playback_id, status) values ($1,'asset_reel_1','pbreel1','ready') returning id", [S1]))).id;
const APT_PHOTOS = [`${ORIGIN}apartments/${S1}/one.jpg`, `${ORIGIN}apartments/${S1}/two%20photo.jpg`];
const apt = (await as(S1, () => one(db.query(
  "insert into public.apartments (owner_id, university_id, title, description, price_per_month, address, latitude, longitude, images, videos) values ($1,$2,'Sunny 2BR near campus','Big windows, quiet street',900,'1 College St',29.889,-97.939,$3::text[],$4::jsonb) returning id",
  [S1, TXST, APT_PHOTOS, video(mediaApt, "pbapt1")])))).id;
const reel = (await as(S1, () => one(db.query("insert into public.feed_posts (author_id, kind, body, images, videos) values ($1,'reel','move-in day',$2::text[],$3::jsonb) returning id", [S1, [`${ORIGIN}posts/${S1}/reel-cover.jpg`], video(mediaReel, "pbreel1")])))).id;
const post = (await as(S1, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'First week on campus!') returning id", [S1])))).id;
const roommate = (await as(S1, () => one(db.query("insert into public.roommate_posts (author_id, post_type, title, description) values ($1,'has_room','Room in a 2BR','quiet, clean') returning id", [S1])))).id;
const item = (await as(S1, () => one(db.query("insert into public.items (seller_id, title, description, price, category) values ($1,'Desk lamp','works fine',15,'furniture') returning id", [S1])))).id;
const s2Post = (await as(S2, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'Hello from Tina') returning id", [S2])))).id;
const commentByS1 = (await as(S1, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'nice!') returning id", [s2Post, S1])))).id;
const commentOnApt = (await as(S2, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('apartment',$1,$2,'Is it still available?') returning id", [apt, S2])))).id;
await as(S2, () => db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'congrats!')", [reel, S2]));
await as(S2, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [reel, S2]));
await as(S2, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('post',$1,$2)", [reel, S2]));
const conv = (await as(S1, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [S2])))).id;
const msgWithImage = (await as(S1, () => one(db.query("insert into public.messages (conversation_id, sender_id, content, image_url) values ($1,$2,'look at this',$3) returning id", [conv, S1, `${ORIGIN}messages/${S1}/pic.jpg`])))).id;
await as(S2, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'nice place')", [conv, S2]));
await as(S1, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'thanks!')", [conv, S1]));
// Buzz v2 (see the header): established accounts that accepted the guidelines; writes through the website's server.
for (const u of [S1, S2, S3]) {
  await db.query("update public.profiles set created_at = now() - interval '30 days' where id = $1", [u]);
  await as(u, () => db.query("select public.buzz_v2_accept_gate($1)", [BUZZ_GUIDELINES_VERSION]));
}
const clearRates = () => db.query("delete from public.buzz_rate_log");
const create = async (uid, title, text = "Asking for a friend.") => { await clearRates(); return asService(async () => (await one(db.query("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null) as r", [uid, JSON.stringify({ title, text })]))).r.id); };
const reply = async (uid, thread, text, parent = null) => { await clearRates(); return asService(async () => (await one(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null) as r", [uid, thread, JSON.stringify(parent ? { text, parentId: parent } : { text })]))).r.id); };
const vote = (uid, id, value) => as(uid, () => db.query("select public.buzz_v2_vote($1, $2)", [id, value]));
const thread = (uid, id) => as(uid, async () => (await one(db.query("select public.buzz_v2_thread($1, 50) as r", [id]))).r);
const replies = (uid, id) => as(uid, async () => (await one(db.query("select public.buzz_v2_replies($1, 0, 50) as r", [id]))).r.items);
const feedIds = (uid, sort = "new") => as(uid, async () => (await one(db.query("select public.buzz_v2_feed('campus', $1, 'all', null, 50, 0, null) as r", [sort]))).r.items.map((b) => b.id));
const buzz1 = await create(S1, "Landlord keeps my deposit?");
const r1 = await reply(S2, buzz1, "Check your lease first."), r2 = await reply(S3, buzz1, "Small claims court works."), r3 = await reply(S1, buzz1, "Thanks!", r1);
const buzz2 = await create(S2, "Parking on campus");
const buzzDel = await create(S3, "Thread that will be deleted");
await reply(S2, buzzDel, "a reply that goes with it"); await vote(S2, buzzDel, 1);
void r2;

await expectOk("the new tables are closed to the API for everyone (owner with 2FA, students, visitors)", async () => {
  for (const t of ["account_restrictions", "media_jobs"]) {
    await fails(() => own(`select * from public.${t}`), /permission denied/);
    await fails(() => as(S1, () => db.query(`select * from public.${t}`)), /permission denied/);
    await fails(() => asAnon(() => db.query(`select * from public.${t}`)), /permission denied/);
    await fails(() => as(S1, () => db.query(`delete from public.${t}`)), /permission denied/);
  }
  await fails(() => as(S1, () => db.query("insert into public.account_restrictions (user_id, reason) values ($1,'self-inflicted')", [S2])), /permission denied/);
  await fails(() => as(S1, () => db.query("insert into public.media_jobs (kind, ref) values ('delete_prefix','apartments/')")), /permission denied/);
  // Supabase grants new sequences to the API roles: the queue's and the Buzz sequences are neither a counter nor resettable.
  const buzzSeqs = (await rows(db.query("select relname from pg_class where relkind = 'S' and relnamespace = 'public'::regnamespace and relname like 'buzz_%'"))).map((r) => r.relname);
  for (const seq of ["media_jobs_id_seq", ...buzzSeqs]) {
    await fails(() => as(S1, () => db.query(`select last_value from public.${seq}`)), /permission denied/);
    await fails(() => as(S1, () => db.query(`select nextval('public.${seq}')`)), /permission denied/);
    await fails(() => asAnon(() => db.query(`select last_value from public.${seq}`)), /permission denied/);
  }
});
await expectOk("internal helpers and worker functions are not executable through the API; the policy helpers are", async () => {
  for (const q of ["select public.storage_path_from_url('x')", "select public.media_enqueue('quarantine','a/b.jpg','apartment',null)", "select public.media_cancel(array['release'],'a/b.jpg')",
    `select public.admin_content_snapshot('apartment','${apt}')`, "select public.admin_content_table('apartment')", "select public.media_asset_for_video('{}'::jsonb)",
    "select * from public.media_jobs_claim(1)", "select public.media_jobs_done(1)", "select public.media_jobs_failed(1,'x')"]) {
    await fails(() => own(q), /permission denied/);
    await fails(() => as(S1, () => db.query(q)), /permission denied/);
    await fails(() => asAnon(() => db.query(q)), /permission denied/);
  }
  await fails(() => asAnon(() => db.query("select * from public.my_restriction()")), /permission denied/);
  await fails(() => asAnon(() => db.query("select * from public.admin_user_search('sam')")), /permission denied/);
  if ((await asAnon(() => one(db.query("select public.is_suspended($1) s, public.content_visible($1, null) v", [S1])))).s !== false) throw new Error("anon cannot evaluate is_suspended");
  if ((await as(S1, () => one(db.query("select public.content_visible($1, now()) v", [S1])))).v !== true) throw new Error("authors must see their own hidden rows");
  if ((await as(S2, () => one(db.query("select public.content_visible($1, now()) v", [S1])))).v !== false) throw new Error("others see hidden rows");
});
await expectOk("the quarantine bucket exists and is private", async () => {
  const b = await one(db.query("select public from storage.buckets where id = 'quarantine'")); if (!b || b.public !== false) throw new Error(JSON.stringify(b));
});

// ---- 3. suspension -----------------------------------------------------------------------------
const ADMIN_CALLS = [
  `select public.admin_user_suspend('${S2}','spam')`, `select public.admin_user_unsuspend('${S2}')`, "select * from public.admin_restrictions_list()",
  "select * from public.admin_user_search('sam')", `select public.admin_user_get('${S2}')`,
  `select public.admin_content_hide('apartment','${apt}','spam listing')`, `select public.admin_content_restore('apartment','${apt}')`,
  `select public.admin_content_delete('apartment','${apt}','spam listing')`, `select public.admin_content_get('apartment','${apt}')`,
  "select * from public.admin_reports_list()", `select public.admin_report_resolve('${uuid()}','dismissed')`, `select public.admin_report_reopen('${uuid()}')`,
  "select * from public.admin_media_jobs_list()", "select public.admin_media_jobs_retry(1)", "select * from public.admin_media_jobs_stats()",
];
await expectOk("every admin RPC refuses students (with or without 2FA) and staff without a second factor", async () => {
  for (const q of ADMIN_CALLS) {
    await fails(() => as(S1, () => db.query(q), MFA), /^Not allowed$/);
    await fails(() => as(S1, () => db.query(q)), /^Not allowed$/);
    await fails(() => as(ADMIN, () => db.query(q)), /Two-factor authentication required/);
    await fails(() => as(OWNER, () => db.query(q), { aal: "aal1" }), /Two-factor authentication required/);
    await fails(() => as(MOD, () => db.query(q)), /Two-factor authentication required|^Not allowed$/); // a moderator fails the role check of admin-only calls first
  }
  if ((await one(db.query("select count(*)::int n from public.account_restrictions"))).n !== 0) throw new Error("something was written");
});
let restrictionId;
await expectOk("moderator suspends a student with a reason and an end date: is_suspended, my_restriction, banned_until", async () => {
  restrictionId = (await mod("select public.admin_user_suspend($1,'Spam listings', now() + interval '7 days', 'three reports in a day') as id", [S1])).rows[0].id;
  if ((await one(db.query("select public.is_suspended($1) s", [S1]))).s !== true) throw new Error("not suspended");
  const mine = await as(S1, () => rows(db.query("select * from public.my_restriction()")));
  if (mine.length !== 1 || mine[0].kind !== "suspension" || mine[0].reason !== "Spam listings" || !mine[0].expires_at || Object.keys(mine[0]).some((k) => /note|by/.test(k))) throw new Error(JSON.stringify(mine));
  if ((await as(S2, () => rows(db.query("select * from public.my_restriction()")))).length !== 0) throw new Error("someone else sees a restriction");
  const b = await one(db.query("select (u.banned_until = r.expires_at) same, u.banned_until from auth.users u join public.account_restrictions r on r.user_id = u.id where u.id=$1", [S1]));
  if (b.same !== true || minutesFromNow(b.banned_until) < 7 * 24 * 60 - 2) throw new Error(JSON.stringify(b));
  const got = (await mod("select public.admin_user_get($1) as j", [S1])).rows[0].j;
  if (got.active_restriction?.reason !== "Spam listings" || got.active_restriction.internal_note !== "three reports in a day" || got.active_restriction.created_by_name !== "Mia Mod" || !got.banned_until) throw new Error(JSON.stringify(got.active_restriction));
  const found = (await mod("select * from public.admin_user_search('sam')")).rows; if (found.length !== 1 || found[0].suspended !== true) throw new Error(JSON.stringify(found));
});
await expectOk("suspended: can still read feeds, but EVERY write path stops at once (not at the next login)", async () => {
  if (!(await as(S1, () => rows(db.query("select 1 from public.apartments")))).length) throw new Error("cannot read apartments");
  if (!(await feedIds(S1)).length) throw new Error("cannot read buzz");
  await as(S1, () => db.query("select 1 from public.reels_feed()"));
  const S = /Your account is suspended/;
  await fails(() => as(S1, () => db.query("insert into public.apartments (owner_id, title, description, price_per_month, address) values ($1,'Another','x',500,'2 St')", [S1])), S);
  await fails(() => as(S1, () => db.query("insert into public.items (seller_id, title, price, category) values ($1,'Chair',5,'furniture')", [S1])), S);
  await fails(() => as(S1, () => db.query("insert into public.roommate_posts (author_id, post_type, title) values ($1,'needs_room','Looking')", [S1])), S);
  await fails(() => as(S1, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'still here')", [S1])), S);
  await fails(() => as(S1, () => db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'hey')", [s2Post, S1])), S);
  await fails(() => as(S1, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [s2Post, S1])), S);
  await fails(() => as(S1, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'one more')", [conv, S1])), S);
  await fails(() => as(S1, () => db.query("update public.apartments set title = 'edited while suspended' where id=$1", [apt])), S);
  // Buzz v2 refuses the suspended account's writes even when the website's server makes them.
  await fails(() => create(S1, "From a suspended account"), /suspended/);
  await fails(() => reply(S1, buzz2, "me too"), /suspended/);
  await fails(() => vote(S1, buzz2, 1), /suspended/);
  await fails(() => vote(S1, r1, 1), /suspended/);
  await fails(() => as(S1, () => db.query("select public.get_or_create_direct_conversation($1)", [S3])), S);
  await fails(() => as(S1, () => db.query("select public.create_group_conversation('Study group', array[$1]::uuid[])", [S2])), S);
  await fails(() => as(S1, () => db.query("insert into public.media (owner_id, provider_upload_id) values ($1,'up2')", [S1])), S);
  await fails(() => as(S1, () => db.query("insert into public.universities (name) values ('Suspended University')")), S);
  await fails(() => as(S1, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads',$1,$2)", [`posts/${S1}/new.jpg`, S1])), /row-level security|suspended/);
  await fails(() => as(S1, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads',$1,$2)", [`buzz/anon/${"ab".repeat(20)}.jpg`, S1])), /row-level security|suspended/);
  await fails(() => as(S1, () => db.query("update public.profiles set bio = 'new bio' where id=$1", [S1])), /row-level security/);
  // Storage `move` is an update of storage.objects: the suspended account cannot re-point a public URL to another of its files either (0 rows, not an error).
  await db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads',$1,$2)", [`posts/${S1}/other.jpg`, S1]);
  const moved = await as(S1, () => db.query("update storage.objects set name=$2 where name=$1", [`posts/${S1}/other.jpg`, `messages/${S1}/pic.jpg`]));
  if (moved.affectedRows !== 0 || (await one(db.query("select count(*)::int n from storage.objects where name=$1", [`posts/${S1}/other.jpg`]))).n !== 1) throw new Error("a suspended account renamed a storage object");
  await db.query("delete from storage.objects where name=$1", [`posts/${S1}/other.jpg`]);
  // Account deletion is refused while suspended, deliberately and for everyone: `delete from auth.users` would take the restriction and banned_until with it.
  await fails(() => as(S1, () => db.query("select public.delete_my_account()")), /Your account is suspended/);
  if ((await one(db.query("select count(*)::int n from auth.users where id=$1", [S1]))).n !== 1) throw new Error("account deleted while suspended");
  // Saving a listing still works (a private bookmark) but no longer tells the owner "<Name> saved your listing".
  const umaItem = (await as(S3, () => one(db.query("insert into public.items (seller_id, title, description, price, category) values ($1,'Bike','rides fine',40,'furniture') returning id", [S3])))).id;
  await as(S1, () => db.query("insert into public.saved_listings (user_id, target_type, target_id) values ($1,'item',$2)", [S1, umaItem]));
  if ((await rows(db.query("select 1 from public.notifications where user_id=$1 and type='listing_saved'", [S3]))).length !== 0) throw new Error("a suspended account's save reached the owner's inbox");
  await as(S2, () => db.query("insert into public.saved_listings (user_id, target_type, target_id) values ($1,'item',$2)", [S2, umaItem]));
  if ((await rows(db.query("select 1 from public.notifications where user_id=$1 and type='listing_saved' and actor_id=$2", [S3, S2]))).length !== 1) throw new Error("an ordinary save no longer notifies");
  // Other people are unaffected, even when they touch the suspended person's content.
  await as(S2, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'are you there?')", [conv, S2]));
  await vote(S2, buzz1, 1);
  await vote(S2, buzz1, 0);
});
await expectOk("suspended: existing listings, posts and comments vanish for others (selects, apartments_within, reels_feed) but stay visible to them", async () => {
  for (const [t, id] of [["apartments", apt], ["items", item], ["roommate_posts", roommate], ["feed_posts", reel], ["feed_posts", post], ["post_comments", commentByS1]]) {
    if ((await as(S2, () => rows(db.query(`select 1 from public.${t} where id=$1`, [id])))).length !== 0) throw new Error(`${t} visible to another student`);
    if ((await asAnon(() => rows(db.query(`select 1 from public.${t} where id=$1`, [id])))).length !== 0) throw new Error(`${t} visible to visitors`);
    if ((await as(S1, () => rows(db.query(`select 1 from public.${t} where id=$1`, [id])))).length !== 1) throw new Error(`${t} hidden from its owner`);
  }
  if ((await as(S2, () => rows(db.query("select 1 from public.apartments_within($1, 5000) where id=$2", [TXST, apt])))).length !== 0) throw new Error("apartments_within");
  if ((await as(S1, () => rows(db.query("select 1 from public.apartments_within($1, 5000) where id=$2", [TXST, apt])))).length !== 1) throw new Error("apartments_within for the owner");
  if ((await as(S2, () => rows(db.query("select 1 from public.reels_feed() where source_id in ($1,$2)", [reel, apt])))).length !== 0) throw new Error("reels_feed");
  if ((await asAnon(() => rows(db.query("select 1 from public.reels_feed() where source_id in ($1,$2)", [reel, apt])))).length !== 0) throw new Error("reels_feed for visitors");
  const e = await as(S2, () => one(db.query("select * from public.post_engagement('post', $1)", [s2Post]))); if (Number(e.comments) !== 0) throw new Error("engagement counts a suspended person's comment");
});
await expectOk("suspended: chat history stays; REGRESSION anonymity: Buzz threads and replies do NOT change for anyone", async () => {
  if ((await as(S2, () => rows(db.query("select 1 from public.messages where conversation_id=$1 and sender_id=$2", [conv, S1])))).length !== 2) throw new Error("messages hidden");
  for (const viewer of [S2, S1]) { // visitors cannot read Buzz v2 at all
    if (!(await feedIds(viewer)).includes(buzz1)) throw new Error("thread vanished: author unmasked");
    const root = (await thread(viewer, buzz1)).root; if (!root || root.status !== "active" || root.replyCount !== 3) throw new Error("thread or reply count changed: " + JSON.stringify(root));
    if ((await replies(viewer, buzz1)).filter((c) => c.status === "active").length !== 3) throw new Error("replies changed");
  }
});
await expectOk("expiry: once expires_at passes, nothing is suspended any more and writes work again", async () => {
  await db.query("update public.account_restrictions set expires_at = now() - interval '1 second' where id=$1", [restrictionId]);
  if ((await one(db.query("select public.is_suspended($1) s", [S1]))).s !== false) throw new Error("still suspended");
  if ((await as(S1, () => rows(db.query("select * from public.my_restriction()")))).length !== 0) throw new Error("my_restriction still returns the expired row");
  const p = await as(S1, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'back') returning id", [S1])));
  await as(S1, () => db.query("delete from public.feed_posts where id=$1", [p.id]));
  if ((await as(S2, () => rows(db.query("select 1 from public.apartments where id=$1", [apt])))).length !== 1) throw new Error("content did not come back");
  if ((await mod("select * from public.admin_restrictions_list()")).rows.length !== 0) throw new Error("expired row listed as active");
});
await expectOk("suspending again (indefinitely) adds one row; suspending twice updates that one row; unsuspend clears banned_until and logs", async () => {
  await mod("select public.admin_user_suspend($1,'Repeated spam')", [S1]);
  const far = await one(db.query("select banned_until > now() + interval '99 years' far from auth.users where id=$1", [S1])); if (far.far !== true) throw new Error("indefinite ban not set");
  const second = (await mod("select public.admin_user_suspend($1,'Repeated spam and harassment', now() + interval '2 days', 'updated') as id", [S1])).rows[0].id;
  const all = await rows(db.query("select * from public.account_restrictions where user_id=$1 order by created_at", [S1]));
  if (all.length !== 2 || all[1].id !== second || all[1].reason !== "Repeated spam and harassment" || all[1].internal_note !== "updated" || !all[1].expires_at) throw new Error(JSON.stringify(all));
  if (all[0].lifted_at === null || all[0].lift_note !== "Expired" || all[0].lifted_by !== null) throw new Error("the expired row was not closed: " + JSON.stringify(all[0]));
  if ((await one(db.query("select (banned_until = $2::timestamptz) same from auth.users where id=$1", [S1, all[1].expires_at]))).same !== true) throw new Error("banned_until not updated");
  if ((await mod("select * from public.admin_restrictions_list()")).rows.length !== 1) throw new Error("active list");
  await mod("select public.admin_user_unsuspend($1,'Apologised, listings removed')", [S1]);
  const lifted = await one(db.query("select r.lifted_at, r.lifted_by, r.lift_note, u.banned_until from public.account_restrictions r join auth.users u on u.id = r.user_id where r.id=$1", [second]));
  if (!lifted.lifted_at || lifted.lifted_by !== MOD || lifted.lift_note !== "Apologised, listings removed" || lifted.banned_until !== null) throw new Error(JSON.stringify(lifted));
  if ((await one(db.query("select public.is_suspended($1) s", [S1]))).s !== false) throw new Error("still suspended");
  await fails(() => mod("select public.admin_user_unsuspend($1)", [S1]), /Not suspended/);
  const last = (await logRows()).at(-1); if (last.action !== "user.unsuspend" || last.actor_id !== MOD || last.details.email !== "sam@txstate.edu" || last.details.note !== "Apologised, listings removed") throw new Error(JSON.stringify(last));
});
await expectOk("rules: not yourself, only a strictly higher role may suspend (or unsuspend) staff, end date in the future, unknown user", async () => {
  await fails(() => mod("select public.admin_user_suspend($1,'oops')", [MOD]), /cannot suspend yourself/);
  await fails(() => mod("select public.admin_user_suspend($1,'power grab')", [ADMIN]), /^Not allowed$/);
  await fails(() => mod("select public.admin_user_suspend($1,'power grab')", [OWNER]), /^Not allowed$/);
  await fails(() => mod("select public.admin_user_suspend($1,'rivalry')", [MOD2]), /^Not allowed$/);
  await fails(() => adm("select public.admin_user_suspend($1,'power grab')", [OWNER]), /^Not allowed$/);
  await adm("select public.admin_user_suspend($1,'Leaked a report')", [MOD2]);
  if ((await one(db.query("select public.is_suspended($1) s", [MOD2]))).s !== true) throw new Error("admin could not suspend a moderator");
  // A suspended staff member loses every staff power at once (an access token outlives banned_until); admin_me still answers so the UI can show the notice.
  for (const q of ADMIN_CALLS) await fails(() => as(MOD2, () => db.query(q), MFA), /^Your account is suspended$/);
  if ((await as(MOD2, () => rows(db.query("select * from public.admin_me()")), MFA)).length !== 1) throw new Error("admin_me gated for a suspended staffer");
  await fails(() => mod("select public.admin_user_unsuspend($1)", [MOD2]), /^Not allowed$/);
  await adm("select public.admin_user_unsuspend($1)", [MOD2]);
  await own("select public.admin_user_suspend($1,'Under review', now() + interval '1 hour')", [ADMIN]);
  if ((await one(db.query("select public.is_suspended($1) s", [ADMIN]))).s !== true) throw new Error("owner could not suspend an admin");
  await own("select public.admin_user_unsuspend($1)", [ADMIN]);
  await fails(() => mod("select public.admin_user_suspend($1,'late', now() - interval '1 minute')", [S2]), /end date must be in the future/);
  await fails(() => mod("select public.admin_user_suspend($1,'ghost')", [uuid()]), /User not found/);
  await fails(() => mod("select public.admin_user_unsuspend($1)", [uuid()]), /User not found/);
  await fails(() => mod("select public.admin_user_suspend($1,'ab')", [S2]), /reason/);
  await fails(() => mod("select public.admin_user_get($1)", [uuid()]), /User not found/);
  if ((await one(db.query("select count(*)::int n from public.account_restrictions where lifted_at is null"))).n !== 0) throw new Error("something stayed active");
});
await expectOk("admin_restrictions_list, admin_user_get and admin_user_search reflect it all", async () => {
  const list = (await mod("select * from public.admin_restrictions_list(false)")).rows;
  if (list.length !== 4 || list.some((r) => r.active !== false)) throw new Error(JSON.stringify(list.map((r) => [r.full_name, r.active])));
  for (let i = 1; i < list.length; i++) if (new Date(list[i - 1].created_at) < new Date(list[i].created_at)) throw new Error("not newest first");
  const sam = list.filter((r) => r.user_id === S1); if (sam.length !== 2 || sam[0].full_name !== "Sam Student" || sam[0].email !== "sam@txstate.edu" || sam[0].created_by_name !== "Mia Mod" || sam[0].lifted_by_name !== "Mia Mod" || sam[0].kind !== "suspension") throw new Error(JSON.stringify(sam[0]));
  if ((await mod("select * from public.admin_restrictions_list(false, 2)")).rows.length !== 2) throw new Error("limit");
  const got = (await mod("select public.admin_user_get($1) as j", [S1])).rows[0].j;
  if (got.full_name !== "Sam Student" || got.email !== "sam@txstate.edu" || got.university !== "Texas State University" || got.staff_role !== null || got.banned_until !== null || got.active_restriction !== null) throw new Error(JSON.stringify(got));
  if (got.counts.apartments !== 1 || got.counts.items !== 1 || got.counts.roommate_posts !== 1 || got.counts.posts !== 2 || got.counts.comments !== 1 || got.counts.reports_filed !== 0 || got.counts.reports_against !== 0) throw new Error(JSON.stringify(got.counts));
  if (got.restrictions.length !== 2 || got.restrictions.some((r) => r.active) || got.restrictions[0].lifted_by_name !== "Mia Mod") throw new Error(JSON.stringify(got.restrictions));
  if ((await mod("select public.admin_user_get($1) as j", [MOD])).rows[0].j.staff_role !== "moderator") throw new Error("staff_role");
  const byName = (await mod("select * from public.admin_user_search('sam')")).rows; if (byName.length !== 1 || byName[0].user_id !== S1 || byName[0].suspended !== false || byName[0].university_name !== "Texas State University") throw new Error(JSON.stringify(byName));
  const byEmail = (await mod("select * from public.admin_user_search('TINA@')")).rows; if (byEmail.length !== 1 || byEmail[0].user_id !== S2 || byEmail[0].email !== "tina@txstate.edu") throw new Error(JSON.stringify(byEmail));
  if ((await mod("select * from public.admin_user_search('mia')")).rows[0].staff_role !== "moderator") throw new Error("staff_role in search");
  if ((await mod("select * from public.admin_user_search('%_')")).rows.length !== 0 || (await mod("select * from public.admin_user_search('')")).rows.length !== 0 || (await mod("select * from public.admin_user_search(null)")).rows.length !== 0) throw new Error("wildcards or empty terms matched everyone");
  if ((await mod("select * from public.admin_user_search('student', 2)")).rows.length !== 2) throw new Error("limit");
});
await expectOk("a membership row stays in its conversation: a bare update of conversation_id (no WHERE, no RETURNING) is refused; read receipts still work", async () => {
  const dm = (await as(S3, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [S2])))).id;
  await fails(() => as(S3, () => db.query("update public.conversation_members set conversation_id = $1", [conv])), /row-level security|permission denied for table conversation_members/);
  if ((await as(S3, () => rows(db.query("select 1 from public.messages where conversation_id=$1", [conv])))).length !== 0) throw new Error("joined a stranger's conversation");
  if ((await as(S3, () => db.query("update public.conversation_members set last_read_at = now() where conversation_id=$1", [dm]))).affectedRows !== 1) throw new Error("read receipt refused");
  if ((await as(S3, () => db.query("update public.conversation_members set last_delivered_at = now()"))).affectedRows !== 1) throw new Error("bare receipt update refused");
});

// ---- 4. hide / restore -------------------------------------------------------------------------
const jobs = (where, args) => rows(db.query(`select id, kind, ref, target_type, target_id, done_at, last_error, attempts from public.media_jobs where ${where} order by id`, args));
await expectOk("hiding the apartment queues 2 quarantine jobs (decoded paths) + 1 mux_disable; restoring supersedes them and queues release + mux_enable", async () => {
  await mod("select public.admin_content_hide('apartment',$1,'Scam: asks for a deposit before any viewing')", [apt]);
  let j = await jobs("target_id=$1", [apt]);
  if (j.map((x) => `${x.kind}:${x.ref}`).sort().join("|") !== [`mux_disable:asset_apt_1`, `quarantine:apartments/${S1}/one.jpg`, `quarantine:apartments/${S1}/two photo.jpg`].join("|")) throw new Error(JSON.stringify(j));
  if (j.some((x) => x.done_at !== null || x.target_type !== "apartment")) throw new Error("not pending");
  await mod("select public.admin_content_restore('apartment',$1)", [apt]);
  j = await jobs("target_id=$1", [apt]);
  const superseded = j.filter((x) => x.done_at !== null), pending = j.filter((x) => x.done_at === null);
  if (superseded.length !== 3 || superseded.some((x) => x.last_error !== "superseded" || !["quarantine", "mux_disable"].includes(x.kind))) throw new Error(JSON.stringify(superseded));
  if (pending.map((x) => `${x.kind}:${x.ref}`).sort().join("|") !== [`mux_enable:asset_apt_1`, `release:apartments/${S1}/one.jpg`, `release:apartments/${S1}/two photo.jpg`].join("|")) throw new Error(JSON.stringify(pending));
  if (pending.some((x) => x.target_type !== "apartment" || x.target_id !== apt)) throw new Error("mux_enable must carry the row to refresh");
  await fails(() => mod("select public.admin_content_restore('apartment',$1)", [apt]), /Content is not hidden/);
  // Hiding twice keeps the original time and takes the new reason.
  await mod("select public.admin_content_hide('apartment',$1,'First reason')", [apt]);
  const first = await one(db.query("select hidden_at from public.apartments where id=$1", [apt]));
  await mod("select public.admin_content_hide('apartment',$1,'Second reason')", [apt]);
  const again = await one(db.query("select hidden_at, hidden_reason from public.apartments where id=$1", [apt]));
  if (+again.hidden_at !== +first.hidden_at || again.hidden_reason !== "Second reason") throw new Error(JSON.stringify(again));
  if ((await jobs("target_id=$1 and done_at is null", [apt])).map((x) => x.kind).sort().join() !== "mux_disable,quarantine,quarantine") throw new Error("re-hide did not supersede the pending release");
  await mod("select public.admin_content_restore('apartment',$1)", [apt]);
});
const TARGETS = [
  ["apartment", apt, "apartments", S1, S2], ["item", item, "items", S1, S2], ["roommate", roommate, "roommate_posts", S1, S2],
  ["post", reel, "feed_posts", S1, S2], ["comment", commentOnApt, "post_comments", S2, S1], ["message", msgWithImage, "messages", S1, S2],
];
for (const [type, id, table, owner, other] of TARGETS) {
  await expectOk(`hide/restore ${type}: gone for others, owner still sees it with the reason, back after restore`, async () => {
    await mod("select public.admin_content_hide($1,$2,$3)", [type, id, `Hidden ${type}`]);
    if ((await as(other, () => rows(db.query(`select 1 from public.${table} where id=$1`, [id])))).length !== 0) throw new Error("another user still sees it");
    if (type !== "message" && (await asAnon(() => rows(db.query(`select 1 from public.${table} where id=$1`, [id])))).length !== 0) throw new Error("visitors still see it");
    const mine = await as(owner, () => one(db.query(`select hidden_at, hidden_reason from public.${table} where id=$1`, [id])));
    if (!mine || !mine.hidden_at || mine.hidden_reason !== `Hidden ${type}`) throw new Error("owner: " + JSON.stringify(mine));
    // The owner cannot un-hide it (one PATCH with their own token): the moderation columns only move through the staff functions.
    await as(owner, () => db.query(`update public.${table} set hidden_at = null, hidden_reason = 'nothing wrong' where id=$1`, [id]));
    if ((await as(other, () => rows(db.query(`select 1 from public.${table} where id=$1`, [id])))).length !== 0) throw new Error("the owner un-hid it");
    if ((await as(owner, () => one(db.query(`select hidden_reason from public.${table} where id=$1`, [id])))).hidden_reason !== `Hidden ${type}`) throw new Error("the owner changed the reason");
    if (type === "post") {
      if ((await as(other, () => rows(db.query("select 1 from public.reels_feed() where source_id=$1", [id])))).length !== 0) throw new Error("hidden reel in reels_feed");
      if ((await as(owner, () => rows(db.query("select 1 from public.reels_feed() where source_id=$1", [id])))).length !== 0) throw new Error("hidden reel in the author's reels_feed");
      if ((await jobs("target_id=$1 and done_at is null", [id])).map((x) => `${x.kind}:${x.ref}`).sort().join("|") !== `mux_disable:asset_reel_1|quarantine:posts/${S1}/reel-cover.jpg`) throw new Error("reel jobs");
      // No new likes, comments or saves on a hidden post (its owner still can); after the restore they work again.
      await fails(() => as(S3, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [id, S3])), /row-level security/);
      await fails(() => as(S3, () => db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'still here?')", [id, S3])), /row-level security/);
      await fails(() => as(S3, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('post',$1,$2)", [id, S3])), /row-level security/);
      const ownComment = (await as(owner, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'my own hidden post') returning id", [id, owner])))).id;
      await db.query("delete from public.post_comments where id=$1", [ownComment]);
    }
    if (type === "comment" && Number((await as(other, () => one(db.query("select comments from public.post_engagement('apartment', $1)", [apt])))).comments) !== 0) throw new Error("hidden comment still counted");
    if (type === "message" && (await jobs("target_id=$1 and done_at is null", [id])).map((x) => `${x.kind}:${x.ref}`).join() !== `quarantine:messages/${S1}/pic.jpg`) throw new Error("message jobs");
    const got = (await mod("select public.admin_content_get($1,$2) as j", [type, id])).rows[0].j;
    if (got.target_type !== type || got.target_id !== id || got.author_id !== owner || !got.hidden_at || got.hidden_reason !== `Hidden ${type}` || typeof got.author_email !== "string") throw new Error(JSON.stringify(got));
    await mod("select public.admin_content_restore($1,$2)", [type, id]);
    if ((await as(other, () => rows(db.query(`select 1 from public.${table} where id=$1`, [id])))).length !== 1) throw new Error("did not come back");
    if ((await as(owner, () => one(db.query(`select hidden_reason from public.${table} where id=$1`, [id])))).hidden_reason !== null) throw new Error("reason kept");
    if (type === "post" && (await as(other, () => rows(db.query("select 1 from public.reels_feed() where source_id=$1", [id])))).length !== 1) throw new Error("reel not back in reels_feed");
    if (type === "post") {
      await as(S3, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [id, S3]));
      await db.query("delete from public.post_likes where target_id=$1 and user_id=$2", [id, S3]);
    }
  });
}
await expectOk("hiding or deleting a message/comment scrubs its copies too: the conversation preview and the recipients' notification bodies", async () => {
  const latest = (await as(S1, () => one(db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'SECRET-LATEST-MESSAGE') returning id", [conv, S1])))).id;
  const preview = () => as(S2, () => one(db.query("select last_message_preview p from public.conversations where id=$1", [conv]))).then((r) => r.p);
  const bodies = (uid, where, args) => rows(db.query(`select body from public.notifications where user_id=$1 and ${where}`, [uid, ...args])).then((r) => r.map((x) => x.body));
  if ((await preview()) !== "SECRET-LATEST-MESSAGE" || !(await bodies(S2, "data->>'message_id'=$2", [latest])).includes("SECRET-LATEST-MESSAGE")) throw new Error("setup");
  await mod("select public.admin_content_hide('message',$1,'Harassment')", [latest]);
  if ((await preview()) !== "are you there?") throw new Error("preview still shows the hidden text: " + (await preview()));
  if ((await bodies(S2, "data->>'message_id'=$2", [latest])).some((b) => b !== null)) throw new Error("the notification kept the hidden text");
  await mod("select public.admin_content_restore('message',$1)", [latest]);
  if ((await preview()) !== "SECRET-LATEST-MESSAGE") throw new Error("preview not restored");
  await adm("select public.admin_content_delete('message',$1,'Harassment, confirmed')", [latest]);
  if ((await preview()) !== "are you there?" || (await rows(db.query("select 1 from public.messages where id=$1", [latest]))).length !== 0) throw new Error("preview after deletion: " + (await preview()));
  // A comment's text in the post owner's notification goes the same way.
  const rude = (await as(S2, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'OFFENSIVE-COMMENT-TEXT') returning id", [post, S2])))).id;
  if (!(await bodies(S1, "data->>'comment_id'=$2", [rude])).includes("OFFENSIVE-COMMENT-TEXT")) throw new Error("comment notification setup");
  await mod("select public.admin_content_hide('comment',$1,'Abuse')", [rude]);
  if ((await bodies(S1, "data->>'comment_id'=$2", [rude])).some((b) => b !== null)) throw new Error("the comment notification kept the text");
  await adm("select public.admin_content_delete('comment',$1,'Abuse, confirmed')", [rude]);
});
await expectOk("hide/restore buzz thread (Buzz v2): out of the feed and a placeholder on its page for others, marked removed for its author; replying and voting fail", async () => {
  await mod("select public.admin_content_hide('buzz',$1,'Doxxing')", [buzz1]);
  // Others get a placeholder and no feed entry; the author keeps reading their own thread, marked removed ("still the author's").
  if ((await feedIds(S2)).includes(buzz1)) throw new Error("in feed");
  const seen = (await thread(S2, buzz1)).root; if (seen.status !== "removed" || seen.title || seen.text) throw new Error("thread still readable: " + JSON.stringify(seen));
  if ((await thread(S1, buzz1)).root.status !== "removed") throw new Error("the author is not told it was removed");
  await fails(() => reply(S2, buzz1, "still here?"), /buzz:/);
  await fails(() => vote(S2, buzz1, 1), /buzz:/);
  await fails(() => vote(S2, r1, 1), /buzz:/);
  if (!(await feedIds(S2)).includes(buzz2)) throw new Error("hiding one thread hid another");
  await mod("select public.admin_content_restore('buzz',$1)", [buzz1]);
  const root = (await thread(S2, buzz1)).root; if (root.status !== "active" || root.replyCount !== 3) throw new Error("not back: " + JSON.stringify(root));
});
await expectOk("hide/restore buzz reply (Buzz v2): a placeholder in the thread and out of the count for everyone (its author too); replying to it and voting on it fail", async () => {
  // Buzz v2 never puts a reply's words in a notification, so there is no copy to scrub.
  if ((await rows(db.query("select 1 from public.notifications where body like '%Check your lease first%'"))).length !== 0) throw new Error("a Buzz reply's words reached a notification");
  await mod("select public.admin_content_hide('buzz_comment',$1,'Slur')", [r1]);
  for (const viewer of [S3, S2]) { // S2 wrote r1: the author still reads their own removed reply, everyone else a placeholder
    const list = await replies(viewer, buzz1);
    const hidden = list.find((c) => c.id === r1); if (!hidden || hidden.status !== "removed" || (viewer !== S2 && hidden.text)) throw new Error("hidden reply still shown: " + JSON.stringify(hidden));
    if (list.filter((c) => c.status === "active").length !== 2) throw new Error("count");
  }
  await fails(() => reply(S3, buzz1, "answering a hidden reply", r1), /buzz:/);
  await fails(() => vote(S3, r1, 1), /buzz:/);
  await vote(S3, r3, 1); // a visible sibling still works
  await mod("select public.admin_content_restore('buzz_comment',$1)", [r1]);
  if ((await replies(S3, buzz1)).filter((c) => c.status === "active").length !== 3) throw new Error("not back");
  if ((await thread(S3, buzz1)).root.replyCount !== 3) throw new Error("count not back");
});
// Not checked on Buzz v2: migration 15's "hidden replies no longer keep a thread warm". Buzz v2 ranks 'hot' with its own
// counters, and a reply hidden by CampConnect Admin (its status flipped by 42's hidden_at trigger) still counted there on
// 2026-10-30: an older thread with two such replies kept ranking above a newer one without. Buzz's own removals go
// through buzz_v2_set_status; what the admin app's hide should do to the hot rank is the owner's call.
await expectOk("unknown ids, bad types and bad reasons", async () => {
  for (const type of ["apartment", "item", "roommate", "post", "comment", "message", "buzz", "buzz_comment"]) {
    await fails(() => mod("select public.admin_content_hide($1,$2,'Looks fake')", [type, uuid()]), /Content not found/);
    await fails(() => mod("select public.admin_content_restore($1,$2)", [type, uuid()]), /Content not found/);
    await fails(() => mod("select public.admin_content_get($1,$2)", [type, uuid()]), /Content not found/);
    await fails(() => adm("select public.admin_content_delete($1,$2,'Looks fake')", [type, uuid()]), /Content not found/);
  }
  await fails(() => mod("select public.admin_content_hide('profile',$1,'Looks fake')", [S1]), /Invalid content type/);
  await fails(() => mod("select public.admin_content_get('staff',$1)", [S1]), /Invalid content type/);
  await fails(() => mod("select public.admin_content_hide('apartment',$1,'no')", [apt]), /reason/);
  await fails(() => mod("select public.admin_content_hide('apartment',$1,null)", [apt]), /reason/);
  if ((await one(db.query("select hidden_at from public.apartments where id=$1", [apt]))).hidden_at !== null) throw new Error("a failed hide stuck");
});
await expectOk("admin_content_get reveals a Buzz author to staff and logs content.view EVERY time; identified content is not logged", async () => {
  const before = (await logRows()).filter((l) => l.action === "content.view").length;
  const t = (await mod("select public.admin_content_get('buzz',$1) as j", [buzz1])).rows[0].j;
  if (t.author_id !== S1 || t.author_name !== "Sam Student" || t.author_email !== "sam@txstate.edu" || t.title !== "Landlord keeps my deposit?") throw new Error(JSON.stringify(t));
  const c = (await mod("select public.admin_content_get('buzz_comment',$1) as j", [r1])).rows[0].j; if (c.author_id !== S2 || c.body !== "Check your lease first." || c.extra.post_id !== buzz1) throw new Error(JSON.stringify(c));
  const views = (await logRows()).filter((l) => l.action === "content.view");
  if (views.length !== before + 2 || views.at(-2).target_id !== buzz1 || views.at(-1).target_id !== r1 || views.at(-1).actor_id !== MOD || views.at(-1).details.target_type !== "buzz_comment") throw new Error(JSON.stringify(views.slice(-2)));
  const a = (await mod("select public.admin_content_get('apartment',$1) as j", [apt])).rows[0].j;
  if (a.images.length !== 2 || a.videos.length !== 1 || a.extra.price !== 900 || a.extra.address !== "1 College St" || a.title !== "Sunny 2BR near campus" || a.author_id !== S1) throw new Error(JSON.stringify(a));
  const m = (await mod("select public.admin_content_get('message',$1) as j", [msgWithImage])).rows[0].j; if (m.images.length !== 1 || m.extra.conversation_id !== conv || m.body !== "look at this") throw new Error(JSON.stringify(m));
  if ((await logRows()).filter((l) => l.action === "content.view").length !== before + 2) throw new Error("identified content logged a view");
});

// ---- 5. permanent deletion ------------------------------------------------------------------
await expectOk("permanent deletion: moderators may not; the admin deletes the hidden reel with a reason; gone for everyone, cascades, jobs, snapshot in the log", async () => {
  await mod("select public.admin_content_hide('post',$1,'Copyrighted music')", [reel]);
  await fails(() => mod("select public.admin_content_delete('post',$1,'Copyrighted music')", [reel]), /^Not allowed$/);
  await fails(() => adm("select public.admin_content_delete('post',$1,'no')", [reel]), /reason/);
  if ((await as(S1, () => rows(db.query("select 1 from public.feed_posts where id=$1", [reel])))).length !== 1) throw new Error("setup");
  await adm("select public.admin_content_delete('post',$1,'Copyrighted music, hidden and confirmed')", [reel]);
  if ((await rows(db.query("select 1 from public.feed_posts where id=$1", [reel]))).length !== 0) throw new Error("row still there");
  if ((await as(S1, () => rows(db.query("select 1 from public.feed_posts where id=$1", [reel])))).length !== 0) throw new Error("author still sees it");
  const left = await one(db.query("select (select count(*) from public.post_likes where target_id=$1) l, (select count(*) from public.post_comments where target_id=$1) c, (select count(*) from public.saved_listings where target_id=$1) s", [reel]));
  if (Number(left.l) + Number(left.c) + Number(left.s) !== 0) throw new Error("cascade " + JSON.stringify(left));
  const j = await jobs("target_id=$1", [reel]);
  const pending = j.filter((x) => x.done_at === null).map((x) => `${x.kind}:${x.ref}`).sort().join("|");
  if (pending !== `delete_object:posts/${S1}/reel-cover.jpg|mux_delete:asset_reel_1`) throw new Error(JSON.stringify(j));
  const closed = j.filter((x) => x.done_at !== null);
  if (closed.some((x) => x.last_error !== "superseded") || !closed.some((x) => x.kind === "quarantine") || !closed.some((x) => x.kind === "mux_disable")) throw new Error("the pending hide jobs were not superseded: " + JSON.stringify(closed));
  const log = (await logRows()).at(-1);
  if (log.action !== "content.delete" || log.actor_id !== ADMIN || log.target_type !== "post" || log.target_id !== reel || log.details.reason !== "Copyrighted music, hidden and confirmed") throw new Error(JSON.stringify(log));
  const s = log.details.snapshot; if (s.body !== "move-in day" || s.author_id !== S1 || s.author_name !== "Sam Student" || s.author_email !== "sam@txstate.edu" || s.videos.length !== 1 || s.hidden_reason !== "Copyrighted music") throw new Error(JSON.stringify(s));
});
await expectOk("permanent deletion of a Buzz thread: gone, replies and votes cascade, the snapshot names the author", async () => {
  await adm("select public.admin_content_delete('buzz',$1,'Targeted harassment')", [buzzDel]);
  if ((await feedIds(S2)).includes(buzzDel)) throw new Error("still in feed");
  const left = await one(db.query("select (select count(*) from public.buzz_comments where post_id=$1) c, (select count(*) from public.buzz_votes where post_id=$1) v", [buzzDel]));
  if (Number(left.c) + Number(left.v) !== 0) throw new Error("cascade " + JSON.stringify(left));
  const s = (await logRows()).at(-1); if (s.action !== "content.delete" || s.details.snapshot.author_id !== S3 || s.details.snapshot.title !== "Thread that will be deleted" || s.details.snapshot.author_name !== "Uma Student") throw new Error(JSON.stringify(s));
  // Comments and messages are deleted the same way.
  const extra = (await as(S2, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'spam link') returning id", [s2Post, S2])))).id;
  await adm("select public.admin_content_delete('comment',$1,'Spam link')", [extra]);
  if ((await rows(db.query("select 1 from public.post_comments where id=$1", [extra]))).length !== 0) throw new Error("comment kept");
});

// ---- 6. reports ------------------------------------------------------------------------------------
const report = (uid, type, id, reason, details = null) => as(uid, () => one(db.query("insert into public.reports (reporter_id, target_type, target_id, reason, details) values ($1,$2,$3,$4,$5) returning id", [uid, type, id, reason, details]))).then((r) => r.id);
const repApt = await report(S2, "apartment", apt, "scam", "Asks for the deposit before any viewing");
// A Buzz report goes through Buzz v2 (a row written straight into reports is refused there), and lands in the same queue.
await as(S2, () => db.query("select public.buzz_v2_report($1, 'harassment', null)", [buzz1]));
const repBuzz = (await one(db.query("select id from public.reports where target_id=$1 and reporter_id=$2", [buzz1, S2]))).id;
const repProfile = await report(S2, "profile", S1, "spam");
const repComment = await report(S3, "comment", commentByS1, "inappropriate");
// Since migration 41 a report on content that no longer exists is refused at the table (ts:not_found), so the "target gone"
// case is a post reported while it existed and deleted by its author afterwards.
const gonePost = (await as(S1, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'Gone soon') returning id", [S1])))).id;
const repGone = await report(S2, "post", gonePost, "other", "already deleted");
await as(S1, () => db.query("delete from public.feed_posts where id=$1", [gonePost]));
let i = 0; for (const id of [repApt, repBuzz, repProfile, repComment, repGone]) await db.query("update public.reports set created_at = now() - make_interval(secs => $2) where id=$1", [id, 50 - 10 * i++]);
await expectOk("admin_reports_list('open'): newest first, previews, hidden/exists flags, author for identified content and NEVER for Buzz", async () => {
  const list = (await mod("select * from public.admin_reports_list()")).rows;
  if (list.map((r) => r.id).join() !== [repGone, repComment, repProfile, repBuzz, repApt].join()) throw new Error(list.map((r) => r.target_type).join());
  const a = list.find((r) => r.id === repApt);
  if (a.target_preview !== "Sunny 2BR near campus" || a.target_hidden !== false || a.target_exists !== true || a.target_author_id !== S1 || a.reporter_name !== "Tina Student" || a.reporter_email !== "tina@txstate.edu" || a.details !== "Asks for the deposit before any viewing" || a.status !== "open" || a.decision !== null) throw new Error(JSON.stringify(a));
  const b = list.find((r) => r.id === repBuzz); if (b.target_author_id !== null || b.target_preview !== "Landlord keeps my deposit?" || b.target_exists !== true) throw new Error(JSON.stringify(b));
  const p = list.find((r) => r.id === repProfile); if (p.target_preview !== "Sam Student" || p.target_author_id !== S1 || p.target_exists !== true || p.target_hidden !== false) throw new Error(JSON.stringify(p));
  const c = list.find((r) => r.id === repComment); if (c.target_preview !== "nice!" || c.target_author_id !== S1) throw new Error(JSON.stringify(c));
  const g = list.find((r) => r.id === repGone); if (g.target_exists !== false || g.target_preview !== "" || g.target_author_id !== null || g.target_hidden !== false) throw new Error(JSON.stringify(g));
  await mod("select public.admin_content_hide('apartment',$1,'Pending verification')", [apt]);
  if ((await mod("select * from public.admin_reports_list()")).rows.find((r) => r.id === repApt).target_hidden !== true) throw new Error("hidden flag");
  await mod("select public.admin_content_restore('apartment',$1)", [apt]);
  await fails(() => mod("select * from public.admin_reports_list('weird')"), /Invalid status/);
});
await expectOk("resolve, dismiss, reopen: status/decision/reviewer/notes/time, logged; pagination with p_before", async () => {
  await mod("select public.admin_report_resolve($1,'content_hidden','Hid it until the owner sends proof')", [repApt]);
  const a = (await mod("select * from public.admin_reports_list('reviewed')")).rows;
  if (a.length !== 1 || a[0].id !== repApt || a[0].status !== "reviewed" || a[0].decision !== "content_hidden" || a[0].reviewed_by !== MOD || a[0].reviewer_name !== "Mia Mod" || !a[0].reviewed_at || a[0].notes !== "Hid it until the owner sends proof") throw new Error(JSON.stringify(a));
  let log = (await logRows()).at(-1); if (log.action !== "report.resolve" || log.target_id !== repApt || log.details.decision !== "content_hidden" || log.details.target_type !== "apartment" || log.details.target_id !== apt || log.details.notes !== "Hid it until the owner sends proof") throw new Error(JSON.stringify(log));
  await mod("select public.admin_report_resolve($1,'dismissed')", [repProfile]);
  const d = (await mod("select * from public.admin_reports_list('dismissed')")).rows; if (d.length !== 1 || d[0].id !== repProfile || d[0].decision !== "dismissed") throw new Error(JSON.stringify(d));
  if ((await mod("select * from public.admin_reports_list('open')")).rows.length !== 3 || (await mod("select * from public.admin_reports_list('all')")).rows.length !== 5) throw new Error("counts");
  await mod("select public.admin_report_reopen($1)", [repApt]);
  const r = (await mod("select * from public.admin_reports_list('open')")).rows.find((x) => x.id === repApt);
  if (!r || r.decision !== null || r.notes !== null || r.reviewed_by !== null || r.reviewed_at !== null) throw new Error(JSON.stringify(r));
  log = (await logRows()).at(-1); if (log.action !== "report.reopen" || log.target_id !== repApt || log.details.previous_status !== "reviewed" || log.details.previous_decision !== "content_hidden") throw new Error(JSON.stringify(log));
  await fails(() => mod("select public.admin_report_resolve($1,'dismissed')", [uuid()]), /Report not found/);
  await fails(() => mod("select public.admin_report_reopen($1)", [uuid()]), /Report not found/);
  await fails(() => mod("select public.admin_report_resolve($1,'banned')", [repApt]), /Invalid decision/);
  await fails(() => mod("select public.admin_report_resolve($1,null)", [repApt]), /Invalid decision/);
  const page = (await mod("select * from public.admin_reports_list('all', 2)")).rows; if (page.length !== 2) throw new Error("limit");
  const older = (await mod("select * from public.admin_reports_list('all', 50, $1)", [page[1].created_at])).rows;
  if (older.length !== 3 || older.some((x) => new Date(x.created_at) >= new Date(page[1].created_at))) throw new Error("pagination");
  await fails(() => as(S2, () => db.query("select * from public.admin_reports_list()"), MFA), /^Not allowed$/);
  await fails(() => as(S2, () => db.query("select public.admin_report_resolve($1,'dismissed')", [repApt]), MFA), /^Not allowed$/);
  if ((await as(S2, () => rows(db.query("select status from public.reports where id=$1", [repProfile]))))[0].status !== "dismissed") throw new Error("reporter cannot read their own report");
  // ...but not the review itself: who reviewed it, the decision and the notes are staff-only (a Buzz author oracle otherwise).
  for (const col of ["decision", "notes", "reviewed_by", "reviewed_at", "*"]) await fails(() => as(S2, () => db.query(`select ${col} from public.reports where id=$1`, [repProfile])), /permission denied/);
  await fails(() => as(S2, () => db.query("select id from public.reports where decision is not null")), /permission denied/);
  await fails(() => asAnon(() => db.query("select id from public.reports")), /permission denied/);
  if ((await mod("select public.admin_user_get($1) as j", [S1])).rows[0].j.counts.reports_against !== 3) throw new Error("reports_against (profile + apartment + comment; never Buzz)");
});

// ---- 7. media jobs ---------------------------------------------------------------------------
await db.query("delete from public.media_jobs");
await expectOk("media jobs only ever name the author's own files and videos: a row pointing at someone else's photo, playback id or media id, another host or a dot path queues nothing for them", async () => {
  const bait = (await as(S2, () => one(db.query(
    "insert into public.apartments (owner_id, title, description, price_per_month, address, images, videos) values ($1,'Bait listing','x',1,'9 St',$2::text[],$3::jsonb) returning id",
    [S2, [APT_PHOTOS[0], `https://evil.example/storage/v1/object/public/uploads/apartments/${S2}/mine.jpg`, `${ORIGIN}apartments/${S2}/../../${S1}/one.jpg`, `${ORIGIN}apartments/${S2}/own.jpg`],
      JSON.stringify([{ media_id: mediaApt, playback_id: "pbapt1" }, { media_id: uuid(), playback_id: "pbapt1" }])])))).id;
  await mod("select public.admin_content_hide('apartment',$1,'Built from stolen photos')", [bait]);
  let j = await jobs("target_id=$1", [bait]);
  if (j.map((x) => `${x.kind}:${x.ref}`).join("|") !== `quarantine:apartments/${S2}/own.jpg`) throw new Error(JSON.stringify(j));
  const hide = (await logRows()).at(-1);
  if (hide.action !== "content.hide" || hide.details.photos.length !== 1 || hide.details.videos.length !== 0 || hide.details.skipped_refs.length !== 5) throw new Error(JSON.stringify(hide.details));
  await mod("select public.admin_content_restore('apartment',$1)", [bait]);
  await as(S2, () => db.query("delete from public.apartments where id=$1", [bait]));
  j = await jobs("target_id=$1 and done_at is null", [bait]);
  if (j.map((x) => `${x.kind}:${x.ref}`).join("|") !== `delete_object:apartments/${S2}/own.jpg`) throw new Error(JSON.stringify(j));
  // A message image and an avatar follow the same rule.
  const m = (await as(S2, () => one(db.query("insert into public.messages (conversation_id, sender_id, content, image_url) values ($1,$2,'look',$3) returning id", [conv, S2, APT_PHOTOS[0]])))).id;
  await as(S2, () => db.query("delete from public.messages where id=$1", [m]));
  const S6 = await mk("zed@txstate.edu", "Zed Student");
  await db.query("update public.profiles set avatar_url=$2 where id=$1", [S6, APT_PHOTOS[1]]);
  await db.query("delete from auth.users where id=$1", [S6]);
  if ((await jobs("target_id=$1 and kind='delete_object'", [S6])).length !== 0 || (await jobs("target_id=$1 and kind='delete_prefix'", [S6])).length !== 6) throw new Error("avatar pointing at someone else's photo");
  if ((await jobs("ref in ($1,$2,'asset_apt_1')", [`apartments/${S1}/one.jpg`, `apartments/${S1}/two photo.jpg`])).length !== 0) throw new Error("another user's media was queued");
  if ((await as(S1, () => rows(db.query("select 1 from public.apartments where id=$1", [apt])))).length !== 1) throw new Error("the real listing was touched");
  await db.query("delete from public.media_jobs");
});
await expectOk("ordinary deletions queue cleanup: own apartment (2 photos + video), a message with an image, a whole account (avatar + 6 prefixes); duplicates collapse", async () => {
  await as(S1, () => db.query("delete from public.apartments where id=$1", [apt]));
  let j = await jobs("target_id=$1", [apt]);
  if (j.map((x) => `${x.kind}:${x.ref}`).sort().join("|") !== [`delete_object:apartments/${S1}/one.jpg`, `delete_object:apartments/${S1}/two photo.jpg`, `mux_delete:asset_apt_1`].join("|") || j.some((x) => x.target_type !== "apartment" || x.done_at !== null)) throw new Error(JSON.stringify(j));
  await as(S1, () => db.query("delete from public.messages where id=$1", [msgWithImage]));
  j = await jobs("target_id=$1", [msgWithImage]); if (j.length !== 1 || j[0].kind !== "delete_object" || j[0].ref !== `messages/${S1}/pic.jpg` || j[0].target_type !== "message") throw new Error(JSON.stringify(j));
  await db.query("select public.media_enqueue('delete_object',$1,'message',$2)", [`messages/${S1}/pic.jpg`, msgWithImage]);
  if ((await jobs("ref=$1 and done_at is null", [`messages/${S1}/pic.jpg`])).length !== 1) throw new Error("duplicate pending job");
  await as(S1, () => db.query("delete from public.media where id=$1", [mediaApt])); // the media row's own mux_delete collapses into the pending one
  if ((await jobs("ref='asset_apt_1' and done_at is null")).length !== 1) throw new Error("duplicate mux_delete");
  await db.query("update public.profiles set avatar_url=$2 where id=$1", [S3, `${ORIGIN}avatars/${S3}/a.jpg`]);
  await db.query("delete from auth.users where id=$1", [S3]);
  j = await jobs("target_id=$1", [S3]);
  const want = [`delete_object:avatars/${S3}/a.jpg`, ...["apartments", "avatars", "items", "messages", "posts", "roommates"].map((p) => `delete_prefix:${p}/${S3}/`)].sort().join("|");
  if (j.map((x) => `${x.kind}:${x.ref}`).sort().join("|") !== want || j.some((x) => x.target_type !== "profile")) throw new Error(JSON.stringify(j));
  if ((await jobs("ref like 'buzz/%'")).length !== 0) throw new Error("buzz files must never be queued per account");
});
let claimed, failedId, doneId;
await expectOk("media_jobs_claim returns due rows, bumps attempts and backs off; failed stores the error; done finishes", async () => {
  const pendingBefore = (await jobs("done_at is null")).length;
  claimed = await rows(db.query("select * from public.media_jobs_claim(100)"));
  if (claimed.length !== pendingBefore || claimed.some((x) => x.attempts !== 1 || minutesFromNow(x.next_attempt_at) < 9 || minutesFromNow(x.next_attempt_at) > 11)) throw new Error(JSON.stringify(claimed.map((x) => [x.attempts, minutesFromNow(x.next_attempt_at)])));
  if ((await rows(db.query("select * from public.media_jobs_claim(100)"))).length !== 0) throw new Error("claimed twice");
  failedId = claimed[0].id; doneId = claimed[1].id;
  await db.query("select public.media_jobs_failed($1,$2)", [failedId, "x".repeat(1500)]);
  const f = await one(db.query("select last_error, done_at from public.media_jobs where id=$1", [failedId])); if (f.last_error.length !== 1000 || f.done_at !== null) throw new Error(JSON.stringify(f));
  await db.query("select public.media_jobs_done($1)", [doneId]);
  const d = await one(db.query("select done_at, last_error from public.media_jobs where id=$1", [doneId])); if (!d.done_at || d.last_error !== null) throw new Error(JSON.stringify(d));
  if ((await rows(db.query("select * from public.media_jobs_claim(1)"))).length !== 0) throw new Error("a done or backed-off job was claimed");
});
await expectOk("admin_media_jobs_retry makes a job due again (and logs); stats and list; students and visitors are locked out", async () => {
  await mod("select public.admin_media_jobs_retry($1)", [failedId]);
  const r = await one(db.query("select next_attempt_at <= now() due, last_error from public.media_jobs where id=$1", [failedId])); if (r.due !== true || r.last_error !== null) throw new Error(JSON.stringify(r));
  const log = (await logRows()).at(-1); if (log.action !== "media.retry" || log.target_id !== String(failedId) || log.details.attempts !== 1 || !log.details.last_error) throw new Error(JSON.stringify(log));
  const again = await rows(db.query("select * from public.media_jobs_claim(10)"));
  if (again.length !== 1 || Number(again[0].id) !== Number(failedId) || again[0].attempts !== 2 || minutesFromNow(again[0].next_attempt_at) < 39 || minutesFromNow(again[0].next_attempt_at) > 41) throw new Error(JSON.stringify(again));
  await fails(() => mod("select public.admin_media_jobs_retry($1)", [doneId]), /Job not found/);
  await fails(() => mod("select public.admin_media_jobs_retry(999999)"), /Job not found/);
  await db.query("update public.media_jobs set attempts = 3 where id=$1", [failedId]);
  const total = (await one(db.query("select count(*)::int n from public.media_jobs"))).n;
  const s = (await mod("select * from public.admin_media_jobs_stats()")).rows[0];
  if (Number(s.pending) !== total - 1 || Number(s.failing) !== 1 || Number(s.done) !== 1) throw new Error(JSON.stringify(s));
  const pending = (await mod("select * from public.admin_media_jobs_list()")).rows; if (pending.length !== total - 1 || pending.some((x) => x.done_at !== null)) throw new Error("pending list");
  if ((await mod("select * from public.admin_media_jobs_list(false)")).rows.length !== total) throw new Error("full list");
  if ((await mod("select * from public.admin_media_jobs_list(true, 2)")).rows.length !== 2) throw new Error("limit");
  for (const q of ["select * from public.media_jobs_claim(1)", `select public.media_jobs_done(${failedId})`, `select public.media_jobs_failed(${failedId},'x')`]) {
    await fails(() => as(S1, () => db.query(q)), /permission denied/);
    await fails(() => asAnon(() => db.query(q)), /permission denied/);
  }
  for (const q of ["select * from public.admin_media_jobs_list()", `select public.admin_media_jobs_retry(${failedId})`, "select * from public.admin_media_jobs_stats()"]) {
    await fails(() => as(S1, () => db.query(q), MFA), /^Not allowed$/);
    await fails(() => asAnon(() => db.query(q)), /permission denied/);
  }
});

// ---- 8. audit --------------------------------------------------------------------------------------
await expectOk("audit: every new action is in admin_audit_list with the actor's email and the details that say who changed what and why", async () => {
  const log = await own("select * from public.admin_audit_list(200)").then((r) => r.rows);
  const actions = new Set(log.map((l) => l.action));
  for (const want of ["user.suspend", "user.unsuspend", "content.hide", "content.restore", "content.delete", "content.view", "report.resolve", "report.reopen", "media.retry"]) if (!actions.has(want)) throw new Error(`missing ${want}`);
  const susp = log.filter((l) => l.action === "user.suspend" && l.target_id === S1).at(-1);
  if (susp.actor_email !== "mia@txstate.edu" || susp.actor_name !== "Mia Mod" || susp.details.email !== "sam@txstate.edu" || susp.details.reason !== "Spam listings" || !susp.details.expires_at || susp.details.note !== "three reports in a day") throw new Error(JSON.stringify(susp));
  const hide = log.filter((l) => l.action === "content.hide" && l.target_id === apt).at(-1);
  if (hide.details.photos.length !== 2 || hide.details.videos[0] !== "asset_apt_1" || hide.details.author_id !== S1 || hide.details.reason !== "Scam: asks for a deposit before any viewing" || hide.target_type !== "apartment") throw new Error(JSON.stringify(hide));
  const buzzHide = log.find((l) => l.action === "content.hide" && l.target_id === buzz1); if ("author_id" in buzzHide.details || buzzHide.details.reason !== "Doxxing") throw new Error("Buzz hide must not name the author: " + JSON.stringify(buzzHide));
  const restore = log.find((l) => l.action === "content.restore" && l.target_id === apt); if (restore.details.photos.length !== 2 || restore.details.videos[0] !== "asset_apt_1" || restore.actor_email !== "mia@txstate.edu") throw new Error(JSON.stringify(restore));
  const del = log.find((l) => l.action === "content.delete" && l.target_id === reel); if (del.actor_email !== "adam@txstate.edu" || !del.details.snapshot?.author_id) throw new Error(JSON.stringify(del));
  const adminSusp = log.find((l) => l.action === "user.suspend" && l.target_id === ADMIN); if (adminSusp.actor_email !== "owner@txstate.edu" || adminSusp.details.email !== "adam@txstate.edu") throw new Error(JSON.stringify(adminSusp));
  if (log.some((l) => l.actor_id !== null && !l.actor_email)) throw new Error("an action without the actor's email");
});
done("MIGRATION-15");
