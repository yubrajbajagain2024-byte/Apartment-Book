// Migration 21 (private follower lists) against PGlite: follows rows only for the two people in them, the same
// follow_stats numbers for every viewer, mutual friends, are_friends closed to the API, and everything built on
// follows still working.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const MIGRATION = "migrations/20261010000000_private_follow_lists.sql";
const { db, mk, as, asAnon } = await boot();
await expectOk("the private-follow-lists migration re-runs cleanly", async () => { await db.exec(read(MIGRATION)); });

const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const names = {};
const user = async (name, email) => { const id = await mk(email, name); names[id] = name; return id; };
// Vera opens Omar's profile; Wes is someone else. Two people are called Ann, so the order by name falls back to the id.
const V = await user("Vera", "vera@txstate.edu"), O = await user("Omar", "omar@txstate.edu"), W = await user("Wes", "wes@txstate.edu");
const CAT = await user("Cat", "cat@txstate.edu"), ANN = await user("Ann", "ann@txstate.edu"), BEN = await user("Ben", "ben@txstate.edu"), ANN2 = await user("Ann", "ann2@txstate.edu");
const HAL = await user("Hal", "hal@txstate.edu"), IVY = await user("Ivy", "ivy@txstate.edu");
const DAN = await user("Dan", "dan@txstate.edu"), EVE = await user("Eve", "eve@txstate.edu"), FAY = await user("Fay", "fay@txstate.edu"), GUS = await user("Gus", "gus@txstate.edu");
const EVERYONE = Object.keys(names);

const follow = (from, to) => as(from, () => db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [from, to]));
const befriend = async (a, b) => { await follow(a, b); await follow(b, a); };
const block = (blocker, blocked) => as(blocker, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [blocker, blocked]));
const unblock = (blocker, blocked) => as(blocker, () => db.query("delete from public.blocks where blocker_id=$1 and blocked_id=$2", [blocker, blocked]));
// A row an admin left behind between two people blocked either way: written as the table owner, past the policies.
const leftBehind = (from, to) => db.query("insert into public.follows (follower_id, followee_id) values ($1,$2) on conflict do nothing", [from, to]);
const pair = "(follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)";
const viewer = (uid, fn) => (uid ? as(uid, fn) : asAnon(fn));
const followRows = (uid, where = "true", params = []) => viewer(uid, () => rows(db.query(`select follower_id, followee_id from public.follows where ${where}`, params)));
const stats = async (uid, ids) => (await viewer(uid, () => rows(db.query("select * from public.follow_stats($1::uuid[])", [ids])))).sort((a, b) => (a.user_id < b.user_id ? -1 : 1));
const statsOf = async (uid, id) => (await stats(uid, [id]))[0];
const mutual = async (uid, owner) => (await viewer(uid, () => rows(db.query("select id from public.mutual_friends($1)", [owner])))).map((r) => r.id);
const byName = (ids) => [...ids].sort((a, b) => (names[a] !== names[b] ? (names[a] < names[b] ? -1 : 1) : a < b ? -1 : 1));
const list = (ids) => ids.map((id) => names[id] ?? id).join(", ");

// Vera and Omar are friends, and six people are friends with both of them. Dan, Eve, Fay and Gus are each friends with
// one of the two and follow (or are followed by) the other one way only. Wes shares only Ben with Omar, and follows Omar.
await befriend(V, O);
for (const f of [CAT, ANN, BEN, ANN2, HAL, IVY]) { await befriend(V, f); await befriend(O, f); }
await befriend(V, DAN); await follow(O, DAN);
await befriend(V, EVE); await follow(EVE, O);
await befriend(O, FAY); await follow(V, FAY);
await befriend(O, GUS); await follow(GUS, V);
await befriend(W, BEN); await follow(W, O);
const MUTUAL = byName([ANN, ANN2, BEN, CAT, HAL, IVY]);

