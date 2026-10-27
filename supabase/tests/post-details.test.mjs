// Migration 44 (titles, links, audience and a comments switch on posts and reels, 20261104000000_post_details.sql)
// against PGlite, twice: on this repo's migrations alone and on production's schema (with the migrations applied
// outside this repo, where they ran). Each run starts just before 44, records the schema, applies 44, and checks the
// defaults and every check, then each audience (campus, global, friends, selected) against each kind of viewer (the
// author, a stranger at the same campus, a stranger at another campus, a friend, a picked follower, a follower who was
// not picked, signed out) through plain selects, reels_feed(), following_posts(), profile_stats(), reading and writing
// comments, likes, saves, views and post_likers_many(); set_post_viewers() and who may read feed_post_viewers; the
// moderators' snapshot; the shared-post guard per audience and chat; staff still reviewing any post; and that the
// rollback refuses while details exist, otherwise puts the schema back exactly as it was (also when run again), after
// which 44 applies again.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, ok, fail, expectOk, expectError, done } from "./harness.mjs";

const NAME = "20261104000000_post_details.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261104000000_post_details.down.sql";
// The migration just before 44: each run boots up to it, then applies 44 itself.
const BEFORE = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const VIDEO = JSON.stringify([{ media_id: "00000000-0000-4000-8000-000000000001", playback_id: "pb1abcdef", poster_url: null, width: 1080, height: 1920, duration_seconds: 5 }]);
const AUDIENCES = ["campus", "global", "friends", "selected"];
const NIL = "00000000-0000-4000-8000-0000000000ff";
const check = (cond, message) => { if (!cond) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

/** Refused with this message and SQLSTATE (42501 = insufficient_privilege, what PostgREST answers with 403). */
const expectRefused = async (name, fn, message, code = "42501") => {
  try { await fn(); fail(name, "no error"); } catch (e) { if (e.message.includes(message) && e.code === code) ok(name); else fail(name, `${e.code}: ${e.message}`); }
};
/** Runs fn; "ok" or the error message (for checks that try many combinations). */
const outcome = async (fn) => { try { await fn(); return "ok"; } catch (e) { return e.message; } };

/** Columns, constraints, triggers, policies and public functions (body, rights, settings, grants), for before/after. */
const fingerprint = async (db) => (await db.query(`
  select 'column ' || table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as x
    from information_schema.columns where table_schema in ('public', 'storage', 'auth')
  union all
  select 'constraint ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'trigger ' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
  union all
  select 'policy ' || schemaname || '.' || tablename || '.' || policyname || ' ' || permissive || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') from pg_policies
  union all
  select 'function ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(p.proconfig::text, '') || ' ' || coalesce(p.proacl::text, '') || ' ' || pg_get_function_result(p.oid)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'table ' || c.oid::regclass::text || ' ' || coalesce(c.relacl::text, '') from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'i')
  order by 1`)).rows.map((r) => r.x);
const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => `- ${x}`), ...b.filter((x) => !a.includes(x)).map((x) => `+ ${x}`)].join("\n");

