// Migration 44 (Discover, 20261103000300_discover.sql) against PGlite, in production's order (CampConnect Admin's
// moderation included): hashtags match the apps' captions, the rankings cover every campus and order by engagement and
// age, and every reader still obeys the rules on posts and profiles (blocks either way, posts hidden by moderators,
// suspended authors), signed in or out. Clients cannot write the rankings or run the refresh. The migration re-runs, its
// rollback removes it, and a database without CampConnect Admin's moderation runs it too.
import { register } from "node:module";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

// The shared sources import their siblings without an extension, as the bundlers resolve them (see packages/shared/tests).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);
const { captionParts } = await import("../../packages/shared/src/format.ts");

const MIGRATION = "migrations/20261103000300_discover.sql";
const ROLLBACK = "rollbacks/20261103000300_discover.down.sql";
const check = (cond, message) => { if (!cond) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { db, mk, as, asAnon } = await boot({ live: true });
const one = async (p) => (await p).rows[0];
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const UT = (await one(db.query("insert into public.universities (name, email_domain) values ('The University of Texas at Austin', 'utexas.edu') returning id"))).id;

const A = await mk("ana@txstate.edu", "Ana Alvarez");
const B = await mk("bo@txstate.edu", "Bo Brooks");
const C = await mk("cy@utexas.edu", "Cy Chen");
const D = await mk("dee@utexas.edu", "Dee Diaz");
const V = await mk("val@txstate.edu", "Val Viewer");
const post = (uid, campus, body) => as(uid, async () => (await one(db.query("insert into public.feed_posts (author_id, university_id, kind, body) values ($1, $2, 'post', $3) returning id", [uid, campus, body]))).id);
const like = (uid, id) => as(uid, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post', $1, $2)", [id, uid]));
const comment = (uid, id, body) => as(uid, () => db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post', $1, $2, $3)", [id, uid, body]));
const refresh = async () => (await one(db.query("select public.discover_refresh() as r"))).r;
const ids = (rows) => rows.map((r) => r.post_id);
const feed = (uid, campus = null) => as(uid, async () => ids((await db.query("select post_id from public.discover_feed($1, 50, 0)", [campus])).rows));

// --- Hashtags --------------------------------------------------------------------------------------------------------
const CAPTIONS = [
  "Move-in day at #TXST! #movein #MoveIn",
  "x#no (#paren) [#bracket] #end. email@site.com #ok,",
  "#a#b ##double #_under_score #123",
  `#${"x".repeat(61)} long`,
  "no tags here # at all",
];
await expectOk("the database finds exactly the tags the apps colour (captionParts), lowercased, each once", async () => {
  for (const text of CAPTIONS) {
    const app = [...new Set(captionParts(text).filter((p) => p.tag).map((p) => p.text.slice(1).toLowerCase()))].sort();
    const stored = (await one(db.query("select public.extract_hashtags($1) as t", [text]))).t;
    check(same(stored, app), `${JSON.stringify(text)}: database ${JSON.stringify(stored)}, app ${JSON.stringify(app)}`);
  }
});
const pA = await post(A, TX, "Move-in day at #TXST! #MoveIn");
await expectOk("a post keeps its tags in feed_posts.hashtags, and an edit updates them", async () => {
  const tags = async (id) => (await one(db.query("select hashtags from public.feed_posts where id = $1", [id]))).hashtags;
  check(same(await tags(pA), ["movein", "txst"]), JSON.stringify(await tags(pA)));
  await as(A, () => db.query("update public.feed_posts set body = 'Move-in day at #TXST! #MoveIn #Dorms' where id = $1", [pA]));
  check(same(await tags(pA), ["dorms", "movein", "txst"]), JSON.stringify(await tags(pA)));
});
await expectError("nobody can write the tags themselves", () => as(A, () => db.query("update public.feed_posts set hashtags = array['spam'] where id = $1", [pA])), "hashtags");

// --- Rankings ----------------------------------------------------------------------------------------------------------
const pB = await post(B, TX, "Library open late tonight #finals");
const pC = await post(C, UT, "Sunset over the tower");
const pD = await post(D, UT, "Longhorns game tonight #gameday #finals");
for (const u of [B, C, D, V]) await like(u, pA);
await comment(B, pA, "Welcome!");
await comment(C, pA, "Have fun");
await like(A, pD);
await like(V, pD);
await like(D, pB);
const counts = await expectOk("the refresh ranks every post, topic and account", async () => {
  const r = await refresh();
  check(r.posts === 4 && r.topics === 5 && r.accounts === 5, JSON.stringify(r));
  return r;
});
await expectOk("Discover shows posts from every campus, the most engaging first", async () => {
  const got = await feed(V);
  check(got.length === 4 && got[0] === pA, JSON.stringify({ got, pA }));
  check(got.includes(pC) && got.includes(pD), "the other campus is missing");
});
await expectOk("one campus at a time, when asked", async () => {
  const ut = await feed(V, UT);
  check(ut.length === 2 && ut.every((id) => id === pC || id === pD), JSON.stringify(ut));
});
await expectOk("paging: the second page starts where the first ended", async () => {
  const page = (offset) => as(V, async () => ids((await db.query("select post_id from public.discover_feed(null, 2, $1)", [offset])).rows));
  const [first, second] = [await page(0), await page(2)];
  check(first.length === 2 && second.length === 2 && !second.some((id) => first.includes(id)), JSON.stringify({ first, second }));
});
await expectOk("trending topics: a tag used by two people beats one person's tags", async () => {
  const topics = (await as(V, () => db.query("select tag, posts from public.discover_topics(10)"))).rows;
  check(topics[0]?.tag === "finals" && topics[0].posts === 2, JSON.stringify(topics));
  check(topics.length === counts.topics, JSON.stringify(topics));
});

// --- Search ------------------------------------------------------------------------------------------------------------
const searchTopics = (q) => as(V, async () => (await db.query("select tag from public.discover_search_topics($1, 10)", [q])).rows.map((r) => r.tag));
await expectOk("topic search: the start of a tag, with or without # or capitals", async () => {
  check(same(await searchTopics("#fin"), ["finals"]), "#fin");
  check(same(await searchTopics("FIN"), ["finals"]), "FIN");
  check(same(await searchTopics("move"), ["movein"]), "move");
});
await expectOk("topic search: '_' is a letter, not a wildcard, and punctuation alone finds nothing", async () => {
  check((await searchTopics("f_nals")).length === 0, "f_nals matched");
  check((await searchTopics("%")).length === 0, "% matched");
  check((await searchTopics("")).length === 0, "empty matched");
});
const searchPosts = (q) => as(V, async () => ids((await db.query("select post_id from public.discover_search_posts($1, 24, 0)", [q])).rows));
await expectOk("post search: the start of each word typed, in any order, on every campus", async () => {
  check(same(await searchPosts("libr"), [pB]), "libr");
  check(same(await searchPosts("tonight longhorns"), [pD]), "tonight longhorns");
  check((await searchPosts("tonight")).length === 2, "tonight");
});
await expectOk("post search: nothing for an empty box, and SQL in the box is just words", async () => {
  check((await searchPosts("")).length === 0, "empty box");
  check((await searchPosts("'); drop table public.feed_posts; --")).length === 0, "sql");
  check((await one(db.query("select count(*)::int as n from public.feed_posts"))).n === 4, "posts gone");
});
await expectOk("a topic page: its count and its posts, top or newest first", async () => {
  const head = await as(V, () => one(db.query("select tag, posts from public.discover_topic('#Finals')")));
  check(head.tag === "finals" && Number(head.posts) === 2, JSON.stringify(head));
  const recent = await as(V, async () => ids((await db.query("select post_id from public.discover_topic_posts('finals', 'recent', 24, 0)")).rows));
  check(same(recent, [pD, pB]), JSON.stringify(recent));
  const top = await as(V, async () => ids((await db.query("select post_id from public.discover_topic_posts('finals', 'top', 24, 0)")).rows));
  check(top.length === 2, JSON.stringify(top));
});

// --- Accounts ----------------------------------------------------------------------------------------------------------
const accounts = (uid) => as(uid, async () => (await db.query("select id, email_domain, university_name, followers from public.discover_accounts(null, 20, 0)")).rows);
await expectOk("accounts to follow come from every campus, with their university, never yourself", async () => {
  const got = await accounts(V);
  check(got.length === 4 && !got.some((a) => a.id === V), JSON.stringify(got));
  const cy = got.find((a) => a.id === C);
  check(cy && cy.email_domain === "utexas.edu" && cy.university_name === "The University of Texas at Austin", JSON.stringify(cy));
});
await expectOk("someone you follow drops out, and the most followed come first", async () => {
  await as(B, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [B, D]));
  await as(A, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [A, D]));
  await as(V, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [V, A]));
  await refresh();
  const got = await accounts(V);
  check(!got.some((a) => a.id === A), "a followed account is suggested");
  check(got[0]?.id === D && got[0].followers === 2, JSON.stringify(got));
});