// --- rows ----------------------------------------------------------------------------------------------------------
await expectOk("rows: signed out reads none; Wes reads only his own, so Omar's followers show him alone; a join through profiles (an API embed) finds no more", async () => {
  if ((await followRows(null)).length !== 0) throw new Error("signed out read follows");
  const mine = await followRows(W);
  if (mine.length !== 3 || mine.some((r) => r.follower_id !== W && r.followee_id !== W)) throw new Error("Wes read: " + JSON.stringify(mine));
  const omars = await followRows(W, "followee_id = $1", [O]);
  if (omars.length !== 1 || omars[0].follower_id !== W) throw new Error("Omar's followers as Wes: " + JSON.stringify(omars));
  const embed = "select (select count(*)::int from public.follows f where f.followee_id = p.id) as followers, (select count(*)::int from public.follows f where f.follower_id = p.id) as following from public.profiles p where p.id = $1";
  const w = await as(W, () => one(db.query(embed, [O]))), anon = await asAnon(() => one(db.query(embed, [O])));
  if (w.followers !== 1 || w.following !== 0 || anon.followers !== 0 || anon.following !== 0) throw new Error(`embed: Wes ${JSON.stringify(w)}, signed out ${JSON.stringify(anon)}`);
});
await expectOk("rows: the follower and the person followed each read their own row (Eve → Omar); Vera, a friend of both, does not", async () => {
  const where = "follower_id = $1 and followee_id = $2";
  if ((await followRows(EVE, where, [EVE, O])).length !== 1) throw new Error("Eve cannot read her own follow");
  if ((await followRows(O, where, [EVE, O])).length !== 1) throw new Error("Omar cannot read who follows him");
  if ((await followRows(V, where, [EVE, O])).length !== 0) throw new Error("Vera read someone else's follow");
});
await expectOk("rows: the owner reads every one of their followers and everyone they follow", async () => {
  const all = (await rows(db.query("select count(*) filter (where followee_id = $1)::int as followers, count(*) filter (where follower_id = $1)::int as following from public.follows", [O])))[0];
  const followers = await followRows(O, "followee_id = $1", [O]), following = await followRows(O, "follower_id = $1", [O]);
  if (all.followers !== 11 || all.following !== 10) throw new Error("the setup changed: " + JSON.stringify(all));
  if (followers.length !== all.followers || following.length !== all.following) throw new Error(`Omar reads ${followers.length} followers and ${following.length} following`);
});

