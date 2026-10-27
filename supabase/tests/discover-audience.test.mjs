// 20261104000100_discover_audience.sql against PGlite, in production's order: Discover's public rankings (hot posts,
// trending topics, accounts to follow) are built from Global posts only, so a campus, friends-only or chosen-people
// post never trends and its #tags never show to anyone in Discover; the readers still show each post to exactly the
// people its audience allows (topic pages, as the caller). The migration re-runs, and its rollback restores Discover's
// own refresh (which ranks every post again).
import { boot, read, expectOk, done } from "./harness.mjs";

const MIGRATION = "migrations/20261104000100_discover_audience.sql";
const ROLLBACK = "rollbacks/20261104000100_discover_audience.down.sql";
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

const { db, mk, as, asAnon } = await boot({ live: true });
const one = async (p) => (await p).rows[0];
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
await db.query("insert into public.universities (name, email_domain) values ('The University of Texas at Austin', 'utexas.edu')");

const ANA = await mk("ana@txstate.edu", "Ana Alvarez");
const BO = await mk("bo@txstate.edu", "Bo Brooks");
const CY = await mk("cy@utexas.edu", "Cy Chen");
// Ana and Bo are friends (they follow each other).
await as(ANA, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [ANA, BO]));
await as(BO, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [BO, ANA]));

const post = (audience, body) => as(ANA, async () => (await one(db.query("insert into public.feed_posts (author_id, university_id, kind, body, audience) values ($1, $2, 'post', $3, $4) returning id", [ANA, TX, body, audience]))).id);
const P = {
  global: await post("global", "Open mic tonight #openmic"),
  campus: await post("campus", "Bobcats only #campusnight"),
  friends: await post("friends", "Dinner at mine #friendsdinner"),
  selected: await post("selected", "Shh #surpriseparty"),
};
await as(ANA, () => db.query("select public.set_post_viewers($1, $2)", [P.selected, [BO]]));
const refresh = () => db.query("select public.discover_refresh()");
const ranked = async () => (await db.query("select post_id from public.discover_post_ranks")).rows.map((r) => r.post_id);
const trending = async () => (await db.query("select tag from public.discover_topic_ranks order by rank")).rows.map((r) => r.tag);
const PRIVATE_TAGS = ["campusnight", "friendsdinner", "surpriseparty"];

await refresh();
await expectOk("only the Global post is ranked among Discover's hot posts", async () => {
  const ids = await ranked();
  check(ids.includes(P.global), "the Global post is missing");
  for (const k of ["campus", "friends", "selected"]) check(!ids.includes(P[k]), `the ${k} post is ranked`);
});
await expectOk("only the Global post's tag trends", async () => {
  const tags = await trending();
  check(tags.includes("openmic"), JSON.stringify(tags));
  for (const t of PRIVATE_TAGS) check(!tags.includes(t), `#${t} trends`);
});
await expectOk("nobody finds a non-public tag through Discover's topic search, signed in or out", async () => {
  for (const [who, run] of [
    ["signed out", (fn) => asAnon(fn)],
    ["a stranger", (fn) => as(CY, fn)],
    ["a friend", (fn) => as(BO, fn)],
    ["the author", (fn) => as(ANA, fn)],
  ]) {
    for (const t of PRIVATE_TAGS) {
      const rows = (await run(() => db.query("select tag from public.discover_search_topics($1, 10)", [t.slice(0, 5)]))).rows;
      check(!rows.some((r) => r.tag === t), `${who} finds #${t}`);
    }
  }
});
await expectOk("topic pages still show each post to exactly its audience (the readers run as the caller)", async () => {
  const topic = (uid, tag) => as(uid, async () => (await db.query("select post_id from public.discover_topic_posts($1, 'new', 24, 0)", [tag])).rows.map((r) => r.post_id));
  check((await topic(BO, "friendsdinner")).includes(P.friends), "a friend misses the friends-only post");
  check((await topic(BO, "surpriseparty")).includes(P.selected), "a chosen person misses the selected post");
  check((await topic(BO, "campusnight")).includes(P.campus), "a classmate misses the campus post");
  check((await topic(CY, "friendsdinner")).length === 0, "a stranger sees the friends-only post");
  check((await topic(CY, "surpriseparty")).length === 0, "a stranger sees the selected post");
  check((await topic(CY, "campusnight")).length === 0, "another campus sees the campus post");
  check((await topic(ANA, "surpriseparty")).includes(P.selected), "the author misses her own post");
});
await expectOk("a post made public later joins the rankings at the next refresh", async () => {
  await as(ANA, () => db.query("update public.feed_posts set audience = 'global' where id = $1", [P.friends]));
  await refresh();
  check((await ranked()).includes(P.friends), "not ranked after going Global");
  check((await trending()).includes("friendsdinner"), "its tag does not trend after going Global");
  await as(ANA, () => db.query("update public.feed_posts set audience = 'friends' where id = $1", [P.friends]));
  await refresh();
  check(!(await ranked()).includes(P.friends), "still ranked after going back to friends");
});
await expectOk("the migration re-runs", async () => {
  await db.exec(read(MIGRATION));
  check(!(await trending()).some((t) => PRIVATE_TAGS.includes(t)), "a private tag trends after re-running");
});
await expectOk("the rollback restores Discover's own refresh (every post ranked), and the migration applies again", async () => {
  await db.exec(read(ROLLBACK));
  check((await trending()).includes("surpriseparty"), "the rollback did not restore the original ranking");
  await db.exec(read(MIGRATION));
  check(!(await trending()).some((t) => PRIVATE_TAGS.includes(t)), "a private tag trends after applying again");
});

done("DISCOVER AUDIENCE");