// --- The rules on posts and profiles still decide -----------------------------------------------------------------------
await expectOk("blocking hides the other person's posts, and each account from the other", async () => {
  await as(V, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [V, C]));
  check(!(await feed(V)).includes(pC), "the blocked person's post is in the blocker's Discover");
  check(!(await accounts(V)).some((a) => a.id === C), "the blocked person is suggested to the blocker");
  check(!(await accounts(C)).some((a) => a.id === V), "the blocker is suggested to the blocked person");
  check((await feed(B)).includes(pC), "someone else lost the post");
});
await expectOk("a post hidden by moderators leaves Discover at once, and the next refresh drops it", async () => {
  await db.exec("select set_config('app.moderation', 'on', false)");
  await db.query("update public.feed_posts set hidden_at = now(), hidden_reason = 'Spam' where id = $1", [pB]);
  await db.exec("select set_config('app.moderation', 'off', false)");
  check(!(await feed(V)).includes(pB), "the hidden post is still in Discover");
  const r = await refresh();
  check(r.posts === 3, JSON.stringify(r));
  check((await one(db.query("select count(*)::int as n from public.discover_post_ranks where post_id = $1", [pB]))).n === 0, "still ranked");
  const head = await as(V, () => one(db.query("select posts from public.discover_topic('finals')")));
  check(Number(head.posts) === 1, `the topic still counts the hidden post: ${JSON.stringify(head)}`);
});
await expectOk("a suspended author's posts and account leave Discover", async () => {
  await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'Spamming the feed')", [D]);
  check(!(await feed(V)).includes(pD), "the suspended author's post is still in Discover");
  await refresh();
  check(!(await accounts(V)).some((a) => a.id === D), "the suspended account is suggested");
  check((await one(db.query("select count(*)::int as n from public.discover_post_ranks where post_id = $1", [pD]))).n === 0, "still ranked");
  await db.query("update public.account_restrictions set lifted_at = now() where user_id = $1", [D]);
  await refresh();
});
await expectOk("signed out, Discover still shows posts, topics and people", async () => {
  const got = await asAnon(async () => ({
    posts: ids((await db.query("select post_id from public.discover_feed(null, 50, 0)")).rows),
    topics: (await db.query("select tag from public.discover_topics(10)")).rows.length,
    people: (await db.query("select id from public.discover_accounts(null, 20, 0)")).rows.length,
  }));
  check(got.posts.includes(pA) && got.posts.includes(pC) && got.topics > 0 && got.people === 5, JSON.stringify(got));
});

