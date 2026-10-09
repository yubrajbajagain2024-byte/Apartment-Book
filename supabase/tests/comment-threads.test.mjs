// Migration 15 (comment threads with votes) against PGlite: replies, votes, score sync, notifications, deletion, blocking.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the comment-threads migration re-runs cleanly", async () => { await db.exec(read("migrations/20260924000000_comment_threads.sql")); });
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
const one = async (p) => (await p).rows[0];
const post = (await as(A, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'Thread test') returning id", [A])))).id;
const post2 = (await as(A, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'Other post') returning id", [A])))).id;
const comment = (uid, body, parent = null, target = post) => as(uid, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body, parent_id) values ('post',$1,$2,$3,$4) returning id, parent_id, score", [target, uid, body, parent]))).then((r) => r.id);
const vote = (uid, id, value) => as(uid, () => one(db.query("select * from public.post_comment_vote($1,$2)", [id, value])));

let top, reply;
await expectOk("reply: B comments, C replies to B; the reply carries parent_id and the thread counts both", async () => {
  top = await comment(B, "Nice place!");
  reply = await comment(C, "Agreed", top);
  const r = await one(db.query("select parent_id from public.post_comments where id=$1", [reply])); if (r.parent_id !== top) throw new Error("parent not stored");
  const e = await as(A, () => one(db.query("select comments from public.post_engagement('post', $1)", [post]))); if (Number(e.comments) !== 2) throw new Error("engagement counts " + e.comments);
});
await expectError("reply: a reply cannot sit on a different post than its parent", () => comment(C, "wrong post", top, post2), "same post");
await expectError("reply: a reply cannot point at a comment that does not exist", () => comment(C, "orphan", "00000000-0000-0000-0000-000000000000"), "gone");
await expectOk("votes: up / down / clear through post_comment_vote(); the score follows and my_vote is per person", async () => {
  let v = await vote(A, top, 1); if (Number(v.score) !== 1 || Number(v.my_vote) !== 1) throw new Error("up: " + JSON.stringify(v));
  v = await vote(C, top, 1); if (Number(v.score) !== 2) throw new Error("second up: " + JSON.stringify(v));
  v = await vote(C, top, -1); if (Number(v.score) !== 0 || Number(v.my_vote) !== -1) throw new Error("flip to down: " + JSON.stringify(v));
  v = await vote(C, top, 0); if (Number(v.score) !== 1 || Number(v.my_vote) !== 0) throw new Error("clear: " + JSON.stringify(v));
  const stored = await one(db.query("select score from public.post_comments where id=$1", [top])); if (stored.score !== 1) throw new Error("stored score " + stored.score);
  const mine = (await as(A, () => db.query("select comment_id, value from public.post_comment_votes where user_id=$1", [A]))).rows; if (mine.length !== 1 || mine[0].value !== 1) throw new Error("my votes " + JSON.stringify(mine));
  if ((await asAnon(() => db.query("select 1 from public.post_comment_votes"))).rows.length !== 1) throw new Error("votes should be readable like likes");
});
await expectError("votes: the table cannot be written directly", () => as(B, () => db.query("insert into public.post_comment_votes (comment_id, user_id, value) values ($1,$2,1)", [top, B])), "row-level security");
await expectError("votes: a value other than -1, 0, 1 is refused", () => vote(B, top, 5), "Invalid vote");
await expectError("votes: signed out there is no voting", () => asAnon(() => db.query("select * from public.post_comment_vote($1,1)", [top])), "Not authenticated");
await expectOk("notifications: the comment's author hears about the reply; the post owner is not told twice when they are the same person", async () => {
  const n = (await as(B, () => db.query("select title, data->>'parent_id' as parent from public.notifications where user_id=$1 and type='comment' order by created_at", [B]))).rows;
  if (n.length !== 1 || !n[0].title.includes("replied to your comment") || n[0].parent !== top) throw new Error(JSON.stringify(n));
  // A's own comment answered by C: A is the post owner, so only the owner notification arrives.
  const aTop = await comment(A, "Thanks all");
  await comment(C, "Welcome", aTop);
  const a = (await as(A, () => db.query("select title from public.notifications where user_id=$1 and type='comment' and data->>'comment_id' in (select id::text from public.post_comments where parent_id=$2)", [A, aTop]))).rows;
  if (a.length !== 1 || !a[0].title.includes("commented on your post")) throw new Error("owner+parent author got " + JSON.stringify(a));
});
await expectOk("the score belongs to the server: a forged score on insert becomes 0", async () => {
  const forged = await as(C, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body, score) values ('post',$1,$2,'cheat',50) returning score", [post, C])));
  if (forged.score !== 0) throw new Error("score " + forged.score);
});
await expectOk("blocking: someone you blocked cannot reply to your comment (it is gone for them) and you are not notified", async () => {
  const mine = await comment(A, "Blocked people cannot answer this");
  await as(A, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [A, B]));
  let threw = false; try { await comment(B, "ha", mine); } catch (e) { threw = /gone/.test(e.message); }
  if (!threw) throw new Error("blocked B could reply");
  const n = (await as(A, () => db.query("select 1 from public.notifications where user_id=$1 and type='comment' and data->>'parent_id'=$2", [A, mine]))).rows;
  if (n.length !== 0) throw new Error("the blocker was notified");
  await as(A, () => db.query("delete from public.blocks where blocker_id=$1 and blocked_id=$2", [A, B]));
});
await expectOk("deleting a comment takes its replies and their votes with it; the score of the rest is untouched", async () => {
  await vote(A, reply, 1);
  await as(B, () => db.query("delete from public.post_comments where id=$1", [top]));
  if ((await db.query("select 1 from public.post_comments where id in ($1,$2)", [top, reply])).rows.length !== 0) throw new Error("reply survived");
  if ((await db.query("select 1 from public.post_comment_votes where comment_id in ($1,$2)", [top, reply])).rows.length !== 0) throw new Error("votes survived");
});
await expectOk("blocking: a blocked person cannot vote on your comment, and an account deletion recomputes the score", async () => {
  const mine = await comment(A, "Visible?");
  await vote(B, mine, 1); await vote(C, mine, 1);
  await as(A, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [A, C]));
  let threw = false; try { await vote(C, mine, -1); } catch { threw = true; }
  if (!threw) throw new Error("blocked C could vote");
  await db.query("delete from auth.users where id=$1", [B]);
  const s = await one(db.query("select score from public.post_comments where id=$1", [mine])); if (s.score !== 1) throw new Error("score after B left: " + s.score);
});
done("MIGRATION-15 COMMENT THREADS");
