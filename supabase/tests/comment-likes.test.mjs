// Migration 16 (hearts on comments) against PGlite: likes count only the likes, dislikes stay private, the numbers belong to the server.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the comment-likes migration re-runs cleanly", async () => { await db.exec(read("migrations/20260925000000_comment_likes.sql")); });
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
const one = async (p) => (await p).rows[0];
const post = (await as(A, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'Hearts test') returning id", [A])))).id;
const vote = (uid, id, value) => as(uid, () => one(db.query("select * from public.post_comment_vote($1,$2)", [id, value])));
const stored = (id) => one(db.query("select likes, score from public.post_comments where id=$1", [id]));
const check = (what, v, likes, score, mine) => { if (Number(v.likes) !== likes || Number(v.score) !== score || (mine !== undefined && Number(v.my_vote) !== mine)) throw new Error(`${what}: ${JSON.stringify(v)}`); };

let top;
await expectOk("hearts: likes count the people who liked; a dislike moves the score but never the hearts", async () => {
  top = (await as(B, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'Nice place!') returning id", [post, B])))).id;
  check("A likes", await vote(A, top, 1), 1, 1, 1);
  check("C dislikes", await vote(C, top, -1), 1, 0, -1);
  check("C flips to a like", await vote(C, top, 1), 2, 2, 1);
  check("A clears", await vote(A, top, 0), 1, 1, 0);
  check("stored", await stored(top), 1, 1);
});
await expectOk("hearts: a forged count on insert lands as 0, and a direct update leaves the numbers alone", async () => {
  const forged = await as(B, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body, likes, score) values ('post',$1,$2,'I have 50 hearts', 50, 50) returning likes, score", [post, B])));
  check("forged insert", forged, 0, 0);
  await db.query("update public.post_comments set likes = 99, score = 99 where id=$1", [top]);
  check("after a direct update", await stored(top), 1, 1);
});
await expectOk("hearts: when a liker's account goes, their heart goes with it", async () => {
  await db.query("delete from auth.users where id=$1", [C]);
  check("after Carol left", await stored(top), 0, 0);
});
await expectError("hearts: signed out, nobody can vote", () => asAnon(() => one(db.query("select * from public.post_comment_vote($1,1)", [top]))), "Not authenticated");
done("MIGRATION-16 COMMENT LIKES");