async function suite(label, live) {
  const { db, mk, as, asAnon } = await boot({ live, upTo: BEFORE });
  const t = (name) => `${label}: ${name}`;
  const one = async (p) => (await p).rows[0];
  const run = (who, fn) => (who ? as(who, fn) : asAnon(fn));
  const before = await fingerprint(db);
  await expectOk(t(`the migration applies after ${BEFORE} and re-runs cleanly`), async () => { await db.exec(read(MIGRATION)); await db.exec(read(MIGRATION)); });

  const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
  const UT = (await one(db.query("select id from public.universities where name = 'University of Texas at Austin'"))).id;
  // A second campus people can sign up from: its domain is what makes its students verified (campus = email domain).
  await db.query("update public.universities set email_domain = 'utexas.edu' where id = $1", [UT]);
  /** A student with a confirmed university email (their verified campus) whose Liked tab is public (for post_likers_many). */
  const person = async (email, name, opts = {}) => {
    const id = await mk(email, name, opts);
    await db.query("update public.profiles set liked_visibility = 'public' where id = $1", [id]);
    return id;
  };
  const ANN = await person("ann@txstate.edu", "Ann Author");
  const CAMPUS = await person("cara@txstate.edu", "Cara Campus"); // Ann's campus, no follows
  const CAMPUS2 = await person("carl@txstate.edu", "Carl Campus"); // Ann's campus too (group chats)
  const OTHER = await person("oli@utexas.edu", "Oli Other"); // another campus, no follows
  const FRI = await person("fay@utexas.edu", "Fay Friend"); // follows Ann and is followed back
  const PICK = await person("pia@utexas.edu", "Pia Picked"); // follows Ann; picked for the selected posts
  const NOPICK = await person("ned@utexas.edu", "Ned Notpicked"); // follows Ann; not picked
  const BLK = await person("bo@utexas.edu", "Bo Blocked"); // has blocked Ann
  const WHO = { [ANN]: "Ann", [CAMPUS]: "Cara", [CAMPUS2]: "Carl", [OTHER]: "Oli", [FRI]: "Fay", [PICK]: "Pia", [NOPICK]: "Ned", [BLK]: "Bo" };
  const follow = (a, b) => as(a, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [a, b]));
  const unfollow = (a, b) => as(a, () => db.query("delete from public.follows where follower_id = $1 and followee_id = $2", [a, b]));
  await follow(FRI, ANN); await follow(ANN, FRI); await follow(PICK, ANN); await follow(NOPICK, ANN);
  await as(BLK, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [BLK, ANN]));
  /** Someone posts: cols are feed_posts columns; returns the row the insert hands back. */
  const post = (uid, cols) => {
    const keys = Object.keys(cols);
    return as(uid, () => one(db.query(`insert into public.feed_posts (author_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) returning *`, [uid, ...Object.values(cols)])));
  };
  const setViewers = (who, id, ids) => as(who, () => one(db.query("select public.set_post_viewers($1, $2::uuid[]) as n", [id, ids]))).then((r) => r.n);

  // --- Defaults and checks ----------------------------------------------------------------------------------------
  await expectOk(t("defaults: a plain post is Global with comments on, no title and no link"), async () => {
    const p = await post(ANN, { body: "plain post" });
    check(p.audience === "global" && p.comments_off === false && p.title === null && p.link_url === null, JSON.stringify(p));
  });
  await expectOk(t("a post and a reel take a title, a link, an audience and comments off (and the author gets the row back)"), async () => {
    const p = await post(ANN, { body: "with details", title: "Study group tonight", link_url: "https://example.com/rsvp?x=1#top", audience: "friends", comments_off: true });
    check(p.title === "Study group tonight" && p.link_url === "https://example.com/rsvp?x=1#top" && p.audience === "friends" && p.comments_off === true, JSON.stringify(p));
    const r = await post(ANN, { kind: "reel", body: "reel with details", videos: VIDEO, title: "Campus tour", link_url: "http://localhost:3000/tour", audience: "selected" });
    check(r.title === "Campus tour" && r.audience === "selected", JSON.stringify(r));
  });
  await expectOk(t("a post may be just a title (feed_posts_not_empty counts it); 100 characters is the most"), async () => {
    await post(ANN, { body: "", title: "Just a title" });
    await post(ANN, { body: "long title", title: "x".repeat(100) });
  });
  await expectError(t("an empty post with no title is still refused"), () => post(ANN, { body: "   " }), "feed_posts_not_empty");
  for (const [what, title] of [["empty", ""], ["blank", "   "], ["whitespace only", " \n\t "], ["101 characters", "x".repeat(101)]]) {
    await expectError(t(`title: ${what} is refused`), () => post(ANN, { body: "b", title }), "feed_posts_title_check");
  }
  await expectOk(t("link: http(s) in any case, a port, a path, a query; exactly 500 characters"), async () => {
    for (const link_url of ["HTTPS://Example.com/Path?q=1", "http://localhost:3000/x", "https://example.com/" + "a".repeat(480)]) await post(ANN, { body: "link", link_url });
  });
  for (const [what, link_url] of [
    ["another scheme", "ftp://files.example.com/a"], ["javascript:", "javascript:alert(1)"], ["no scheme", "www.example.com"], ["nothing after the scheme", "https://"],
    ["a space", "https://example.com/a b"], ["a trailing newline", "https://example.com/\n"], ["501 characters", "https://example.com/" + "a".repeat(481)],
  ]) {
    await expectError(t(`link: ${what} is refused`), () => post(ANN, { body: "b", link_url }), "feed_posts_link_url_check");
  }
  for (const audience of ["everyone", "followers", "only_me", "public", "Global"]) {
    await expectError(t(`audience: '${audience}' is refused`), () => post(ANN, { body: "b", audience, university_id: TX }), "feed_posts_audience_check");
  }
  await expectError(t("audience: null is refused"), () => post(ANN, { body: "b", audience: null }), "null value");
  await expectError(t("comments_off: null is refused"), () => post(ANN, { body: "b", comments_off: null }), "null value");
  const CAMPUS_REFUSAL = "You can only post to your own campus.";
  await expectRefused(t("campus: a campus post needs its author's verified campus (none given)"), () => post(ANN, { body: "b", audience: "campus" }), CAMPUS_REFUSAL);
  await expectRefused(t("campus: nor another campus than the author's verified one"), () => post(ANN, { body: "b", audience: "campus", university_id: UT }), CAMPUS_REFUSAL);
  await expectOk(t("campus: her own campus is accepted; its university cannot then be removed or moved, nor a post at another campus be made campus-only"), async () => {
    const p = await post(ANN, { body: "campus check", audience: "campus", university_id: TX });
    for (const sql of [
      "update public.feed_posts set university_id = null where id = $1",
      `update public.feed_posts set university_id = '${UT}' where id = $1`,
      // feed_posts_guard keeps the author, so a different author_id in the same update changes nothing about the check
      `update public.feed_posts set author_id = '${OTHER}', university_id = '${UT}' where id = $1`,
    ]) {
      const o = await outcome(() => as(ANN, () => db.query(sql, [p.id])));
      check(o.includes(CAMPUS_REFUSAL), `${sql}: ${o}`);
    }
    await as(ANN, () => db.query("update public.feed_posts set body = 'campus check, edited' where id = $1", [p.id]));
    const elsewhere = await post(ANN, { body: "global at UT", university_id: UT });
    const o = await outcome(() => as(ANN, () => db.query("update public.feed_posts set audience = 'campus' where id = $1", [elsewhere.id])));
    check(o.includes(CAMPUS_REFUSAL), o);
    await as(ANN, () => db.query("update public.feed_posts set audience = 'global', university_id = null where id = $1", [p.id]));
  });

  // --- The matrix: one post and one reel per audience, all at Ann's campus -----------------------------------------
  const P = {}, R = {};
  for (const a of AUDIENCES) {
    P[a] = (await post(ANN, { body: `post ${a}`, audience: a, university_id: TX })).id;
    R[a] = (await post(ANN, { kind: "reel", body: `reel ${a}`, videos: VIDEO, audience: a, university_id: TX })).id;
  }
  await expectOk(t("set_post_viewers(): the author picks Pia for the selected post and reel"), async () => {
    check((await setViewers(ANN, P.selected, [PICK])) === 1 && (await setViewers(ANN, R.selected, [PICK])) === 1, "not stored");
  });
  const MATRIX = [...Object.values(P), ...Object.values(R)];
  const NAMES = Object.fromEntries([...Object.entries(P).map(([a, id]) => [id, `post ${a}`]), ...Object.entries(R).map(([a, id]) => [id, `reel ${a}`])]);
  const VIEWERS = [
    ["the author", ANN, AUDIENCES],
    ["a stranger at the same campus", CAMPUS, ["campus", "global"]],
    ["a stranger at another campus", OTHER, ["global"]],
    ["a friend (another campus)", FRI, ["global", "friends"]],
    ["a picked follower (another campus)", PICK, ["global", "selected"]],
    ["a follower who was not picked (another campus)", NOPICK, ["global"]],
    ["signed out", null, ["global"]],
  ];
  const both = (sees) => sees.flatMap((a) => [`post ${a}`, `reel ${a}`]).sort();
  const bodies = (who) => run(who, () => db.query("select body from public.feed_posts where id = any($1::uuid[]) order by body", [MATRIX])).then((r) => r.rows.map((x) => x.body));
  for (const [name, who, sees] of VIEWERS) {
    await expectOk(t(`select: ${name} sees ${sees.join(", ")}`), async () => {
      const got = await bodies(who);
      check(same(got, both(sees)), JSON.stringify(got));
    });
    await expectOk(t(`reels_feed(): ${name} gets the reels for ${sees.join(", ")}`), async () => {
      const got = (await run(who, () => db.query("select caption from public.reels_feed(null, 30, 0) where source_id = any($1::uuid[]) order by caption", [MATRIX]))).rows.map((x) => x.caption);
      check(same(got, sees.map((a) => `reel ${a}`).sort()), JSON.stringify(got));
    });
    const follows = [FRI, PICK, NOPICK].includes(who);
    await expectOk(t(`following_posts(): ${name} ${follows ? `gets the posts and reels for ${sees.join(", ")}` : "gets nothing of Ann's"}`), async () => {
      const got = (await run(who, () => db.query("select body from public.following_posts('post') where id = any($1::uuid[]) union all select body from public.following_posts('reel') where id = any($1::uuid[])", [MATRIX]))).rows.map((x) => x.body).sort();
      check(same(got, follows ? both(sees) : []), JSON.stringify(got));
    });
  }
  const statsOf = (who) => run(who, () => one(db.query("select posts::int, reels::int, likes_received::int from public.profile_stats($1)", [ANN])));
  // Ann's posts and reels per audience (the matrix plus the ones the checks above made), counted as the database owner.
  const byAudience = Object.fromEntries((await db.query("select audience, count(*) filter (where kind = 'post')::int as posts, count(*) filter (where kind = 'reel')::int as reels from public.feed_posts where author_id = $1 group by audience", [ANN])).rows.map((r) => [r.audience, r]));
  for (const [name, who, sees] of VIEWERS) {
    await expectOk(t(`profile_stats(): ${name} counts only the posts and reels for ${sees.join(", ")}`), async () => {
      const s = await statsOf(who);
      // The selected reel with details (picked nobody) and the matrix are Ann's only selected posts; only Ann sees the first.
      const count = (kind) => sees.reduce((n, a) => n + (byAudience[a]?.[kind] ?? 0), 0) - (who !== ANN && sees.includes("selected") && kind === "reels" ? 1 : 0);
      check(s.posts === count("posts") && s.reels === count("reels"), `${JSON.stringify(s)} want ${count("posts")} posts, ${count("reels")} reels`);
    });
  }

  // --- The rules follow changes at once ---------------------------------------------------------------------------
  await expectOk(t("friends: unfollowing (either way) closes friends-only posts; following again opens them"), async () => {
    await unfollow(ANN, FRI);
    check(same(await bodies(FRI), both(["global"])), "Fay still sees friends-only posts after Ann unfollowed her");
    await follow(ANN, FRI);
    check(same(await bodies(FRI), both(["global", "friends"])), "following back did not open them");
  });
  await expectOk(t("campus: editing the profile's university opens nothing (Oli -> Texas State) and closes nothing (Cara -> UT Austin)"), async () => {
    const setUni = (who, uni) => as(who, () => db.query("update public.profiles set university_id = $2 where id = $1", [who, uni]));
    await setUni(OTHER, TX); await setUni(CAMPUS, UT);
    check((await one(db.query("select university_id from public.profiles where id = $1", [OTHER]))).university_id === TX, "the profile edit did not happen");
    check(same(await bodies(OTHER), both(["global"])), "Oli sees campus posts after editing his profile");
    check(same(await bodies(CAMPUS), both(["campus", "global"])), "Cara lost campus posts after editing her profile");
    await setUni(OTHER, UT); await setUni(CAMPUS, TX);
  });
  const UNC = await person("una@txstate.edu", "Una Unconfirmed", { confirmed: false });
  await expectOk(t("campus: someone whose university email is not confirmed sees no campus posts; once it is, they do"), async () => {
    check(same(await bodies(UNC), both(["global"])), JSON.stringify(await bodies(UNC)));
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [UNC]);
    check(same(await bodies(UNC), both(["campus", "global"])), JSON.stringify(await bodies(UNC)));
    await db.query("update auth.users set email_confirmed_at = null where id = $1", [UNC]);
  });
  await expectRefused(t("campus: nor may they post to a campus"), () => post(UNC, { body: "b", audience: "campus", university_id: TX }), CAMPUS_REFUSAL);
  await expectError(t("campus: (without a university their campus post meets the not-null check instead)"), () => post(UNC, { body: "b", audience: "campus" }), "feed_posts_campus_has_university");
  await expectOk(t("campus: a business account has no verified campus, even with a university address, and cannot post at all"), async () => {
    const BIZ = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('leasing@txstate.edu', $1, now()) returning id", [JSON.stringify({ account_type: "business", full_name: "Lee Leasing", business_name: "Bobcat Lofts", business_category: "housing", business_university_id: TX })]))).id;
    const v = await one(db.query("select public.verified_university($1) as biz, public.verified_university($2) as ann, public.verified_university($3) as una", [BIZ, ANN, UNC]));
    check(v.biz === null && v.ann === TX && v.una === null, JSON.stringify(v));
    const o = await outcome(() => post(BIZ, { body: "b", audience: "campus", university_id: TX }));
    check(o.includes("Business accounts"), o);
  });
  for (const fn of ["verified_university($1)", "can_see_feed_post_as($1, $1, $1, 'campus', $1)"]) {
    await expectError(t(`${fn.split("(")[0]}() cannot be called through the API (signed in or out)`), async () => {
      const o = await outcome(() => as(ANN, () => db.query(`select public.${fn}`, [ANN])));
      check(o.includes("permission denied"), "signed in: " + o);
      await asAnon(() => db.query(`select public.${fn}`, [ANN]));
    }, "permission denied");
  }
  await expectOk(t("selected: a new list replaces the old one (Ned in, Pia out), and back"), async () => {
    check((await setViewers(ANN, P.selected, [NOPICK])) === 1, "not stored");
    check(!(await bodies(PICK)).includes("post selected") && (await bodies(NOPICK)).includes("post selected"), "the list was not replaced");
    await setViewers(ANN, P.selected, [PICK]);
    check((await bodies(PICK)).includes("post selected") && !(await bodies(NOPICK)).includes("post selected"), "not put back");
  });
  await expectOk(t("the author changes the audience: Global -> friends closes it to a stranger, and back opens it"), async () => {
    await as(ANN, () => db.query("update public.feed_posts set audience = 'friends' where id = $1", [P.global]));
    check(!(await bodies(CAMPUS)).includes("post global"), "not closed");
    await as(ANN, () => db.query("update public.feed_posts set audience = 'global' where id = $1", [P.global]));
    check((await bodies(CAMPUS)).includes("post global"), "not opened");
  });
  await expectOk(t("nobody else changes a post's audience or comments switch (the update finds no row)"), async () => {
    for (const who of [FRI, CAMPUS]) {
      const r = await as(who, () => db.query("update public.feed_posts set audience = 'global', comments_off = true where id = any($1::uuid[])", [[P.friends, P.campus, P.global]]));
      check(r.affectedRows === 0, `${r.affectedRows} rows changed`);
    }
  });

  // --- set_post_viewers() and feed_post_viewers --------------------------------------------------------------------
  const S = (await post(ANN, { body: "who is coming?", audience: "selected" })).id;
  await expectOk(t("selected: before any list, a selected post is seen by its author only"), async () => {
    for (const who of [CAMPUS, PICK, FRI]) check(!(await run(who, () => db.query("select 1 from public.feed_posts where id = $1", [S]))).rows.length, `${WHO[who]} sees it`);
    check((await as(ANN, () => db.query("select 1 from public.feed_posts where id = $1", [S]))).rows.length === 1, "the author does not");
  });
  await expectOk(t("set_post_viewers(): drops the author, nulls, repeats, blocked people and ids that are not profiles; returns what it stored"), async () => {
    const n = await setViewers(ANN, S, [PICK, PICK, null, ANN, BLK, NIL, NOPICK]);
    const rows = (await db.query("select user_id from public.feed_post_viewers where post_id = $1 order by user_id", [S])).rows.map((r) => WHO[r.user_id]).sort();
    check(n === 2 && same(rows, ["Ned", "Pia"]), `${n}: ${JSON.stringify(rows)}`);
  });
  await expectRefused(t("set_post_viewers(): someone else cannot choose for Ann's post"), () => setViewers(FRI, S, [FRI]), "Only the author can choose who sees this post.");
  await expectRefused(t("set_post_viewers(): nor for a post that does not exist"), () => setViewers(ANN, NIL, [PICK]), "Only the author can choose who sees this post.");
  await expectError(t("set_post_viewers(): signed out it cannot be called at all"), () => asAnon(() => db.query("select public.set_post_viewers($1, $2::uuid[])", [S, [PICK]])), "permission denied");
  await expectRefused(t("set_post_viewers(): 51 people are refused, and the list stays as it was"), async () => {
    try { await setViewers(ANN, S, Array.from({ length: 51 }, (_, i) => uuid(i + 1))); }
    finally { check((await one(db.query("select count(*)::int as n from public.feed_post_viewers where post_id = $1", [S]))).n === 2, "the list changed"); }
  }, "Choose up to 50 people.", "22023");
  await expectOk(t("set_post_viewers(): 50 people (plus repeats and the author herself) are accepted; ids that are not profiles store nothing"), async () => {
    const ids = [...Array.from({ length: 50 }, (_, i) => uuid(i + 1)), uuid(1), uuid(2), ANN];
    check((await setViewers(ANN, S, ids)) === 0, "stored ids that are not profiles");
    check((await setViewers(ANN, S, [])) === 0, "an empty list did not clear");
    check((await setViewers(ANN, S, [PICK, NOPICK])) === 2, "not stored again");
  });
  await expectOk(t("feed_post_viewers: a picked person reads only their own rows; the author reads her list; others read nothing"), async () => {
    const rowsOf = (who) => as(who, () => db.query("select post_id, user_id from public.feed_post_viewers")).then((r) => r.rows);
    const pia = await rowsOf(PICK), ned = await rowsOf(NOPICK);
    check(pia.length === 3 && pia.every((r) => r.user_id === PICK), "Pia: " + JSON.stringify(pia)); // P.selected, R.selected, S
    check(ned.length === 1 && ned[0].user_id === NOPICK, "Ned: " + JSON.stringify(ned));
    check((await rowsOf(FRI)).length === 0 && (await rowsOf(CAMPUS)).length === 0, "someone unpicked reads rows");
    const ann = await rowsOf(ANN);
    check(ann.filter((r) => r.post_id === S).length === 2 && ann.length === 4, "Ann: " + JSON.stringify(ann));
  });
  await expectError(t("feed_post_viewers: signed out it cannot be read"), () => asAnon(() => db.query("select * from public.feed_post_viewers")), "permission denied");
  for (const [what, sql] of [
    ["insert", "insert into public.feed_post_viewers (post_id, user_id) values ($1, $2)"],
    ["update", "update public.feed_post_viewers set user_id = $2 where post_id = $1"],
    ["delete", "delete from public.feed_post_viewers where post_id = $1 and $2::uuid is not null"],
  ]) {
    await expectError(t(`feed_post_viewers: even the author cannot ${what} rows directly`), () => as(ANN, () => db.query(sql, [S, FRI])), "permission denied");
  }
  await expectOk(t("feed_post_viewers: deleting the post deletes its list"), async () => {
    await as(ANN, () => db.query("delete from public.feed_posts where id = $1", [S]));
    check((await one(db.query("select count(*)::int as n from public.feed_post_viewers where post_id = $1", [S]))).n === 0, "rows left");
  });

  // --- Comments, likes, saves, views and "liked by" per audience and viewer ---------------------------------------
  const comment = (who, postId, parent = null) => as(who, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body, parent_id, score) values ('post', $1, $2, 'nice', $3, 7) returning id, score", [postId, who, parent])));
  const notes = () => as(ANN, () => one(db.query("select count(*)::int as n from public.notifications where user_id = $1 and type = 'comment'", [ANN]))).then((r) => r.n);
  await expectOk(t("comments: the author comments on each of her posts; the score guard and comment notifications still work"), async () => {
    const n = await notes();
    for (const id of MATRIX) check((await comment(ANN, id)).score === 0, "score kept");
    const c = await comment(CAMPUS, P.global);
    check(c.score === 0 && (await notes()) === n + 1, "no notification for Cara's comment");
  });
  const commentedOn = (who) => run(who, () => db.query("select distinct target_id from public.post_comments where target_type = 'post' and target_id = any($1::uuid[]) and user_id = $2", [MATRIX, ANN])).then((r) => r.rows.map((x) => NAMES[x.target_id]).sort());
  /** Tries fn(id) on every matrix post: "allowed" or "refused", per post name; anything else is reported as it is. */
  const tryAll = async (fn, refusal) => {
    const got = {};
    for (const id of MATRIX) {
      const o = await outcome(() => fn(id));
      got[NAMES[id]] = o === "ok" ? "allowed" : o.includes(refusal) ? "refused" : o;
    }
    return got;
  };
  const expected = (sees) => Object.fromEntries(Object.values(NAMES).map((n) => [n, sees.some((a) => n.endsWith(` ${a}`)) ? "allowed" : "refused"]));
  for (const [name, who, sees] of VIEWERS) {
    await expectOk(t(`comment reads: ${name} reads the comments of ${sees.join(", ")} only`), async () => {
      const got = await commentedOn(who);
      check(same(got, both(sees)), JSON.stringify(got));
    });
    if (!who) continue;
    await expectOk(t(`comment writes: ${name} may comment on ${sees.join(", ")} only ("This post is not available.")`), async () => {
      const got = await tryAll((id) => comment(who, id), "This post is not available.");
      check(same(got, expected(sees)), JSON.stringify(got));
    });
  }
  await expectRefused(t("comment writes: the refusal is 42501 'This post is not available.'"), () => comment(OTHER, P.campus), "This post is not available.");
  await expectOk(t("comments: Ann turns comments off on her Global and friends-only posts"), () => as(ANN, () => db.query("update public.feed_posts set comments_off = true where id = any($1::uuid[])", [[P.global, P.friends]])));
  for (const [name, who] of [["a stranger", CAMPUS], ["the author herself", ANN], ["a friend", FRI]]) {
    await expectRefused(t(`comments off: ${name} cannot comment`), () => comment(who, P.global), "Comments are turned off for this post.");
  }
  await expectOk(t("comments off: nor reply to a comment written before"), async () => {
    const first = (await one(db.query("select id from public.post_comments where target_id = $1 and user_id = $2", [P.global, ANN]))).id;
    const o = await outcome(() => comment(FRI, P.global, first));
    check(o.includes("Comments are turned off for this post."), o);
  });
  await expectRefused(t("comments off on a friends-only post: someone outside hears it is not available (nothing more)"), () => comment(OTHER, P.friends), "This post is not available.");
  await expectRefused(t("comments off on a friends-only post: a friend hears comments are off"), () => comment(FRI, P.friends), "Comments are turned off for this post.");
  await expectOk(t("comments back on: a stranger comments again"), async () => {
    await as(ANN, () => db.query("update public.feed_posts set comments_off = false where id = any($1::uuid[])", [[P.global, P.friends]]));
    await comment(CAMPUS, P.global);
  });
  await expectOk(t("comment reads: after Ann unfollows Fay, Fay still reads and can delete her own comment on a friends-only post, no one else's"), async () => {
    await unfollow(ANN, FRI);
    const seen = (await as(FRI, () => db.query("select id, user_id from public.post_comments where target_id = $1", [P.friends]))).rows;
    check(seen.length === 1 && seen[0].user_id === FRI, JSON.stringify(seen));
    check((await as(FRI, () => db.query("delete from public.post_comments where id = $1", [seen[0].id]))).affectedRows === 1, "could not delete her own comment");
    await follow(ANN, FRI);
  });
  await expectOk(t("comment counts: post_engagement_many() and reels_feed() count the comments the caller may read (0 for a post out of reach)"), async () => {
    const n = Number((await one(db.query("select count(*) as n from public.post_comments where target_id = $1", [R.friends]))).n);
    const eng = async (who) => Number((await run(who, () => one(db.query("select comments from public.post_engagement_many('post', array[$1]::uuid[])", [R.friends])))).comments);
    check(n > 1 && (await eng(FRI)) === n && (await eng(ANN)) === n, `friend/author counts differ from ${n}`);
    check((await eng(OTHER)) === 0 && (await eng(CAMPUS)) === 0 && (await eng(null)) === 0, "someone outside counted comments of a friends-only reel");
    const reel = await as(FRI, () => one(db.query("select comments from public.reels_feed(null, 30, 0) where source_id = $1", [R.friends])));
    check(Number(reel.comments) === n, JSON.stringify(reel));
  });
  const like = (who, id) => as(who, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post', $1, $2)", [id, who]));
  const save = (who, id) => as(who, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('post', $1, $2)", [id, who]));
  for (const [name, who, sees] of VIEWERS.filter(([, who]) => who)) {
    await expectOk(t(`likes: ${name} may like ${sees.join(", ")} only`), async () => {
      const got = await tryAll((id) => like(who, id), "This post is not available.");
      check(same(got, expected(sees)), JSON.stringify(got));
    });
    await expectOk(t(`saves: ${name} may save ${sees.join(", ")} only`), async () => {
      const got = await tryAll((id) => save(who, id), "This post is not available.");
      check(same(got, expected(sees)), JSON.stringify(got));
    });
  }
  await expectRefused(t("likes: the refusal is 42501 'This post is not available.'"), () => like(OTHER, R.selected), "This post is not available.");
  await expectRefused(t("saves: the refusal is 42501 'This post is not available.'"), () => save(NOPICK, P.selected), "This post is not available.");
  await expectOk(t("views: record_view() records a view only from someone who may see the post (signed out included; never the author)"), async () => {
    for (const [, who] of VIEWERS) for (const id of MATRIX) await run(who, () => db.query("select public.record_view('post', $1, $2)", [id, "visitor-1"]));
    const rows = (await db.query("select target_id, coalesce(viewer_id::text, viewer_key) as v from public.post_views where target_type = 'post' and target_id = any($1::uuid[])", [MATRIX])).rows;
    for (const [name, who, sees] of VIEWERS) {
      const key = who ?? "visitor-1";
      const got = rows.filter((r) => r.v === key).map((r) => NAMES[r.target_id]).sort();
      check(same(got, who === ANN ? [] : both(sees)), `${name}: ${JSON.stringify(got)}`);
    }
  });
  for (const [name, who, sees] of VIEWERS) {
    await expectOk(t(`post_likers_many(): ${name} gets the likers of ${sees.join(", ")} only`), async () => {
      const got = [...new Set((await run(who, () => db.query("select target_id from public.post_likers_many('post', $1::uuid[], 10)", [MATRIX]))).rows.map((r) => NAMES[r.target_id]))].sort();
      check(same(got, both(sees)), JSON.stringify(got));
    });
  }
  await expectOk(t("profile_stats(): the likes total still counts likes on every post, as before"), async () => {
    const all = (await one(db.query("select count(*)::int as n from public.post_likes l join public.feed_posts f on f.id = l.target_id where l.target_type = 'post' and f.author_id = $1", [ANN]))).n;
    check((await statsOf(OTHER)).likes_received === all, "the likes total changed");
  });
  await expectOk(t("ts_public_snapshot(): moderators see a post's title, link and a narrower audience; a plain Global post's snapshot is as before"), async () => {
    const fields = async (id) => (await one(db.query("select public.ts_public_snapshot('post', $1) as s", [id]))).s.fields.map((f) => `${f.field}: ${f.text}`);
    const titled = await post(ANN, { body: "Free textbooks", title: "Giveaway", link_url: "https://example.com/claim", audience: "friends" });
    check(same(await fields(titled.id), ["title: Giveaway", "body: Free textbooks", "link: https://example.com/claim", "audience: Friends only"]), JSON.stringify(await fields(titled.id)));
    check(same(await fields(P.campus), ["body: post campus", "audience: Campus only"]), JSON.stringify(await fields(P.campus)));
    check(same(await fields(R.selected), ["body: reel selected", "audience: Selected people"]), JSON.stringify(await fields(R.selected)));
    check(same(await fields(P.global), ["body: post global"]), JSON.stringify(await fields(P.global)));
  });

  // --- Shared posts in chats --------------------------------------------------------------------------------------
  const card = (id, kind = "post", type = "post") => JSON.stringify({ target_type: type, target_id: id, kind, path: `${type === "post" ? "/posts/" : "/apartments/"}${id}`, title: null, caption: "look", image_url: null, author: { id: ANN, name: "Ann Author", avatar_url: null } });
  const share = (who, conv, json) => as(who, () => db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1, $2, '', $3::jsonb)", [conv, who, json]));
  const dm = async (a, b) => (await as(a, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [b])))).id;
  const group = async (members) => (await as(ANN, () => one(db.query("select public.create_group_conversation('Study group', $1::uuid[]) as id", [members])))).id;
  const SHARE_REFUSAL = "Some people in this chat can't see this post.";
  for (const [name, who, sees] of VIEWERS.filter(([, who]) => who && who !== ANN)) {
    await expectOk(t(`share: Ann may send ${name} her posts for ${sees.join(", ")} only`), async () => {
      const conv = await dm(ANN, who);
      const got = await tryAll((id) => share(ANN, conv, card(id, NAMES[id].startsWith("reel") ? "reel" : "post")), SHARE_REFUSAL);
      check(same(got, expected(sees)), JSON.stringify(got));
    });
  }
  await expectRefused(t("share: the refusal is 42501 'Some people in this chat can't see this post.'"), async () => share(ANN, await dm(ANN, OTHER), card(P.friends)), SHARE_REFUSAL);
  await expectRefused(t("share: a campus post cannot go to someone at Ann's campus whose email is not confirmed"), async () => share(ANN, await dm(ANN, UNC), card(P.campus)), SHARE_REFUSAL);
  await expectOk(t("share: a group at Ann's campus may get her campus post; one with someone from another campus may not (a Global post goes to both)"), async () => {
    const home = await group([CAMPUS, CAMPUS2]);
    await share(ANN, home, card(P.campus));
    const mixed = await group([CAMPUS, OTHER]);
    const o = await outcome(() => share(ANN, mixed, card(P.campus)));
    check(o.includes(SHARE_REFUSAL), o);
    await share(ANN, mixed, card(P.global));
  });
  await expectOk(t("share: only the others in the chat count (Fay sends Ann's friends-only post back to Ann)"), async () => share(FRI, await dm(FRI, ANN), card(P.friends)));
  await expectOk(t("share: listings, a post that is gone and plain messages are unaffected"), async () => {
    const conv = await dm(ANN, OTHER);
    await share(ANN, conv, card("00000000-0000-4000-8000-0000000000aa", "listing", "apartment"));
    await share(ANN, conv, card("00000000-0000-4000-8000-0000000000bb"));
    await as(ANN, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'hi')", [conv, ANN]));
  });
  await expectError(t("share: a malformed card still meets migration 17's check, not this guard"), async () => share(ANN, await dm(ANN, OTHER), JSON.stringify({ target_type: "post", target_id: "not-a-uuid", path: "/posts/not-a-uuid" })), "messages_shared_post_check");

  // --- Staff ------------------------------------------------------------------------------------------------------
  const STAFF_TABLE = (await one(db.query("select to_regclass('public.staff') is not null as ok"))).ok ? "staff" : "staff_members";
  const MOD = await person("mo@utexas.edu", "Mo Derator");
  await db.query(`insert into public.${STAFF_TABLE} (user_id, role) values ($1, 'moderator')`, [MOD]);
  await expectOk(t(`staff (${STAFF_TABLE}): being a moderator opens nobody's narrower posts in the ordinary feeds`), async () => {
    check(same(await bodies(MOD), both(["global"])), JSON.stringify(await bodies(MOD)));
  });
  await expectOk(t("staff: a friend reports a friends-only post; the moderator's console shows it"), async () => {
    await as(FRI, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')", [FRI, P.friends]));
    const q = (await one(db.query("select id from public.mod_queue where entity_type = 'post' and entity_id = $1", [P.friends]))).id;
    const item = await as(MOD, () => one(db.query("select public.console_queue_item($1) as r", [q])), { aal: "aal2" });
    check(JSON.stringify(item.r).includes("post friends"), JSON.stringify(item.r).slice(0, 400));
  });
  if (live) {
    await expectOk(t("staff: CampConnect Admin's admin_content_get() shows a selected post too"), async () => {
      const r = await as(MOD, () => one(db.query("select public.admin_content_get('post', $1) as r", [P.selected])), { aal: "aal2" });
      check(r.r.body === "post selected", JSON.stringify(r.r));
    });
  }

  // --- Rollback ---------------------------------------------------------------------------------------------------
  const rollbackMessage = () => outcome(() => db.exec(read(ROLLBACK)));
  await expectError(t("rollback: refuses while posts have details"), () => db.exec(read(ROLLBACK)), "posts with a title, link, audience or comment setting exist");
  await expectOk(t("rollback: refuses for a comments switch alone, and for a list of chosen viewers alone"), async () => {
    await db.query("delete from public.feed_posts where title is not null or link_url is not null or audience <> 'global' or comments_off");
    const lone = await post(ANN, { body: "quiet", comments_off: true });
    let msg = await rollbackMessage();
    check(msg.includes("clear them before rolling back migration 44"), msg);
    await db.query("update public.feed_posts set comments_off = false where id = $1", [lone.id]);
    await setViewers(ANN, lone.id, [PICK]);
    msg = await rollbackMessage();
    check(msg.includes("clear feed_post_viewers before rolling back migration 44"), msg);
    await setViewers(ANN, lone.id, []);
  });
  await expectOk(t("rollback: with no details left it runs, and the schema is exactly as before 44"), async () => {
    await db.exec(read(ROLLBACK));
    const after = await fingerprint(db);
    check(same(after, before), diff(before, after));
  });
  await expectOk(t("rollback: runs again on a database without 44 and changes nothing"), async () => {
    await db.exec(read(ROLLBACK));
    const after = await fingerprint(db);
    check(same(after, before), diff(before, after));
  });
  await expectOk(t("rollback: the posts are all still there, and the migration applies again after it"), async () => {
    const n = (await one(db.query("select count(*)::int as n from public.feed_posts where author_id = $1", [ANN]))).n;
    check(n > 0, "posts gone");
    await db.exec(read(MIGRATION));
    const p = await post(ANN, { body: "again", audience: "friends" });
    check(!(await run(OTHER, () => db.query("select 1 from public.feed_posts where id = $1", [p.id]))).rows.length, "someone outside sees a friends-only post");
    check((await run(FRI, () => db.query("select 1 from public.feed_posts where id = $1", [p.id]))).rows.length === 1, "the friend does not");
  });
}

await suite("repo only", false);
await suite("live schema", true);
done("MIGRATION-44 POST DETAILS");
