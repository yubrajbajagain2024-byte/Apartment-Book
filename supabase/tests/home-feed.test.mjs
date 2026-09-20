import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("migration 11 re-runs cleanly", () => db.exec(read("migrations/20260920000000_home_feed.sql")));
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
const VIDEO = JSON.stringify([{ media_id: "00000000-0000-0000-0000-000000000001", playback_id: "pb1", poster_url: null, width: 720, height: 1280, duration_seconds: 12 }]);
const one = async (p) => (await p).rows[0];

// ---- posts and reels -------------------------------------------------------
const post = (await as(A, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'First week on campus!') returning id", [A])))).id;
await expectOk("posts: everyone reads them; likes, comments and saves work with target 'post'; author is notified with a /posts link", async () => {
  if ((await asAnon(() => db.query("select 1 from public.feed_posts"))).rows.length !== 1) throw new Error("anon cannot read");
  await as(B, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [post, B]));
  await as(B, () => db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'welcome!')", [post, B]));
  await as(B, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('post',$1,$2)", [post, B]));
  const e = await as(B, () => one(db.query("select * from public.post_engagement('post', $1)", [post])));
  if (Number(e.likes) !== 1 || Number(e.comments) !== 1 || e.liked_by_me !== true) throw new Error(JSON.stringify(e));
  const n = await as(A, () => db.query("select type, link from public.notifications order by type"));
  if (n.rows.map((r) => r.type).join() !== "comment,like" || n.rows.some((r) => r.link !== `/posts/${post}`)) throw new Error(JSON.stringify(n.rows));
});
await expectError("posts: an empty post is rejected", () => as(A, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'   ')", [A])), "feed_posts_not_empty");
await expectError("reels: need a video", () => as(A, () => db.query("insert into public.feed_posts (author_id, kind, body) values ($1,'reel','no video')", [A])), "feed_posts_reel_has_video");
await expectError("posts: cannot post as someone else", () => as(B, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'fake')", [A])), "row-level security");
await expectOk("reels_feed mixes posted reels with listing video tours, newest first, with counts", async () => {
  await as(A, () => db.query("insert into public.apartments (owner_id, title, description, price_per_month, address, videos) values ($1,'Tour flat','nice',900,'1 St',$2::jsonb)", [A, VIDEO]));
  await db.exec("select pg_sleep(0.02)");
  const reel = (await as(B, () => one(db.query("insert into public.feed_posts (author_id, kind, body, videos) values ($1,'reel','move-in day',$2::jsonb) returning id", [B, VIDEO])))).id;
  await as(A, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [reel, A]));
  const r = await as(A, () => db.query("select source_type, author_name, title, caption, video->>'playback_id' as pb, likes, liked_by_me from public.reels_feed()"));
  if (r.rows.length !== 2 || r.rows[0].source_type !== "post" || r.rows[1].source_type !== "apartment") throw new Error(JSON.stringify(r.rows));
  if (r.rows[0].author_name !== "Bob" || Number(r.rows[0].likes) !== 1 || r.rows[0].liked_by_me !== true || r.rows[0].pb !== "pb1" || r.rows[1].title !== "Tour flat") throw new Error(JSON.stringify(r.rows));
  if ((await asAnon(() => db.query("select 1 from public.reels_feed()"))).rows.length !== 2) throw new Error("anon cannot read reels");
});
await expectOk("posts: blocking hides posts and reels; deleting a post removes its likes, comments and saves", async () => {
  await as(C, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [C, B]));
  if ((await as(C, () => db.query("select 1 from public.reels_feed()"))).rows.length !== 1) throw new Error("blocked reel visible");
  await as(C, () => db.query("delete from public.blocks where blocker_id=$1", [C]));
  await as(A, () => db.query("delete from public.feed_posts where id=$1", [post]));
  const left = await one(db.query("select (select count(*) from public.post_likes where target_id=$1) l, (select count(*) from public.post_comments where target_id=$1) c, (select count(*) from public.saved_listings where target_id=$1) s", [post]));
  if (Number(left.l) + Number(left.c) + Number(left.s) !== 0) throw new Error(JSON.stringify(left));
});

// ---- buzz: anonymity ------------------------------------------------------------
const buzz = (await as(A, () => one(db.query("insert into public.buzz_posts (author_id, topic, title, body) values ($1,'advice','Landlord keeps my deposit?','What can I do') returning id", [A])))).id;
const buzz2 = (await as(A, () => one(db.query("insert into public.buzz_posts (author_id, topic, title) values ($1,'rant','Parking on campus') returning id", [A])))).id;
await expectOk("buzz: other people cannot read the tables directly (no author ids ever leave the database)", async () => {
  for (const t of ["buzz_posts", "buzz_comments", "buzz_votes"]) {
    const rows = (await as(B, () => db.query(`select * from public.${t}`))).rows;
    if (rows.length !== 0) throw new Error(`${t} readable by others`);
  }
  if ((await as(A, () => db.query("select 1 from public.buzz_posts"))).rows.length !== 2) throw new Error("author cannot read own");
});
await expectOk("buzz: signed-out visitors get nothing from the tables either", async () => {
  if ((await asAnon(() => db.query("select * from public.buzz_posts"))).rows.length !== 0) throw new Error("readable by anon");
  if ((await asAnon(() => db.query("select * from public.buzz_comments"))).rows.length !== 0) throw new Error("comments readable by anon");
});
await expectOk("buzz_feed: sanitized rows for everyone (signed out too), is_mine only for the author, no author column", async () => {
  const mine = (await as(A, () => db.query("select * from public.buzz_feed(p_sort => 'new')"))).rows;
  const theirs = (await as(B, () => db.query("select * from public.buzz_feed(p_sort => 'new')"))).rows;
  const anon = (await asAnon(() => db.query("select * from public.buzz_feed()"))).rows;
  if (mine.length !== 2 || theirs.length !== 2 || anon.length !== 2) throw new Error("wrong counts");
  if (!mine.every((r) => r.is_mine) || theirs.some((r) => r.is_mine) || anon.some((r) => r.is_mine)) throw new Error("is_mine wrong");
  for (const r of [...mine, ...theirs, ...anon]) if (Object.keys(r).some((k) => /author|user/.test(k)) || Object.values(r).some((v) => v === A)) throw new Error("author leaked: " + JSON.stringify(r));
  if (!/^Student \d{4}$/.test(theirs[0].alias)) throw new Error("alias " + theirs[0].alias);
  const a1 = theirs.find((r) => r.id === buzz).alias, a2 = theirs.find((r) => r.id === buzz2).alias;
  if (a1 === a2) throw new Error("same alias across threads links them together");
  if ((await as(B, () => db.query("select 1 from public.buzz_feed(p_topic => 'rant')"))).rows.length !== 1) throw new Error("topic filter");
  if ((await as(B, () => db.query("select 1 from public.buzz_feed(p_q => 'deposit')"))).rows.length !== 1) throw new Error("search");
});
await expectError("buzz: the alias function is not callable (it would let anyone test candidate authors)", () => as(B, () => db.query("select public.buzz_alias($1,$2)", [A, buzz])), "permission denied");
await expectError("buzz: the hidden-check is not callable (it would reveal who you muted)", () => as(B, () => db.query("select public.buzz_hidden($1)", [A])), "permission denied");
await expectError("buzz: the salt is unreadable", () => as(B, () => db.query("select * from public.buzz_secrets")), "permission denied");
await expectError("buzz: mutes are unreadable", () => as(B, () => db.query("select * from public.buzz_mutes")), "permission denied");
await expectOk("buzz: video ownership is private (media rows are readable by their owner only)", async () => {
  await as(A, () => db.query("insert into public.media (owner_id, provider, provider_upload_id, status, playback_id) values ($1,'mux','up1','ready','pb-buzz')", [A]));
  if ((await as(B, () => db.query("select * from public.media where playback_id='pb-buzz'"))).rows.length !== 0) throw new Error("media owner readable");
  if ((await as(A, () => db.query("select * from public.media"))).rows.length !== 1) throw new Error("owner cannot read own media");
});
await expectOk("buzz: photos upload to buzz/anon/… only, never into another folder without the user id", async () => {
  await as(B, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads','buzz/anon/1-abc.jpg',$1)", [B]));
  let threw = false; try { await as(B, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads','buzz/other/1.jpg',$1)", [B])); } catch { threw = true; }
  if (!threw) throw new Error("buzz/other accepted");
  const del = await as(C, () => db.query("delete from storage.objects where name='buzz/anon/1-abc.jpg' returning id")); if (del.rows.length) throw new Error("someone else deleted my file");
  const own = await as(B, () => db.query("delete from storage.objects where name='buzz/anon/1-abc.jpg' returning id")); if (!own.rows.length) throw new Error("cannot delete own file");
});
await expectError("buzz: cannot forge a score on insert", () => as(B, () => db.query("insert into public.buzz_posts (author_id, title, score) values ($1,'look at me',999)", [B])), "row-level security");
await expectError("buzz: cannot post as someone else", () => as(B, () => db.query("insert into public.buzz_posts (author_id, title) values ($1,'framed')", [A])), "row-level security");

// ---- buzz: votes, comments, moderation ------------------------------------------
await expectOk("buzz_vote: up, switch to down, clear; one vote per person; others' votes are private", async () => {
  const v = (s) => as(B, () => one(db.query("select * from public.buzz_vote($1,$2)", [buzz, s])));
  let r = await v(1); if (r.score !== 1 || r.my_vote !== 1) throw new Error("up " + JSON.stringify(r));
  r = await v(1); if (r.score !== 1) throw new Error("double up " + JSON.stringify(r));
  r = await v(-1); if (r.score !== -1 || r.my_vote !== -1) throw new Error("down " + JSON.stringify(r));
  r = await v(0); if (r.score !== 0 || r.my_vote !== 0) throw new Error("clear " + JSON.stringify(r));
  await v(1); await as(C, () => db.query("select * from public.buzz_vote($1,1)", [buzz]));
  const f = await as(B, () => one(db.query("select score, my_vote from public.buzz_get($1)", [buzz]))); if (f.score !== 2 || f.my_vote !== 1) throw new Error("get " + JSON.stringify(f));
  if ((await as(B, () => db.query("select * from public.buzz_votes"))).rows.length !== 1) throw new Error("can see other votes");
});
await expectError("buzz_vote: invalid values are rejected", () => as(B, () => db.query("select * from public.buzz_vote($1,5)", [buzz])), "Invalid vote");
await expectError("buzz_vote: signed-out visitors cannot vote", () => asAnon(() => db.query("select * from public.buzz_vote($1,1)", [buzz])), "");
await expectError("buzz: votes cannot be written directly", () => as(B, () => db.query("insert into public.buzz_votes (post_id, user_id, value) values ($1,$2,1)", [buzz2, B])), "row-level security");
let bobComment;
await expectOk("buzz comments: counted, anonymous, OP flagged, same alias as in the feed, author notified without an actor", async () => {
  bobComment = (await as(B, () => one(db.query("insert into public.buzz_comments (post_id, author_id, body) values ($1,$2,'Check your lease, then small claims.') returning id", [buzz, B])))).id;
  await as(A, () => db.query("insert into public.buzz_comments (post_id, author_id, body) values ($1,$2,'Thanks!')", [buzz, A]));
  const list = (await as(C, () => db.query("select * from public.buzz_comments_list($1)", [buzz]))).rows;
  if (list.length !== 2 || list[0].is_op || !list[1].is_op || list.some((c) => c.is_mine)) throw new Error(JSON.stringify(list));
  for (const c of list) if (Object.keys(c).some((k) => /author|user/.test(k)) || Object.values(c).some((v) => v === A || v === B)) throw new Error("author leaked");
  const opAlias = (await as(C, () => one(db.query("select alias from public.buzz_get($1)", [buzz])))).alias;
  if (list[1].alias !== opAlias || list[0].alias === opAlias) throw new Error("aliases inconsistent");
  const g = await as(B, () => one(db.query("select comment_count from public.buzz_get($1)", [buzz]))); if (g.comment_count !== 2) throw new Error("count " + g.comment_count);
  const n = await as(A, () => db.query("select actor_id, title, link from public.notifications where link = $1", [`/buzz/${buzz}`]));
  if (n.rows.length !== 1 || n.rows[0].actor_id !== null) throw new Error("notification " + JSON.stringify(n.rows));
});
await expectOk("buzz_delete_comment: only the writer or the thread author", async () => {
  let threw = false; try { await as(C, () => db.query("select public.buzz_delete_comment($1)", [bobComment])); } catch { threw = true; }
  if (!threw) throw new Error("stranger deleted a comment");
  await as(A, () => db.query("select public.buzz_delete_comment($1)", [bobComment]));
  const g = await as(B, () => one(db.query("select comment_count from public.buzz_get($1)", [buzz]))); if (g.comment_count !== 1) throw new Error("count " + g.comment_count);
});
await expectOk("buzz_mute hides that person's threads and comments for me only; blocking hides them too", async () => {
  await as(B, () => db.query("select public.buzz_mute(p_post_id => $1)", [buzz]));
  if ((await as(B, () => db.query("select 1 from public.buzz_feed()"))).rows.length !== 0) throw new Error("muted author still visible");
  if ((await as(B, () => db.query("select 1 from public.buzz_get($1)", [buzz]))).rows.length !== 0) throw new Error("muted thread still opens");
  if ((await as(C, () => db.query("select 1 from public.buzz_feed()"))).rows.length !== 2) throw new Error("mute affected someone else");
  await as(C, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [C, A]));
  if ((await as(C, () => db.query("select 1 from public.buzz_feed()"))).rows.length !== 0) throw new Error("blocked author still visible");
});
await expectOk("buzz: authors delete their own threads (votes and comments go with them); reports accept buzz targets", async () => {
  await as(B, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1,'buzz',$2,'harassment')", [B, buzz2]));
  await as(A, () => db.query("delete from public.buzz_posts where id=$1", [buzz]));
  const left = await one(db.query("select (select count(*) from public.buzz_votes where post_id=$1) v, (select count(*) from public.buzz_comments where post_id=$1) c", [buzz]));
  if (Number(left.v) + Number(left.c) !== 0) throw new Error(JSON.stringify(left));
  const del = await as(B, () => db.query("delete from public.buzz_posts where id=$1 returning id", [buzz2])); if (del.rows.length) throw new Error("someone else deleted a thread");
});
done("MIGRATION-11");
