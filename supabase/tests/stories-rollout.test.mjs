// Stories applied to production on their own, ahead of the Business v2 release: migration 58 (the stories, as production
// took it on 2026-10-30), 59 (their photos and videos, the same day) and 60 (every upload folder its owner's to list,
// a post's photos from and with the post), rehearsed offline. A database in production's state
// before them (production's migration order, the migrations applied outside this repo, 47 applied although 44 and 46
// were not, none of 49 to 57); 58 alone, as the next migration; stories shared and read through the API roles under
// every audience; then 59 alone, and the same again; then 60. Then the rest of the release (44, 46, 49 to 57) applied
// after them, in file order, as `npm run db:setup` will, with stories still working and the folders still closed. Then
// 60's, 59's and 58's own rollbacks, which must leave exactly the schema of a database that never had them; then all
// three again. The staging counterpart, through the
// real Supabase stack, is supabase/tests/staging/stories.mjs.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";

const STORIES = "20261110000100_stories.sql";
const MEDIA = "20261112000100_story_media.sql";
const FOLDERS = "20261112000200_upload_folders.sql";
const STORIES_SET = [STORIES, MEDIA, FOLDERS];
// 61 (Events) follows the same path later, on its own (events-rollout.test.mjs); it is not part of this rehearsal.
const AHEAD = ["20261113000000_events.sql"];
const ROLLBACKS = ["rollbacks/20261112000200_upload_folders.down.sql", "rollbacks/20261112000100_story_media.down.sql", "rollbacks/20261110000100_stories.down.sql"];
// The release 58, 59 and 60 go ahead of, in file order.
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

const { db, mk, as, asAnon } = await boot({ live: true, skip: [...REST, ...STORIES_SET, ...AHEAD] });
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

// A story as the app shares one: the photo uploaded to the author's stories folder first (Storage records the uploader),
// then the row with its public address, which 59 checks and 58 takes as it is.
let uploads = 0;
const share = async (uid, audience) => {
  const name = `stories/${uid}/${++uploads}-photo.jpg`;
  await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [name, uid, uid]);
  return as(uid, () => one(db.query("insert into public.stories (author_id, kind, image_url, image_meta, audience) values ($1, 'photo', $2, '{\"width\":1080,\"height\":1920}', $3) returning *", [uid, `https://proj.supabase.co/storage/v1/object/public/uploads/${name}`, audience])));
};
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

await expectOk("59 applies on its own after 58, and re-runs cleanly", async () => { await db.exec(read(`migrations/${MEDIA}`)); await db.exec(read(`migrations/${MEDIA}`)); });
await expectError("with 59, a photo from anywhere but the author's stories folder is refused", () => as(ANN, () => db.query("insert into public.stories (author_id, kind, image_url) values ($1, 'photo', 'https://x.example/p.jpg')", [ANN])), "Upload the photo to your story first");
await storiesWork("58 and 59");

await expectOk("60 applies on its own after 59, and re-runs cleanly", async () => { await db.exec(read(`migrations/${FOLDERS}`)); await db.exec(read(`migrations/${FOLDERS}`)); });
const folderClosed = async () => (await asAnon(() => rows(db.query("select name from storage.objects where bucket_id = 'uploads' and name like $1", [`stories/${ANN}/%`])))).length === 0;
await expectOk("with 60, signed out, no upload folder lists; a post's photo must come from the author's posts folder", async () => {
  check(await folderClosed(), "a folder listed signed out");
  let refused = false;
  try { await as(ANN, () => db.query("insert into public.feed_posts (author_id, kind, body, images) values ($1, 'post', 'x', $2)", [ANN, ["https://x.example/p.jpg"]])); } catch (e) { refused = e.message.includes("Upload the photo to your post first"); }
  check(refused, "a post took a photo from elsewhere");
});
await storiesWork("58, 59 and 60");

// --- The rest of the release lands after 58, 59 and 60 ----------------------------------------------------------------------
for (const f of REST) await expectOk(`after 58, 59 and 60: ${f} applies`, () => db.exec(read(`migrations/${f}`)));
await expectOk("after the release: Discover ranks (44 + 46), ads exist (50), hours are checked (57), 58's and 59's objects are untouched, and the folders are still closed (60)", async () => {
  check(await folderClosed(), "the release reopened an upload folder");
  await db.query("select public.discover_refresh()");
  check(await has("select to_regclass('public.ads') is not null and to_regprocedure('public.stories_sweep(timestamptz)') is not null and to_regprocedure('public.story_photo_ok(text, uuid)') is not null as ok"), "50, 58 or 59 missing");
  check(await has("select exists (select 1 from pg_constraint where conname = 'businesses_hours_check') as ok"), "57 missing");
  check(await has("select exists (select 1 from pg_policies where tablename = 'stories' and policyname = 'stories_select') and exists (select 1 from pg_trigger where tgname = 'stories_after_delete') as ok"), "58's policy or 59's trigger missing");
});
await storiesWork("after the release");

// --- 60's, 59's and 58's rollbacks on their own, with the release in place ----------------------------------------------------
await expectOk("60's, 59's and 58's rollbacks leave exactly the schema of a database that never had them (the release still applied)", async () => {
  for (const r of ROLLBACKS) await db.exec(read(r));
  const reference = await boot({ live: true, skip: [...STORIES_SET, ...AHEAD] });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
});
await expectOk("58, 59 and 60 apply again afterwards", async () => { for (const f of STORIES_SET) await db.exec(read(`migrations/${f}`)); });
await storiesWork("58, 59 and 60 re-applied");

done("STORIES AHEAD OF THE RELEASE (58, 59 AND 60 AFTER 48, THEN 44, 46, 49 TO 57)");