// --- counts --------------------------------------------------------------------------------------------------------
await expectOk("counts: Omar shows 11 followers and 10 following to himself, Vera, Wes and signed out; the flags are each viewer's own", async () => {
  for (const [who, uid, byMe, me] of [["Omar", O, false, false], ["Vera", V, true, true], ["Wes", W, true, false], ["signed out", null, false, false]]) {
    const s = await statsOf(uid, O);
    if (s.followers !== 11 || s.following !== 10 || s.followed_by_me !== byMe || s.follows_me !== me) throw new Error(`${who}: ${JSON.stringify(s)}`);
  }
});
await expectOk("counts: blocking someone leaves every number you see as it was (a drop would tell you whom they follow); a profile you are blocked with shows zeros", async () => {
  await block(W, CAT); // nothing between Wes and Cat to remove, so Cat's follows of Omar stay, and still count for Wes
  let s = await statsOf(W, O); if (s.followers !== 11 || s.following !== 10) throw new Error("Wes, having blocked Cat: " + JSON.stringify(s));
  s = await statsOf(CAT, O); if (s.followers !== 11 || s.following !== 10) throw new Error("Cat, blocked by Wes: " + JSON.stringify(s));
  s = await statsOf(V, O); if (s.followers !== 11 || s.following !== 10) throw new Error("Vera: " + JSON.stringify(s));
  await unblock(W, CAT);
  await block(O, W); // also ends Wes → Omar
  s = await statsOf(W, O); if (s.followers !== 0 || s.following !== 0 || s.followed_by_me || s.follows_me) throw new Error("Wes, blocked by Omar: " + JSON.stringify(s));
  s = await statsOf(O, W); if (s.followers !== 0 || s.following !== 0) throw new Error("Omar looking at Wes: " + JSON.stringify(s));
  s = await statsOf(V, W); if (s.followers !== 1 || s.following !== 1) throw new Error("Vera looking at Wes: " + JSON.stringify(s));
  await unblock(O, W);
  await follow(W, O);
  s = await statsOf(null, O); if (s.followers !== 11) throw new Error("after following again: " + JSON.stringify(s));
});
await expectOk("counts: every viewer gets the real totals whoever they have blocked, zeros only for a profile they are blocked with, and the old numbers wherever no block is involved", async () => {
  await block(W, CAT);
  await block(GUS, V); // ends Gus → Vera; Gus's follows with Omar stay
  await leftBehind(GUS, V); // and back as a row left behind, which counts like any other
  const viewers = [null, O, V, W, CAT, GUS, EVE];
  const blockedWith = new Set([`${W}|${CAT}`, `${CAT}|${W}`, `${GUS}|${V}`, `${V}|${GUS}`]);
  // The real totals, read as the table owner past the policies.
  const totals = Object.fromEntries((await rows(db.query(
    "select p.id, (select count(*)::int from public.follows f where f.followee_id = p.id) as followers, (select count(*)::int from public.follows f where f.follower_id = p.id) as following from public.profiles p where p.id = any($1::uuid[])",
    [EVERYONE],
  ))).map((r) => [r.id, r]));
  for (const uid of viewers) for (const r of await stats(uid, EVERYONE)) {
    const want = uid && blockedWith.has(`${uid}|${r.user_id}`) ? { followers: 0, following: 0 } : totals[r.user_id];
    if (Number(r.followers) !== want.followers || Number(r.following) !== want.following) throw new Error(`${names[uid] ?? "signed out"} looking at ${names[r.user_id]}: ${JSON.stringify(r)}; expected ${JSON.stringify(want)}`);
  }
  // Viewers with no block in play get exactly what migration 14's public rows and security-invoker follow_stats gave.
  const unblocked = [null, O, EVE];
  const snapshot = async () => { const out = []; for (const uid of unblocked) out.push(...(await stats(uid, EVERYONE)).map((r) => ({ viewer: names[uid] ?? "signed out", ...r }))); return out; };
  const now = await snapshot();
  await db.exec(read("migrations/20260923000000_follows.sql"));
  const before = await snapshot();
  await db.exec(read(MIGRATION));
  const diff = now.findIndex((r, i) => JSON.stringify(r) !== JSON.stringify(before[i]));
  if (now.length !== before.length || diff !== -1) throw new Error(`now ${JSON.stringify(now[diff])}, before ${JSON.stringify(before[diff])}`);
  if ((await followRows(null)).length !== 0) throw new Error("migration 21 did not go back on top");
  await unblock(W, CAT); await unblock(GUS, V);
});

