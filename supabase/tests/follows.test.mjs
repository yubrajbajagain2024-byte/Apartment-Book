// Migration 14 (follows) against PGlite: policies, counts, the Following feed, notifications, blocking and deletion.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the follows migration re-runs cleanly", async () => { await db.exec(read("migrations/20260923000000_follows.sql")); });
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
const one = async (p) => (await p).rows[0];
const follow = (who, whom) => as(who, () => db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [who, whom]));
const stats = (viewer, id) => (viewer ? as(viewer, () => one(db.query("select * from public.follow_stats(array[$1]::uuid[])", [id]))) : asAnon(() => one(db.query("select * from public.follow_stats(array[$1]::uuid[])", [id]))));

await expectOk("follow: A follows B; everyone (even signed out) can see it; counts and the relationship flags are right from every side", async () => {
  await follow(A, B);
  if ((await asAnon(() => db.query("select 1 from public.follows where follower_id=$1 and followee_id=$2", [A, B]))).rows.length !== 1) throw new Error("anon cannot see the follow");
  const b = await stats(A, B); if (Number(b.followers) !== 1 || Number(b.following) !== 0 || b.followed_by_me !== true || b.follows_me !== false) throw new Error("B as seen by A: " + JSON.stringify(b));
  const a = await stats(B, A); if (Number(a.followers) !== 0 || Number(a.following) !== 1 || a.followed_by_me !== false || a.follows_me !== true) throw new Error("A as seen by B: " + JSON.stringify(a));
  const anon = await stats(null, B); if (Number(anon.followers) !== 1 || anon.followed_by_me !== false) throw new Error("anon view: " + JSON.stringify(anon));
  const many = (await as(C, () => db.query("select user_id from public.follow_stats(array[$1,$2]::uuid[])", [A, B]))).rows; if (many.length !== 2) throw new Error("follow_stats should answer for every id");
});
await expectError("follow: you cannot follow yourself", () => follow(A, A), "follows_not_self");
await expectError("follow: following twice is a duplicate, not a second row", () => follow(A, B), "duplicate key");
await expectError("follow: you cannot follow on someone else's behalf", () => as(C, () => db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [A, C])), "row-level security");
await expectOk("follow: you cannot remove someone else's follow", async () => {
  const r = await as(C, () => db.query("delete from public.follows where follower_id=$1 and followee_id=$2", [A, B]));
  if (r.affectedRows !== 0) throw new Error("deleted " + r.affectedRows);
  if ((await asAnon(() => db.query("select 1 from public.follows where follower_id=$1", [A]))).rows.length !== 1) throw new Error("follow gone");
});
await expectOk("notification: B gets one 'follow' notification linking to A's profile; follow / unfollow / follow keeps it to one unread row", async () => {
  const n = (await as(B, () => db.query("select type, actor_id, link, title from public.notifications where user_id=$1", [B]))).rows;
  if (n.length !== 1 || n[0].type !== "follow" || n[0].actor_id !== A || n[0].link !== `/profile/${A}` || !n[0].title.startsWith("Alice")) throw new Error(JSON.stringify(n));
  await as(A, () => db.query("delete from public.follows where follower_id=$1 and followee_id=$2", [A, B]));
  await follow(A, B);
  const again = (await as(B, () => db.query("select count(*)::int n from public.notifications where user_id=$1 and type='follow'", [B]))).rows[0].n;
  if (again !== 1) throw new Error("notifications after re-follow: " + again);
  if ((await as(A, () => db.query("select 1 from public.notifications where user_id=$1", [A]))).rows.length !== 0) throw new Error("the follower was notified about their own follow");
});
await expectOk("following_posts: A sees B's posts and reels, not C's; a non-follower and a signed-out visitor see nothing", async () => {
  const VIDEO = JSON.stringify([{ media_id: "11111111-1111-1111-1111-111111111111", playback_id: "pb1abcdef", poster_url: null, width: 720, height: 1280, duration_seconds: 12 }]);
  await as(B, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'hello from Bob')", [B]));
  await as(B, () => db.query("insert into public.feed_posts (author_id, kind, body, videos) values ($1,'reel','Bob reel',$2::jsonb)", [B, VIDEO]));
  await as(C, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'hello from Carol')", [C]));
  const posts = (await as(A, () => db.query("select body from public.following_posts()"))).rows.map((r) => r.body);
  if (JSON.stringify(posts) !== JSON.stringify(["hello from Bob"])) throw new Error("posts: " + JSON.stringify(posts));
  const reels = (await as(A, () => db.query("select body from public.following_posts(p_kind => 'reel')"))).rows.map((r) => r.body);
  if (JSON.stringify(reels) !== JSON.stringify(["Bob reel"])) throw new Error("reels: " + JSON.stringify(reels));
  if ((await as(C, () => db.query("select 1 from public.following_posts()"))).rows.length !== 0) throw new Error("C follows nobody but got rows");
  if ((await asAnon(() => db.query("select 1 from public.following_posts()"))).rows.length !== 0) throw new Error("anon got rows");
});
await expectOk("blocking: B blocks A -> the follow is gone both ways, A cannot follow B again and neither sees the other's follows; unblocking allows it again", async () => {
  await follow(B, A);
  await as(B, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [B, A]));
  if ((await db.query("select 1 from public.follows where (follower_id=$1 and followee_id=$2) or (follower_id=$2 and followee_id=$1)", [A, B])).rows.length !== 0) throw new Error("follows survived the block");
  let threw = false; try { await follow(A, B); } catch { threw = true; }
  if (!threw) throw new Error("A could follow B while blocked");
  await follow(C, B);
  if ((await as(A, () => db.query("select 1 from public.follows where followee_id=$1", [B]))).rows.length !== 0) throw new Error("A can still see B's followers while blocked");
  const hidden = await stats(A, B); if (Number(hidden.followers) !== 0) throw new Error("blocked viewer sees counts: " + JSON.stringify(hidden));
  await as(B, () => db.query("delete from public.blocks where blocker_id=$1 and blocked_id=$2", [B, A]));
  await follow(A, B);
  if (Number((await stats(C, B)).followers) !== 2) throw new Error("expected A and C to follow B");
});
await expectOk("deleting an account removes its follows in both directions", async () => {
  await db.query("delete from auth.users where id=$1", [A]);
  if ((await db.query("select 1 from public.follows where follower_id=$1 or followee_id=$1", [A])).rows.length !== 0) throw new Error("follows left behind");
  if (Number((await stats(C, B)).followers) !== 1) throw new Error("B should have one follower left");
});
done("MIGRATION-14 FOLLOWS");