// --- Only the database writes the rankings ----------------------------------------------------------------------------
await expectError("a client cannot write a ranking", () => as(V, () => db.query("insert into public.discover_post_ranks (post_id, kind, score, rank) values ($1, 'post', 1e9, 0)", [pA])), "permission denied");
await expectError("or empty one", () => as(V, () => db.query("delete from public.discover_topic_ranks")), "permission denied");
await expectError("or run the refresh", () => as(V, () => db.query("select public.discover_refresh()")), "permission denied");

// --- Re-run, rollback, again ------------------------------------------------------------------------------------------
await expectOk("the migration re-runs cleanly", async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read(MIGRATION));
  check((await feed(V)).includes(pA), "Discover lost its posts");
});
await expectOk("the rollback removes the rankings, the readers and the hashtags column", async () => {
  await db.exec(read(ROLLBACK));
  const left = (await db.query(`select
      (select count(*) from pg_proc where proname like 'discover\\_%' or proname = 'extract_hashtags')::int as functions,
      (select count(*) from pg_class where relname like 'discover\\_%')::int as tables,
      (select count(*) from information_schema.columns where table_name = 'feed_posts' and column_name = 'hashtags')::int as columns`)).rows[0];
  check(left.functions === 0 && left.tables === 0 && left.columns === 0, JSON.stringify(left));
  check((await one(db.query("select count(*)::int as n from public.feed_posts"))).n === 4, "a post was lost");
});
await expectOk("and the migration applies again after it, tags and all", async () => {
  await db.exec(read(MIGRATION));
  check(same((await one(db.query("select hashtags from public.feed_posts where id = $1", [pA]))).hashtags, ["dorms", "movein", "txst"]), "tags");
  check((await feed(V)).includes(pA), "Discover is empty");
});

// --- A database without CampConnect Admin's moderation ----------------------------------------------------------------
await expectOk("without CampConnect Admin's hidden_at and suspensions, the refresh and the readers work", async () => {
  const bare = await boot();
  const E = await bare.mk("eve@txstate.edu", "Eve Evans");
  await bare.as(E, () => bare.db.query("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Hello #campus')", [E]));
  const r = (await bare.db.query("select public.discover_refresh() as r")).rows[0].r;
  check(r.posts === 1 && r.topics === 1 && r.accounts === 1, JSON.stringify(r));
  const rows = (await bare.asAnon(() => bare.db.query("select post_id from public.discover_feed(null, 10, 0)"))).rows;
  check(rows.length === 1, JSON.stringify(rows));
});

done("MIGRATION-44 DISCOVER");