// --- mutual friends ------------------------------------------------------------------------------------------------
await expectOk("mutual friends: exactly the friends Vera and Omar both have, by name then id; never the two of them, nobody followed or following one way", async () => {
  const got = await mutual(V, O);
  if (got.join() !== MUTUAL.join()) throw new Error(`got ${list(got)}; expected ${list(MUTUAL)}`);
  if (MUTUAL[0] !== [ANN, ANN2].sort()[0]) throw new Error("the two Anns are not in id order");
});
await expectOk("mutual friends: the same people from Omar's side; Wes shares only Ben with Omar", async () => {
  const back = await mutual(O, V); if (back.join() !== MUTUAL.join()) throw new Error("Omar looking at Vera: " + list(back));
  const wes = await mutual(W, O); if (wes.join() !== BEN) throw new Error("Wes looking at Omar: " + list(wes));
});
await expectOk("mutual friends: the id helper behind it answers with the same people and no one else; whole profiles, paged by name like the API asks", async () => {
  const ids = (await as(W, () => rows(db.query("select * from public.mutual_friend_ids($1)", [O])))).map((r) => Object.values(r)[0]);
  if (ids.join() !== BEN) throw new Error("helper as Wes: " + list(ids));
  if ((await asAnon(() => rows(db.query("select * from public.mutual_friend_ids($1)", [O])))).length !== 0) throw new Error("helper signed out");
  const page = await as(V, () => rows(db.query(
    "select m.id, m.full_name, m.username, u.email_domain from public.mutual_friends($1) m left join public.universities u on u.id = m.university_id order by m.full_name, m.id limit 2 offset 2",
    [O],
  )));
  if (page.map((r) => r.id).join() !== MUTUAL.slice(2, 4).join()) throw new Error("page 2: " + list(page.map((r) => r.id)));
  if (!page.every((r) => r.username && r.email_domain === "txstate.edu")) throw new Error("rows: " + JSON.stringify(page));
});
await expectOk("mutual friends: nothing signed out, on your own profile, or between the viewer and the owner blocked either way", async () => {
  if ((await mutual(null, O)).length !== 0) throw new Error("signed out");
  if ((await mutual(O, O)).length !== 0) throw new Error("own profile");
  for (const [blocker, blocked] of [[V, O], [O, V]]) {
    await block(blocker, blocked);
    if ((await mutual(V, O)).length !== 0 || (await mutual(O, V)).length !== 0) throw new Error(`${names[blocker]} blocked ${names[blocked]}`);
    await unblock(blocker, blocked);
  }
  // The blocks ended Vera and Omar's own follows; the friends they share never depended on them.
  if ((await mutual(V, O)).join() !== MUTUAL.join()) throw new Error("after unblocking: " + list(await mutual(V, O)));
  await befriend(V, O);
});
await expectOk("mutual friends: someone blocked either way with the viewer never shows, even with follows left behind, which neither of the two reads", async () => {
  await block(V, HAL);
  await block(IVY, V);
  let got = await mutual(V, O); if (got.includes(HAL) || got.includes(IVY)) throw new Error("after the blocks: " + list(got));
  for (const [a, b] of [[V, HAL], [HAL, V], [V, IVY], [IVY, V]]) await leftBehind(a, b);
  got = await mutual(V, O); if (got.includes(HAL) || got.includes(IVY)) throw new Error("rows left behind: " + list(got));
  for (const uid of [V, HAL]) if ((await followRows(uid, pair, [V, HAL])).length !== 0) throw new Error(`${names[uid]} reads the rows left behind`);
  const s = await statsOf(V, HAL); if (s.followers !== 0 || s.followed_by_me || s.follows_me) throw new Error("Vera looking at Hal: " + JSON.stringify(s));
  const others = await mutual(O, V); if (!others.includes(HAL) || !others.includes(IVY)) throw new Error("Omar's side should be unaffected: " + list(others));
  await unblock(V, HAL); await unblock(IVY, V);
  got = await mutual(V, O); if (got.join() !== MUTUAL.join()) throw new Error("after unblocking: " + list(got));
});

