// Migration 62 (story likes, mutes, reports and cards) applied to production on its own, ahead of 61 and the Business
// v2 release, rehearsed offline the way 58 to 61 were: a database in production's state (production's migration order,
// the migrations applied outside this repo, 47 and 58 to 60 applied although 44, 46 and 49 to 57 are not, 61 not yet);
// 62 alone, as the next migration; a like, a mute, a story card and a story report through the API roles; then 61 and
// the rest of the release (44, 46, 49 to 57) applied after it, in file order, as `npm run db:setup` will, with the same
// still working (none of them redefines what 62 replaces); then 62's own rollback, which must leave exactly the schema
// of a database that never had it; then 62 again.
import { boot, read, expectOk, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";

const ACTIONS = "20261114000000_story_actions.sql";
const ROLLBACK = "rollbacks/20261114000000_story_actions.down.sql";
const EVENTS = "20261113000000_events.sql";
// What 62 goes ahead of, in file order: the release, then 61.
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
  EVENTS,
];
const check = (cond, message) => { if (!cond) throw new Error(message); };

const { db, mk, as } = await boot({ live: true, skip: [...REST, ACTIONS] });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const val = async (q, params = []) => { const r = await one(db.query(q, params)); return r[Object.keys(r)[0]]; };
const has = async (sql) => Boolean((await one(db.query(sql))).ok);

await expectOk("before: production's state (58 to 60 applied; 44, 46, 49 to 57 and 61 not); what 62 builds on is there", async () => {
  check(await has("select to_regprocedure('public.can_see_story_as(uuid, uuid, uuid, text, uuid)') is not null and to_regprocedure('public.ts_snapshot(text, uuid)') is not null and to_regprocedure('public.message_reply_snapshot(uuid, uuid)') is not null and to_regprocedure('public.story_photo_ok(text, uuid)') is not null as ok"), "a dependency is missing");
  check(await has("select to_regclass('public.events') is null and to_regclass('public.ads') is null and to_regclass('public.story_likes') is null as ok"), "not production's state");
});
await expectOk("62 applies alone, as the next migration, and re-runs cleanly", async () => { await db.exec(read(`migrations/${ACTIONS}`)); await db.exec(read(`migrations/${ACTIONS}`)); });

const ANN = await mk("ann@txstate.edu", "Ann Author");
const CARA = await mk("cara@txstate.edu", "Cara Campus");
await db.query("update public.profiles set created_at = now() - interval '3 days'");
let n = 0;
const story = async () => {
  const name = `stories/${ANN}/17300000000${String(++n).padStart(2, "0")}-abc.jpg`;
  await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [name, ANN, ANN]);
  return as(ANN, () => one(db.query("insert into public.stories (author_id, kind, image_url, audience) values ($1, 'photo', $2, 'campus') returning *", [ANN, `https://proj.supabase.co/storage/v1/object/public/uploads/${name}`])));
};

/** The four actions through the API roles: the checks that must hold with 62 alone and again with the release after it. */
async function actionsWork(label) {
  await expectOk(`${label}: a like, a mute, a reply card rewritten from the story, a queued story report`, async () => {
    const s = await story();
    await as(CARA, () => db.query("insert into public.story_likes (story_id, user_id) values ($1, $2)", [s.id, CARA]));
    check((await as(ANN, () => rows(db.query("select user_id from public.story_likes where story_id = $1", [s.id])))).length === 1, "the author does not read the like");
    await as(CARA, () => db.query("insert into public.story_mutes (user_id, author_id) values ($1, $2) on conflict do nothing", [CARA, ANN]));
    const conv = await as(CARA, () => val("select public.get_or_create_direct_conversation($1) as id", [ANN]));
    const m = await as(CARA, () => one(db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1, $2, 'Nice', $3::jsonb) returning shared_post", [conv, CARA, JSON.stringify({ target_type: "story", target_id: s.id, kind: "story_reply", path: `/stories/${s.id}` })])));
    check(m.shared_post.image_url === s.image_url && m.shared_post.author.name === "Ann Author", JSON.stringify(m.shared_post));
    await as(CARA, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'story', $2, 'harassment')", [CARA, s.id]));
    check((await val("select count(*)::int from public.mod_queue where entity_type = 'story' and entity_id = $1", [s.id])) === 1, "not queued");
  });
}
await actionsWork("62 alone");

await expectOk("61 and the release (44, 46, 49 to 57) apply after 62, in file order, as db:setup will", async () => { for (const f of REST) await db.exec(read(`migrations/${f}`)); });
await expectOk("after them: what 62 replaced is still 62's (no later migration redefined it)", async () => {
  check(await has("select to_regclass('public.events') is not null and to_regclass('public.ads') is not null as ok"), "the release is missing");
  check(await has("select pg_get_functiondef('public.ts_snapshot(text, uuid)'::regprocedure) like '%ts_story_snapshot%' and pg_get_functiondef('public.message_reply_snapshot(uuid, uuid)'::regprocedure) like '%''story''%' as ok"), "a later migration replaced 62's functions");
});
await actionsWork("after the release");

await expectOk("62's rollback (story cards and reports deleted first) leaves exactly the schema of a database that never had it", async () => {
  await db.query("delete from public.messages where shared_post ->> 'target_type' = 'story'");
  await db.query("delete from public.reports where target_type = 'story'");
  await db.exec(read(ROLLBACK));
  const reference = await boot({ live: true, skip: [ACTIONS] });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
});
await expectOk("62 applies again afterwards", async () => { await db.exec(read(`migrations/${ACTIONS}`)); });
await actionsWork("62 re-applied");

done("STORY ACTIONS AHEAD OF THE RELEASE (62 AFTER 60, THEN 61, 44, 46, 49 TO 57)");
