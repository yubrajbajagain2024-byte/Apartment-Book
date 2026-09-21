import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("migration 11 re-runs cleanly", () => db.exec(read("migrations/20260920000000_home_feed.sql")));
// Publication jitter off for most checks (it has its own test below).
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
const VIDEO = JSON.stringify([{ media_id: "11111111-1111-1111-1111-111111111111", playback_id: "pb1abcdef", poster_url: null, width: 720, height: 1280, duration_seconds: 12 }]);
const one = async (p) => (await p).rows[0];
const create = (uid, topic, title, extra = {}) => as(uid, () => one(db.query("select public.buzz_create(p_topic => $1, p_title => $2, p_body => $3, p_images => $4::text[], p_image_meta => $5::jsonb, p_videos => $6::jsonb) as id", [topic, title, extra.body ?? "", extra.images ?? [], JSON.stringify(extra.meta ?? []), JSON.stringify(extra.videos ?? [])]))).then((r) => r.id);
const ORIGIN = "https://dskbzoqreandwwpxiplh.supabase.co/storage/v1/object/public/uploads/";
const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const uploadBuzzPhoto = async (uid) => { const name = `buzz/anon/${hex(48)}.jpg`; await as(uid, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads',$1,$2)", [name, uid])); return ORIGIN + name; };
const reply = (uid, post, body, parent = null) => as(uid, () => one(db.query("select public.buzz_reply($1,$2,$3) as id", [post, body, parent]))).then((r) => r.id);

// ---- posts and reels -------------------------------------------------------------
const post = (await as(A, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,'First week on campus!') returning id", [A])))).id;
await expectOk("posts: everyone reads them; likes, comments, saves and views work with target 'post'; author is notified with a /posts link", async () => {
  if ((await asAnon(() => db.query("select 1 from public.feed_posts"))).rows.length !== 1) throw new Error("anon cannot read");
  await as(B, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [post, B]));
  await as(B, () => db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'welcome!')", [post, B]));
  await as(B, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('post',$1,$2)", [post, B]));
  await as(B, () => db.query("select public.record_view('post', $1)", [post]));
  await as(A, () => db.query("select public.record_view('post', $1)", [post]));
  const e = await as(B, () => one(db.query("select * from public.post_engagement('post', $1)", [post])));
  if (Number(e.likes) !== 1 || Number(e.comments) !== 1 || e.liked_by_me !== true) throw new Error(JSON.stringify(e));
  const views = await one(db.query("select count(*)::int n from public.post_views where target_id=$1", [post])); if (views.n !== 1) throw new Error("views " + views.n);
  const n = await as(A, () => db.query("select type, link from public.notifications order by type"));
  if (n.rows.map((r) => r.type).join() !== "comment,like" || n.rows.some((r) => r.link !== `/posts/${post}`)) throw new Error(JSON.stringify(n.rows));
});
await expectError("posts: an empty post is rejected", () => as(A, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'   ')", [A])), "feed_posts_not_empty");
await expectError("reels: need exactly one video", () => as(A, () => db.query("insert into public.feed_posts (author_id, kind, body) values ($1,'reel','no video')", [A])), "feed_posts_reel_has_video");
await expectError("posts: cannot post as someone else", () => as(B, () => db.query("insert into public.feed_posts (author_id, body) values ($1,'fake')", [A])), "row-level security");
await expectOk("posts: the server owns the clock and the identity columns (no future posts, no bumping, no kind flips)", async () => {
  const p = await as(B, () => one(db.query("insert into public.feed_posts (author_id, body, created_at) values ($1,'from the future', now() + interval '5 days') returning id, created_at", [B])));
  if (new Date(p.created_at) > new Date(Date.now() + 60000)) throw new Error("future created_at accepted");
  const before = p.created_at;
  const u = await as(B, () => one(db.query("update public.feed_posts set created_at = now() + interval '1 day', kind = 'reel', videos = $2::jsonb, body = 'edited' where id=$1 returning created_at, kind, body", [p.id, VIDEO])));
  if (+u.created_at !== +before || u.kind !== "post" || u.body !== "edited") throw new Error(JSON.stringify(u));
  await as(B, () => db.query("delete from public.feed_posts where id=$1", [p.id]));
});
await expectOk("reels_feed mixes posted reels with listing video tours, newest first, with counts", async () => {
  await as(A, () => db.query("insert into public.apartments (owner_id, title, description, price_per_month, address, videos) values ($1,'Tour flat','nice',900,'1 St',$2::jsonb)", [A, VIDEO]));
  await db.exec("select pg_sleep(0.02)");
  const reel = (await as(B, () => one(db.query("insert into public.feed_posts (author_id, kind, body, videos) values ($1,'reel','move-in day',$2::jsonb) returning id", [B, VIDEO])))).id;
  await as(A, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [reel, A]));
  const r = await as(A, () => db.query("select source_type, author_name, title, caption, video->>'playback_id' as pb, likes, liked_by_me from public.reels_feed()"));
  if (r.rows.length !== 2 || r.rows[0].source_type !== "post" || r.rows[1].source_type !== "apartment") throw new Error(JSON.stringify(r.rows));
  if (r.rows[0].author_name !== "Bob" || Number(r.rows[0].likes) !== 1 || r.rows[0].liked_by_me !== true || r.rows[0].pb !== "pb1abcdef" || r.rows[1].title !== "Tour flat") throw new Error(JSON.stringify(r.rows));
  if ((await asAnon(() => db.query("select 1 from public.reels_feed()"))).rows.length !== 2) throw new Error("anon cannot read reels");
});
await expectOk("posts: blocking hides posts and reels, and blocked people cannot like or comment (so cannot notify)", async () => {
  await as(A, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [A, C]));
  if ((await as(C, () => db.query("select 1 from public.feed_posts where author_id=$1", [A]))).rows.length !== 0) throw new Error("blocked person still sees posts");
  for (const q of ["insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", "insert into public.post_comments (target_type, target_id, user_id, body) values ('post',$1,$2,'hi')"]) {
    let threw = false; try { await as(C, () => db.query(q, [post, C])); } catch { threw = true; }
    if (!threw) throw new Error("blocked person could interact: " + q.slice(0, 40));
  }
  await as(A, () => db.query("delete from public.blocks where blocker_id=$1", [A]));
});
await expectError("notify() cannot be called through the API (no forged notifications)", () => as(B, () => db.query("select public.notify($1, null, 'system', 'You won!', null, 'https://evil.example', '{}'::jsonb, null)", [A])), "permission denied");
await expectOk("posts: deleting a post removes its likes, comments, saves and views; deleting someone else's does nothing", async () => {
  const del = await as(B, () => db.query("delete from public.feed_posts where id=$1 returning id", [post])); if (del.rows.length) throw new Error("someone else deleted a post");
  await as(A, () => db.query("delete from public.feed_posts where id=$1", [post]));
  const left = await one(db.query("select (select count(*) from public.post_likes where target_id=$1) l, (select count(*) from public.post_comments where target_id=$1) c, (select count(*) from public.saved_listings where target_id=$1) s, (select count(*) from public.post_views where target_id=$1) v", [post]));
  if (Number(left.l) + Number(left.c) + Number(left.s) + Number(left.v) !== 0) throw new Error(JSON.stringify(left));
});

// ---- buzz: anonymity -----------------------------------------------------------------
const buzz = await create(A, "advice", "Landlord keeps my deposit?", { body: "What can I do" });
const buzz2 = await create(A, "rant", "Parking on campus");
for (const t of ["buzz_posts", "buzz_comments", "buzz_votes", "buzz_mutes", "buzz_rate_log", "buzz_secrets"]) {
  await expectError(`buzz: ${t} is closed to the API, even for the author (no row-count estimates either)`, () => as(A, () => db.query(`select * from public.${t}`)), "permission denied");
}
await expectError("buzz: signed-out visitors cannot read the tables", () => asAnon(() => db.query("select * from public.buzz_posts")), "permission denied");
await expectOk("buzz_feed: sanitized rows for everyone (signed out too), is_mine only for the author, no author column, per-thread aliases", async () => {
  const mine = (await as(A, () => db.query("select * from public.buzz_feed(p_sort => 'new')"))).rows;
  const theirs = (await as(B, () => db.query("select * from public.buzz_feed(p_sort => 'new')"))).rows;
  const anon = (await asAnon(() => db.query("select * from public.buzz_feed()"))).rows;
  if (mine.length !== 2 || theirs.length !== 2 || anon.length !== 2) throw new Error("wrong counts");
  if (!mine.every((r) => r.is_mine) || theirs.some((r) => r.is_mine) || anon.some((r) => r.is_mine)) throw new Error("is_mine wrong");
  for (const r of [...mine, ...theirs, ...anon]) if (Object.keys(r).some((k) => /author|user|visible/.test(k)) || Object.values(r).some((v) => v === A)) throw new Error("leak: " + JSON.stringify(r));
  if (!/^Student \d{5}$/.test(theirs[0].alias)) throw new Error("alias " + theirs[0].alias);
  if (theirs.find((r) => r.id === buzz).alias === theirs.find((r) => r.id === buzz2).alias) throw new Error("same alias across threads links them together");
  if ((await as(B, () => db.query("select 1 from public.buzz_feed(p_topic => 'rant')"))).rows.length !== 1) throw new Error("topic filter");
  if ((await as(B, () => db.query("select 1 from public.buzz_feed(p_q => 'deposit')"))).rows.length !== 1) throw new Error("search");
  if ((await as(B, () => db.query("select 1 from public.buzz_feed(p_q => $1)", ["100%_\\"]))).rows.length !== 0) throw new Error("wildcards in search not neutralised");
  for (const sort of ["hot", "new", "top"]) if ((await as(B, () => db.query("select 1 from public.buzz_feed(p_sort => $1)", [sort]))).rows.length !== 2) throw new Error(sort);
});
await expectOk("REGRESSION block-oracle: blocking a suspect does NOT hide their Buzz threads or replies", async () => {
  await reply(A, buzz2, "adding detail");
  await as(C, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [C, A]));
  if ((await as(C, () => db.query("select 1 from public.buzz_feed()"))).rows.length !== 2) throw new Error("block changed what Buzz shows: authors can be unmasked");
  if ((await as(C, () => db.query("select 1 from public.buzz_comments_list($1)", [buzz2]))).rows.length !== 1) throw new Error("block hid a reply");
  await as(C, () => db.query("delete from public.blocks where blocker_id=$1", [C]));
});
for (const [name, sql, args] of [
  ["alias function", "select public.buzz_alias($1,$2)", () => [A, buzz]],
  ["hidden check", "select public.buzz_hidden($1,$2)", () => [A, buzz]],
  ["reply counter", "select public.buzz_reply_count($1)", () => [buzz]],
]) await expectError(`buzz: ${name} is not reachable through the API`, () => as(B, () => db.query(sql, args())), "permission denied");
await expectOk("buzz: video ownership is private, and the stored video carries no media id", async () => {
  await as(A, () => db.query("insert into public.media (owner_id, provider, provider_upload_id, status, playback_id) values ($1,'mux','up1','ready','pbbuzz123')", [A]));
  if ((await as(B, () => db.query("select * from public.media where playback_id='pbbuzz123'"))).rows.length !== 0) throw new Error("media owner readable");
  if ((await as(A, () => db.query("select * from public.media"))).rows.length !== 1) throw new Error("owner cannot read own media");
  const id = await create(C, "campus", "Clip from the quad", { videos: JSON.parse(VIDEO).concat(JSON.parse(VIDEO)) });
  const v = (await as(B, () => one(db.query("select videos from public.buzz_get($1)", [id])))).videos;
  if (v.length !== 1 || v[0].media_id !== "00000000-0000-0000-0000-000000000000" || v[0].playback_id !== "pb1abcdef") throw new Error(JSON.stringify(v));
  await as(C, () => db.query("select public.buzz_delete($1)", [id]));
});
await expectOk("buzz: photos must be this project's anonymous folder, a random name (no clock), really uploaded by the poster; junk meta is dropped", async () => {
  const good = await uploadBuzzPhoto(C);
  const someoneElses = await uploadBuzzPhoto(B);
  const bads = [
    `${ORIGIN}posts/${C}/1.jpg`,
    "https://tracker.example/pixel.gif",
    good + "?u=" + C,
    good.replace("dskbzoqreandwwpxiplh", "evil-tracker"),
    `${ORIGIN}buzz/anon/1758412345678-${hex(32)}.jpg`,
    `${ORIGIN}buzz/anon/${hex(48)}.jpg`,
    someoneElses,
  ];
  for (const bad of bads) { let threw = false; try { await create(C, "other", "with a bad photo", { images: [bad] }); } catch { threw = true; } if (!threw) throw new Error("accepted " + bad); }
  for (const arr of ["array[null]::text[]", `array[array['${good}','${good}']]`]) {
    let threw = false; try { await as(C, () => db.query(`select public.buzz_create(p_topic => 'other', p_title => 'weird array', p_images => ${arr})`)); } catch { threw = true; } if (!threw) throw new Error("accepted " + arr);
  }
  const junk = Array.from({ length: 20 }, () => ({ url: good, width: { junk: "x".repeat(3000) }, height: "NaN", blur: "x".repeat(9000) }));
  const id = await create(C, "other", "with a good photo", { images: [good], meta: [...junk, { url: "https://x.example/other.jpg", width: 1, height: 1, blur: null }] });
  const row = await as(B, () => one(db.query("select images, image_meta from public.buzz_get($1)", [id])));
  if (row.images[0] !== good || row.image_meta.length !== 1 || row.image_meta[0].width !== null || row.image_meta[0].blur !== null || JSON.stringify(row).length > 600) throw new Error(JSON.stringify(row).slice(0, 300));
  await as(C, () => db.query("select public.buzz_delete($1)", [id]));
  let threw = false; try { await as(B, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads','buzz/other/1.jpg',$1)", [B])); } catch { threw = true; }
  if (!threw) throw new Error("buzz/other accepted");
  if ((await as(C, () => db.query("select * from storage.objects where name like 'buzz/%' and owner <> $1", [C]))).rows.length !== 0) throw new Error("others can list buzz files");
  if ((await as(C, () => db.query("delete from storage.objects where owner=$1 returning id", [B]))).rows.length) throw new Error("someone else deleted my file");
  if (!(await as(B, () => db.query("delete from storage.objects where owner=$1 returning id", [B]))).rows.length) throw new Error("cannot delete own file");
});
await expectError("buzz: threads cannot be written straight into the table (no forged scores, times or authors)", () => as(B, () => db.query("insert into public.buzz_posts (author_id, alias, title, score, created_at) values ($1,'Student 1','look at me',999, now() + interval '3 days')", [B])), "permission denied");
await expectError("buzz: replies cannot be written straight into the table", () => as(B, () => db.query("insert into public.buzz_comments (post_id, author_id, alias, body) values ($1,$2,'Student 1','x')", [buzz, B])), "permission denied");
await expectError("buzz: signed-out visitors cannot post", () => asAnon(() => db.query("select public.buzz_create(p_topic => 'other', p_title => 'hello there')")), "");
await expectOk("buzz: publication jitter. Others see a new thread only after its delay, the author sees it at once, and only the published time is shown", async () => {
  await db.exec("update public.buzz_secrets set thread_jitter_seconds = 3600, reply_jitter_seconds = 3600");
  const hidden = await create(C, "thoughts", "Delayed thread");
  const r = await reply(C, buzz, "delayed reply");
  await db.query("update public.buzz_posts set visible_at = now() + interval '30 minutes' where id=$1", [hidden]);
  await db.query("update public.buzz_comments set visible_at = now() + interval '30 minutes' where id=$1", [r]);
  if ((await as(B, () => db.query("select 1 from public.buzz_get($1)", [hidden]))).rows.length !== 0) throw new Error("visible early");
  const own = await as(C, () => one(db.query("select created_at from public.buzz_get($1)", [hidden]))); if (!own || new Date(own.created_at) > new Date(Date.now() + 5000)) throw new Error("author cannot see it, or sees a future time");
  if ((await as(B, () => db.query("select 1 from public.buzz_comments_list($1) where body='delayed reply'", [buzz]))).rows.length !== 0) throw new Error("reply visible early");
  if ((await as(B, () => one(db.query("select comment_count from public.buzz_get($1)", [buzz])))).comment_count !== 0) throw new Error("count reveals an unpublished reply");
  let threw = false; try { await reply(B, hidden, "guessing the id"); } catch { threw = true; } if (!threw) throw new Error("could reply to an unpublished thread");
  threw = false; try { await reply(B, buzz, "answering a reply nobody can see yet", r); } catch { threw = true; } if (!threw) throw new Error("could attach to an unpublished parent");
  // The thread author (A) is not told, and cannot clock the reply, until it is published.
  if ((await as(A, () => db.query("select 1 from public.notifications where link=$1", [`/buzz/${buzz}`]))).rows.length !== 0) throw new Error("author notified before the reply was published");
  if ((await as(A, () => one(db.query("select public.unread_notification_count() as n")))).n !== Number((await as(A, () => one(db.query("select count(*) n from public.notifications where read_at is null")))).n)) throw new Error("badge counts a hidden notification");
  const note = await one(db.query("select n.created_at, n.visible_at, c.visible_at as reply_visible, c.created_at as reply_real from public.notifications n, public.buzz_comments c where n.link=$1 and c.id=$2", [`/buzz/${buzz}`, r]));
  if (+note.created_at === +note.reply_real) throw new Error("the notification carries the real reply time");
  // Hot ranking must not move when an unpublished reply lands.
  const hotBefore = (await as(B, () => db.query("select id from public.buzz_feed(p_sort => 'hot')"))).rows.map((x) => x.id).join();
  for (let i = 0; i < 6; i++) { const x = await reply(C, buzz2, "pile-on " + i); await db.query("update public.buzz_comments set visible_at = now() + interval '30 minutes' where id=$1", [x]); await as(C, () => db.query("select public.buzz_delete_comment($1)", [x])); }
  const extra = await reply(C, buzz2, "unpublished"); await db.query("update public.buzz_comments set visible_at = now() + interval '30 minutes' where id=$1", [extra]);
  if ((await as(B, () => db.query("select id from public.buzz_feed(p_sort => 'hot')"))).rows.map((x) => x.id).join() !== hotBefore) throw new Error("an unpublished reply moved the hot ranking");
  await as(C, () => db.query("select public.buzz_delete_comment($1)", [extra]));
  await db.query("update public.buzz_posts set visible_at = now() - interval '1 second' where id=$1", [hidden]);
  const pub = await as(B, () => one(db.query("select created_at from public.buzz_get($1)", [hidden]))); if (!pub) throw new Error("not visible after its delay");
  const real = await one(db.query("select created_at, visible_at from public.buzz_posts where id=$1", [hidden]));
  if (+pub.created_at !== +real.visible_at || +pub.created_at === +real.created_at) throw new Error("the real creation time is exposed");
  await as(C, () => db.query("select public.buzz_delete($1)", [hidden]));
  await as(C, () => db.query("select public.buzz_delete_comment($1)", [r]));
  await db.query("delete from public.notifications where link=$1", [`/buzz/${buzz}`]);
  await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
});
await expectOk("buzz: tiny campuses are not tagged (a campus tag would point at a handful of people), and untagged threads show everywhere", async () => {
  const uni = (await one(db.query("select id from public.universities limit 1"))).id;
  await db.query("update public.profiles set university_id=$1 where id=$2", [uni, C]);
  const id = await as(C, () => one(db.query("select public.buzz_create(p_topic => 'campus', p_title => 'Small campus thread', p_university_id => $1) as id", [uni]))).then((r) => r.id);
  const row = await as(B, () => one(db.query("select university_id from public.buzz_feed(p_university_id => $1) where id=$2", [uni, id])));
  if (!row || row.university_id !== null) throw new Error(JSON.stringify(row));
  await db.exec("update public.buzz_secrets set min_campus_size = 1");
  const id2 = await as(C, () => one(db.query("select public.buzz_create(p_topic => 'campus', p_title => 'Big campus thread', p_university_id => $1) as id", [uni]))).then((r) => r.id);
  if ((await as(B, () => one(db.query("select university_id from public.buzz_get($1)", [id2])))).university_id !== uni) throw new Error("campus tag missing on a big campus");
  await db.exec("update public.buzz_secrets set min_campus_size = 20");
  for (const x of [id, id2]) await as(C, () => db.query("select public.buzz_delete($1)", [x]));
});

// ---- buzz: votes, replies, moderation ---------------------------------------------------
await expectOk("buzz_vote: up, switch to down, clear; one vote per person; others' votes are private", async () => {
  const v = (s) => as(B, () => one(db.query("select * from public.buzz_vote($1,$2)", [buzz, s])));
  let r = await v(1); if (r.score !== 1 || r.my_vote !== 1) throw new Error("up " + JSON.stringify(r));
  r = await v(1); if (r.score !== 1) throw new Error("double up " + JSON.stringify(r));
  r = await v(-1); if (r.score !== -1 || r.my_vote !== -1) throw new Error("down " + JSON.stringify(r));
  r = await v(0); if (r.score !== 0 || r.my_vote !== 0) throw new Error("clear " + JSON.stringify(r));
  await v(1); await as(C, () => db.query("select * from public.buzz_vote($1,1)", [buzz]));
  const f = await as(B, () => one(db.query("select score, my_vote from public.buzz_get($1)", [buzz]))); if (f.score !== 2 || f.my_vote !== 1) throw new Error("get " + JSON.stringify(f));
});
await expectError("buzz_vote: invalid values are rejected", () => as(B, () => db.query("select * from public.buzz_vote($1,5)", [buzz])), "Invalid vote");
await expectError("buzz_vote: signed-out visitors cannot vote", () => asAnon(() => db.query("select * from public.buzz_vote($1,1)", [buzz])), "");
await expectError("buzz: votes cannot be written directly", () => as(B, () => db.query("insert into public.buzz_votes (post_id, user_id, value) values ($1,$2,1)", [buzz2, B])), "permission denied");
let bobReply;
await expectOk("buzz replies: counted, anonymous, OP flagged, same alias as in the feed, author notified without an actor", async () => {
  const notesBefore = (await one(db.query("select count(*)::int n from public.notifications where user_id=$1 and link=$2", [A, `/buzz/${buzz}`]))).n;
  bobReply = await reply(B, buzz, "Check your lease, then small claims.");
  await reply(A, buzz, "Thanks!", bobReply);
  const list = (await as(C, () => db.query("select * from public.buzz_comments_list($1)", [buzz]))).rows;
  if (list.length !== 2 || list[0].is_op || !list[1].is_op || list.some((c) => c.is_mine) || list[1].parent_id !== bobReply) throw new Error(JSON.stringify(list));
  for (const c of list) if (Object.keys(c).some((k) => /author|user|visible/.test(k)) || Object.values(c).some((v) => v === A || v === B)) throw new Error("author leaked");
  const opAlias = (await as(C, () => one(db.query("select alias from public.buzz_get($1)", [buzz])))).alias;
  if (list[1].alias !== opAlias || list[0].alias === opAlias) throw new Error("aliases inconsistent");
  if ((await as(B, () => one(db.query("select comment_count from public.buzz_get($1)", [buzz])))).comment_count !== 2) throw new Error("count");
  const n = await as(A, () => db.query("select actor_id, link from public.notifications where link = $1", [`/buzz/${buzz}`]));
  if (n.rows.length !== notesBefore + 1 || n.rows.some((r) => r.actor_id !== null)) throw new Error("notification " + JSON.stringify(n.rows));
});
await expectError("buzz replies: a parent from another thread is rejected", () => reply(C, buzz2, "cross-thread", bobReply), "another thread");
await expectError("buzz replies: empty replies are rejected", () => reply(C, buzz, "   "), "");
await expectOk("buzz_delete_comment: only the writer or the thread author", async () => {
  let threw = false; try { await as(C, () => db.query("select public.buzz_delete_comment($1)", [bobReply])); } catch { threw = true; }
  if (!threw) throw new Error("stranger deleted a reply");
  await as(A, () => db.query("select public.buzz_delete_comment($1)", [bobReply]));
  if ((await as(B, () => one(db.query("select comment_count from public.buzz_get($1)", [buzz])))).comment_count !== 0) throw new Error("count after delete (the child reply goes with its parent)");
});
await expectOk("REGRESSION mute-linking: hiding is scoped to one thread, so it cannot reveal which other threads share an author", async () => {
  const carolReply = await reply(C, buzz2, "I disagree");
  await reply(C, buzz, "me again in another thread");
  await as(B, () => db.query("select public.buzz_mute(p_post_id => $1)", [buzz]));
  const feed = (await as(B, () => db.query("select id from public.buzz_feed()"))).rows.map((r) => r.id);
  if (feed.includes(buzz)) throw new Error("hidden thread still listed");
  if (!feed.includes(buzz2)) throw new Error("hiding one thread hid another by the same author: threads are linkable");
  if ((await as(B, () => db.query("select 1 from public.buzz_get($1)", [buzz]))).rows.length !== 0) throw new Error("hidden thread still opens");
  await as(B, () => db.query("select public.buzz_mute(p_comment_id => $1)", [carolReply]));
  if ((await as(B, () => db.query("select 1 from public.buzz_comments_list($1) where body='I disagree'", [buzz2]))).rows.length !== 0) throw new Error("hidden reply still shown");
  if ((await as(A, () => db.query("select 1 from public.buzz_comments_list($1) where body='me again in another thread'", [buzz]))).rows.length !== 1) throw new Error("hide leaked into another thread");
  if ((await as(C, () => db.query("select 1 from public.buzz_feed()"))).rows.length !== 2) throw new Error("hide affected someone else");
  // The thread author hid Carol in buzz2: her further replies there no longer notify the author.
  await as(A, () => db.query("select public.buzz_mute(p_comment_id => $1)", [carolReply]));
  const before = (await one(db.query("select count(*)::int n from public.notifications where user_id=$1", [A]))).n;
  await reply(C, buzz2, "still here");
  if ((await one(db.query("select count(*)::int n from public.notifications where user_id=$1", [A]))).n !== before) throw new Error("hidden person still notifies");
});
await expectOk("REGRESSION rate limit: five threads an hour, and deleting a thread does not give the slot back", async () => {
  let made = 0, limited = false;
  try { for (let i = 0; i < 8; i++) { const id = await create(B, "other", `Spam thread number ${i}`); await as(B, () => db.query("select public.buzz_delete($1)", [id])); made++; } } catch (e) { limited = /posting a lot/.test(e.message); }
  if (!limited || made !== 5) throw new Error(`made ${made}, limited ${limited}`);
});
await expectOk("friendly errors instead of raw constraint names", async () => {
  for (const [q, want] of [["select public.buzz_create('rant', null)", /Titles need/], ["select public.buzz_create('nonsense', 'A fine title')", /Pick a topic/], [`select public.buzz_reply('${buzz2}', '   ')`, /Replies need/]]) {
    let msg = ""; try { await as(A, () => db.query(q)); } catch (e) { msg = e.message; } if (!want.test(msg)) throw new Error(`${q} -> ${msg}`);
  }
});
await expectOk("hiding can be undone", async () => {
  await as(B, () => db.query("select public.buzz_unmute($1)", [buzz]));
  if ((await as(B, () => db.query("select 1 from public.buzz_get($1)", [buzz]))).rows.length !== 1) throw new Error("thread did not come back");
});
await expectOk("blocked people cannot save your listings (no 'saved your listing' pings), last-seen is coarse, has_video cannot be forged", async () => {
  const apt = (await one(db.query("select id from public.apartments where owner_id=$1 limit 1", [A]))).id;
  await as(A, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [A, C]));
  let threw = false; try { await as(C, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('apartment',$1,$2)", [apt, C])); } catch { threw = true; }
  if (!threw) throw new Error("blocked person saved the listing");
  await as(A, () => db.query("delete from public.blocks where blocker_id=$1", [A]));
  await as(B, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('apartment',$1,$2)", [apt, B]));
  if ((await as(B, () => db.query("select 1 from public.saved_listings"))).rows.length !== 1) throw new Error("normal save broken");
  await as(B, () => db.query("delete from public.saved_listings where user_id=$1", [B]));
  await as(B, () => db.query("select public.touch_presence()"));
  const seen = (await one(db.query("select extract(epoch from last_seen_at)::bigint as e from public.profiles where id=$1", [B]))).e;
  if (Number(seen) % 600 !== 0) throw new Error("last_seen_at is precise: " + seen);
  const p = await as(B, () => one(db.query("insert into public.feed_posts (author_id, body, has_video) values ($1,'text only', true) returning id, has_video", [B])));
  const u = await as(B, () => one(db.query("update public.feed_posts set has_video = true where id=$1 returning has_video", [p.id])));
  if (p.has_video || u.has_video) throw new Error("has_video forged");
  await as(B, () => db.query("delete from public.feed_posts where id=$1", [p.id]));
});
await expectOk("buzz: authors delete their own threads (votes, replies and hides go with them); nobody else can; reports accept buzz targets", async () => {
  await as(B, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1,'buzz',$2,'harassment')", [B, buzz2]));
  let threw = false; try { await as(B, () => db.query("select public.buzz_delete($1)", [buzz2])); } catch { threw = true; } if (!threw) throw new Error("someone else deleted a thread");
  await as(A, () => db.query("select public.buzz_delete($1)", [buzz]));
  const left = await one(db.query("select (select count(*) from public.buzz_votes where post_id=$1) v, (select count(*) from public.buzz_comments where post_id=$1) c, (select count(*) from public.buzz_mutes where post_id=$1) m", [buzz]));
  if (Number(left.v) + Number(left.c) + Number(left.m) !== 0) throw new Error(JSON.stringify(left));
});
await expectOk("REGRESSION account deletion: a deleted account does not take a tell-tale set of threads with it (they stay, detached, same alias)", async () => {
  const before = (await as(B, () => db.query("select id, alias from public.buzz_feed(p_sort => 'new')"))).rows;
  if (!before.some((r) => r.id === buzz2)) throw new Error("setup");
  await db.query("delete from auth.users where id=$1", [A]);
  const after = (await as(B, () => db.query("select id, alias, is_mine from public.buzz_feed(p_sort => 'new')"))).rows;
  if (JSON.stringify(after.map((r) => [r.id, r.alias])) !== JSON.stringify(before.map((r) => [r.id, r.alias]))) throw new Error("threads changed when the account was deleted");
  if ((await one(db.query("select author_id from public.buzz_posts where id=$1", [buzz2]))).author_id !== null) throw new Error("author reference kept");
  if ((await as(B, () => db.query("select 1 from public.buzz_comments_list($1)", [buzz2]))).rows.length === 0) throw new Error("replies lost");
});
done("MIGRATION-11");