// --- are_friends ---------------------------------------------------------------------------------------------------
await expectError("are_friends: the API can no longer ask whether two people are friends (signed in)", () => as(W, () => db.query("select public.are_friends($1,$2)", [V, ANN])), "permission denied");
await expectError("are_friends: nor signed out", () => asAnon(() => db.query("select public.are_friends($1,$2)", [V, ANN])), "permission denied");
await expectOk("are_friends: inside the database it only answers about the person asking", async () => {
  // As the functions' owner, the way can_view_profile_section calls it, with someone's session.
  const asked = async (uid, a, b) => {
    await db.query("select set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid }) : ""]);
    try { return (await one(db.query("select public.are_friends($1,$2) as f", [a, b]))).f; } finally { await db.query("select set_config('request.jwt.claims', '', false)"); }
  };
  if ((await asked(V, V, ANN)) !== true || (await asked(ANN, V, ANN)) !== true) throw new Error("Vera and Ann cannot see their own friendship");
  if ((await asked(W, V, ANN)) !== false) throw new Error("Wes learned whether Vera and Ann are friends");
  if ((await asked(null, V, ANN)) !== false) throw new Error("answered without a session");
  if ((await asked(V, V, FAY)) !== false) throw new Error("a one-way follow counted");
});
await expectOk("are_friends: the API can still call follow_stats, mutual_friends and its helper (signed in or out), and only that helper reads follows as the definer", async () => {
  const can = async (role, fn) => (await one(db.query("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))).ok;
  for (const role of ["anon", "authenticated"]) {
    for (const fn of ["public.follow_stats(uuid[])", "public.mutual_friends(uuid)", "public.mutual_friend_ids(uuid)"]) if (!(await can(role, fn))) throw new Error(`${role} cannot call ${fn}`);
    if (await can(role, "public.are_friends(uuid,uuid)")) throw new Error(`${role} can call are_friends`);
  }
  const definer = Object.fromEntries((await rows(db.query("select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('mutual_friends', 'mutual_friend_ids')"))).map((r) => [r.proname, r.prosecdef]));
  if (definer.mutual_friends !== false || definer.mutual_friend_ids !== true) throw new Error(JSON.stringify(definer));
});
await expectOk("friends-only sections still open to friends: Ann's classes show to Vera, not to Wes or signed out", async () => {
  await as(ANN, () => db.query("insert into public.profile_classes (user_id, term, code) values ($1, 'Fall 2026', 'CS 3358')", [ANN]));
  const sel = "select code from public.profile_classes where user_id = $1";
  if ((await as(V, () => rows(db.query(sel, [ANN])))).length !== 1) throw new Error("a friend cannot see friends-only classes");
  if ((await as(W, () => rows(db.query(sel, [ANN])))).length !== 0) throw new Error("a stranger sees friends-only classes");
  if ((await asAnon(() => rows(db.query(sel, [ANN])))).length !== 0) throw new Error("signed out sees friends-only classes");
  const access = async (uid) => (await viewer(uid, () => one(db.query("select * from public.profile_section_access($1)", [ANN])))).classes;
  if ((await access(V)) !== true || (await access(W)) !== false || (await access(ANN)) !== true) throw new Error("profile_section_access");
});

// --- everything built on follows -------------------------------------------------------------------------------------
await expectOk("list_friends: still the people who follow you back, by name", async () => {
  const got = (await as(BEN, () => rows(db.query("select full_name from public.list_friends()")))).map((r) => r.full_name).join();
  if (got !== "Omar,Vera,Wes") throw new Error("Ben's friends: " + got);
});
await expectOk("following_posts: still the posts of the people you follow, and only theirs", async () => {
  await as(BEN, () => db.query("insert into public.feed_posts (author_id, body) values ($1, 'Ben here')", [BEN]));
  for (const [uid, sees] of [[W, true], [V, true], [FAY, false]]) {
    const got = (await as(uid, () => rows(db.query("select body from public.following_posts()")))).some((r) => r.body === "Ben here");
    if (got !== sees) throw new Error(`${names[uid]} ${sees ? "misses" : "gets"} Ben's post`);
  }
});
await expectOk("follow and unfollow: Wes follows Cat, the two of them see it and nobody else; Cat is notified; unfollowing removes it", async () => {
  await follow(W, CAT);
  const where = "follower_id = $1 and followee_id = $2";
  if ((await followRows(W, where, [W, CAT])).length !== 1 || (await followRows(CAT, where, [W, CAT])).length !== 1) throw new Error("a participant cannot see the new follow");
  if ((await followRows(V, where, [W, CAT])).length !== 0) throw new Error("Vera sees it");
  const n = await as(CAT, () => rows(db.query("select title, link from public.notifications where user_id = $1 and type = 'follow' and actor_id = $2", [CAT, W])));
  if (n.length !== 1 || n[0].link !== `/profile/${W}` || !n[0].title.startsWith("Wes")) throw new Error("notification: " + JSON.stringify(n));
  const r = await as(W, () => db.query("delete from public.follows where follower_id = $1 and followee_id = $2", [W, CAT]));
  if (r.affectedRows !== 1 || (await rows(db.query(`select 1 from public.follows where ${where}`, [W, CAT]))).length !== 0) throw new Error("unfollow failed");
});
await expectOk("blocking still ends the follow both ways", async () => {
  await befriend(W, CAT);
  await block(CAT, W);
  if ((await rows(db.query(`select 1 from public.follows where ${pair}`, [W, CAT]))).length !== 0) throw new Error("follows survived the block");
  await unblock(CAT, W);
});

// --- realtime ------------------------------------------------------------------------------------------------------
await expectOk("realtime: follows is taken back out of the publication if someone added it; notifications stay in", async () => {
  await db.exec("alter publication supabase_realtime add table public.follows");
  await db.exec(read(MIGRATION));
  const tables = (await rows(db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'"))).map((r) => r.tablename);
  if (tables.includes("follows") || !tables.includes("notifications")) throw new Error(tables.join());
});
done("MIGRATION-21 PRIVATE FOLLOW LISTS");
