// Migration 61 (Events) applied to production on its own, ahead of the Business v2 release, rehearsed offline the way
// 58, 59 and 60 were: a database in production's state (production's migration order, the migrations applied outside
// this repo, 47 and 58 to 60 applied although 44, 46 and 49 to 57 are not); 61 alone, as the next migration; events
// published, read, saved and moderated through the API roles; then the rest of the release (44, 46, 49 to 57) applied
// after it, in file order, as `npm run db:setup` will, with events still working; then 61's own rollback, which must
// leave exactly the schema of a database that never had it; then 61 again.
import { boot, read, expectOk, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";

const EVENTS = "20261113000000_events.sql";
const ROLLBACK = "rollbacks/20261113000000_events.down.sql";
// The release 61 goes ahead of, in file order.
const REST = [
  "20261103000300_discover.sql",
  "20261104000100_discover_audience.sql",
  "20261107000000_business_teams.sql",
  "20261107000100_business_ads.sql",
  "20261108000000_buzz_reply_tree.sql",
  "20261108000100_buzz_top_reply.sql",
  "20261108000200_buzz_prompt_threads.sql",
  "20261108000300_buzz_categories.sql",
  "20261109000000_media_server_fields.sql",
  "20261109000100_business_hardening.sql",
  "20261110000000_business_hours.sql",
];
const check = (cond, message) => { if (!cond) throw new Error(message); };

const { db, mk, as, asAnon, asService } = await boot({ live: true, skip: [...REST, EVENTS] });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const val = async (q, params = []) => { const r = await one(db.query(q, params)); return r[Object.keys(r)[0]]; };
const has = async (sql) => Boolean((await one(db.query(sql))).ok);

await expectOk("before: production's state (47 and 58 to 60 applied, 44 and 46 not, no business v2, no events); what 61 builds on is there (41's ts_role_of, 39's student_side_ok, 60's own_upload_ok)", async () => {
  check(await has("select to_regprocedure('public.own_upload_ok(text, uuid, text)') is not null and to_regprocedure('public.ts_role_of(uuid)') is not null and to_regprocedure('public.student_side_ok()') is not null as ok"), "a dependency is missing");
  // 39's businesses are there; 50's ads and 57's hours are not.
  check(await has("select to_regclass('public.events') is null and to_regclass('public.businesses') is not null and to_regclass('public.ads') is null and not exists (select 1 from pg_constraint where conname = 'businesses_hours_check') as ok"), "not production's state");
});
await expectOk("61 applies alone, as the next migration, and re-runs cleanly", async () => { await db.exec(read(`migrations/${EVENTS}`)); await db.exec(read(`migrations/${EVENTS}`)); });

const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
const ANN = await mk("ann@txstate.edu", "Ann Owner");
const BOB = await mk("bob@txstate.edu", "Bob Student");
const MOD = await mk("mod@txstate.edu", "Mo Moderator");
// Production's staff list is CampConnect Admin's (public.staff), not staff_members: ts_role_of reads whichever exists.
await db.query("insert into public.staff (user_id, role) values ($1, 'moderator')", [MOD]);
const asStaff = (fn) => as(MOD, fn, { aal: "aal2" });
let org, ev, feed, fe;

/** Events through the API roles: the checks that must hold with 61 alone and again with the release after it. */
async function eventsWork(label) {
  await expectOk(`${label}: a student's organization is pending; staff verify it; its event is then everyone's to see and save; a feed's event is listed too`, async () => {
    org ??= await as(ANN, () => one(db.query("insert into public.organizations (name, kind) values ('Rollout Club', 'club') returning *")));
    check(org.university_id === TX && org.verified === false, JSON.stringify(org));
    ev ??= await as(ANN, () => one(db.query("insert into public.events (organization_id, title, starts_at, category, source) values ($1, 'Rollout night', now() + interval '3 days', 'social', 'organization') returning *", [org.id])));
    await asStaff(() => db.query("select public.events_console_set_organization($1, true)", [org.id]));
    check((await val("select status from public.events where id = $1", [ev.id])) === "scheduled", "not published");
    check((await asAnon(() => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 1, "anon");
    await as(BOB, () => db.query("insert into public.event_saves (event_id, user_id) values ($1, $2) on conflict do nothing", [ev.id, BOB]));
    check((await val("select save_count from public.events where id = $1", [ev.id])) === 1, "save count");
    feed ??= await asStaff(() => val("select public.events_console_feed_save($1)", [JSON.stringify({ university_id: TX, name: "Campus", url: "https://events.example/campus.ics", kind: "ics" })])).catch(async () => {
      // A moderator may not add feeds; an admin does. Promote for this one call.
      await db.query("update public.staff set role = 'admin' where user_id = $1", [MOD]);
      return asStaff(() => val("select public.events_console_feed_save($1)", [JSON.stringify({ university_id: TX, name: "Campus", url: "https://events.example/campus.ics", kind: "ics" })]));
    });
    fe ??= await asService(() => one(db.query("insert into public.events (university_id, feed_id, external_uid, title, starts_at, category, source) values ($1, $2, 'u1', 'Study Night', now() + interval '2 days', 'academic', 'feed') returning id", [TX, feed.id])));
    const listed = await as(BOB, () => rows(db.query("select id from public.events where university_id = $1 and status = 'scheduled' order by starts_at", [TX])));
    check(listed.length === 2, `listed ${listed.length}`);
    const counts = await asStaff(() => val("select public.events_console_counts()"));
    check(counts.events_upcoming === 2, JSON.stringify(counts));
    let closed = false;
    try { await as(BOB, () => db.query("select * from public.event_feeds")); } catch (e) { closed = /permission denied/.test(e.message); }
    check(closed, "a student read the feeds");
  });
}
await eventsWork("61 alone");

// --- The release after it -----------------------------------------------------------------------------------------------
await expectOk("the release (44, 46, 49 to 57) applies after 61, in file order, as db:setup will", async () => { for (const f of REST) await db.exec(read(`migrations/${f}`)); });
await expectOk("after the release: production's then-state (business v2, Buzz 51 to 54) and 61's objects together", async () => {
  check(await has("select to_regclass('public.ads') is not null and exists (select 1 from pg_constraint where conname = 'businesses_hours_check') and to_regclass('public.events') is not null as ok"), "something is missing");
});
await eventsWork("after the release");

// --- 61's rollback on its own, with the release in place ---------------------------------------------------------------
await expectOk("61's rollback leaves exactly the schema of a database that never had it (the release still applied)", async () => {
  await db.exec(read(ROLLBACK));
  const reference = await boot({ live: true, skip: [EVENTS] });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
});
await expectOk("61 applies again afterwards", async () => {
  await db.exec(read(`migrations/${EVENTS}`));
  org = ev = feed = fe = undefined;
});
await eventsWork("61 re-applied");

done("EVENTS AHEAD OF THE RELEASE (61 AFTER 60, THEN 44, 46, 49 TO 57)");
