// Migration 58 (Stories) applied to production on its own, ahead of the Business v2 release, as production took it on
// 2026-10-30, rehearsed offline: a database in production's state before it (production's migration order, the
// migrations applied outside this repo, 47 applied although 44 and 46 were not, none of 49 to 57), then 58 alone, as the
// next migration; stories shared and read through the API roles under every audience. Then the rest of the release (44, 46, 49 to 57) applied after it,
// in file order, as `npm run db:setup` will, with stories still working. Then 58's own rollback, which must leave exactly
// the schema of a database that never had it; then 58 again. The staging counterpart, through the real Supabase stack,
// is supabase/tests/staging/stories.mjs.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";

const STORIES = "20261110000100_stories.sql";
const ROLLBACK = "rollbacks/20261110000100_stories.down.sql";
// The release 58 goes ahead of, in file order.
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

const { db, mk, as, asAnon } = await boot({ live: true, skip: [...REST, STORIES] });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const has = async (sql) => Boolean((await one(db.query(sql))).ok);

await expectOk("before: production's state (47 applied, 44 and 46 not, no business v2, no stories); what 58 builds on is there (45's verified_university, 9's blocks)", async () => {
  check(await has("select exists (select 1 from information_schema.columns where table_name = 'roommate_posts' and column_name = 'is_anonymous') as ok"), "47 is not applied");
  check(!(await has("select to_regclass('public.discover_hot_posts') is not null or to_regclass('public.ads') is not null or to_regclass('public.stories') is not null as ok")), "44, 50 or 58 already there");
  check(await has("select to_regprocedure('public.verified_university(uuid)') is not null and to_regprocedure('public.is_blocked_either_way(uuid)') is not null as ok"), "45 or 9 missing");
});
await expectOk("58 applies on its own, as production's next migration, and re-runs cleanly", async () => { await db.exec(read(`migrations/${STORIES}`)); await db.exec(read(`migrations/${STORIES}`)); });

// --- Students, as the app makes them: confirmed accounts whose email names the campus -----------------------------------
const UT = (await one(db.query("select id from public.universities where name = 'University of Texas at Austin'"))).id;
await db.query("update public.universities set email_domain = 'utexas.edu' where id = $1", [UT]);
const ANN = await mk("ann@txstate.edu", "Ann Author");
const CARA = await mk("cara@txstate.edu", "Cara Campus"); // Ann's campus, no follows
const OLI = await mk("oli@utexas.edu", "Oli Other"); // another campus
const FAY = await mk("fay@utexas.edu", "Fay Friend"); // follows Ann and is followed back
const PIA = await mk("pia@txstate.edu", "Pia Picked"); // picked for the selected story
const BO = await mk("bo@txstate.edu", "Bo Blocked"); // Ann's campus, has blocked Ann
const follow = (a, b) => as(a, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [a, b]));
await follow(FAY, ANN); await follow(ANN, FAY);
await as(BO, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [BO, ANN]));

const share = (uid, audience, extra = {}) => as(uid, () => one(db.query("insert into public.stories (author_id, kind, image_url, image_meta, audience) values ($1, 'photo', $2, '{\"width\":1080,\"height\":1920}', $3) returning *", [uid, `https://x.example/${audience}.jpg`, audience])));
const sees = async (who, id) => (await as(who, () => rows(db.query("select id from public.stories where id = $1", [id])))).length === 1;
const seen = (who, id) => as(who, () => one(db.query("select public.mark_story_seen($1) as added", [id]))).then((r) => r.added);
const everyone = { ANN, CARA, OLI, FAY, PIA, BO };
/** Who, of everyone, sees the story: the names, for a one-line comparison. One at a time: as() shares the connection. */
const audienceOf = async (id) => {
  const names = [];
  for (const [name, uid] of Object.entries(everyone)) if (await sees(uid, id)) names.push(name);
  return names.join(" ");
};

async function storiesWork(round) {
  await expectOk(`${round}: the server stamps the author and the 24 hours; each audience reaches exactly its people, never across the block`, async () => {
    const campus = await share(ANN, "campus");
    check(campus.author_id === ANN && Math.abs((Date.parse(campus.expires_at) - Date.parse(campus.created_at)) / 3600_000 - 24) < 0.01, JSON.stringify(campus));
    check((await audienceOf(campus.id)) === "ANN CARA PIA", `campus: ${await audienceOf(campus.id)}`);
    const global = await share(ANN, "global");
    check((await audienceOf(global.id)) === "ANN CARA OLI FAY PIA", `global: ${await audienceOf(global.id)}`);
    const friends = await share(ANN, "friends");
    check((await audienceOf(friends.id)) === "ANN FAY", `friends: ${await audienceOf(friends.id)}`);
    const selected = await share(ANN, "selected");
    await as(ANN, () => db.query("select public.set_story_viewers($1, $2::uuid[])", [selected.id, [PIA]]));
    check((await audienceOf(selected.id)) === "ANN PIA", `selected: ${await audienceOf(selected.id)}`);
    // Views: once per viewer, counted for the author alone, never for the author's own look.
    check((await seen(CARA, global.id)) === true && (await seen(CARA, global.id)) === false && (await seen(ANN, global.id)) === false, "views recorded wrongly");
    check((await seen(BO, global.id)) === false, "a blocked reader recorded a view");
    const views = await as(ANN, () => rows(db.query("select viewer_id from public.story_views where story_id = $1", [global.id])));
    check(views.length === 1 && views[0].viewer_id === CARA, JSON.stringify(views));
    check((await as(OLI, () => rows(db.query("select viewer_id from public.story_views where story_id = $1", [global.id])))).length === 0, "a reader saw another's view");
    // Only the author takes one down.
    check((await as(CARA, () => rows(db.query("delete from public.stories where id = $1 returning id", [campus.id])))).length === 0, "someone else deleted it");
    check((await as(ANN, () => rows(db.query("delete from public.stories where id = $1 returning id", [campus.id])))).length === 1, "the author could not delete it");
  });
  await expectError(`${round}: signed out, stories are closed`, () => asAnon(() => db.query("select id from public.stories limit 1")), "permission denied");
}

await storiesWork("58 alone");

// --- The rest of the release lands after 58 ---------------------------------------------------------------------------------
for (const f of REST) await expectOk(`after 58: ${f} applies`, () => db.exec(read(`migrations/${f}`)));
await expectOk("after the release: Discover ranks (44 + 46), ads exist (50), hours are checked (57), and 58's objects are untouched", async () => {
  await db.query("select public.discover_refresh()");
  check(await has("select to_regclass('public.ads') is not null and to_regprocedure('public.stories_sweep(timestamptz)') is not null as ok"), "50 or 58 missing");
  check(await has("select exists (select 1 from pg_constraint where conname = 'businesses_hours_check') as ok"), "57 missing");
  check(await has("select exists (select 1 from pg_policies where tablename = 'stories' and policyname = 'stories_select') as ok"), "58's policy missing");
});
await storiesWork("after the release");

// --- 58's rollback on its own, with the release in place --------------------------------------------------------------------
await expectOk("58's rollback alone leaves exactly the schema of a database that never had 58 (the release still applied)", async () => {
  await db.exec(read(ROLLBACK));
  const reference = await boot({ live: true, skip: [STORIES] });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
});
await expectOk("58 applies again afterwards", () => db.exec(read(`migrations/${STORIES}`)));
await storiesWork("58 re-applied");

done("STORIES AHEAD OF THE RELEASE (58 AFTER 48, THEN 44, 46, 49 TO 57)");
