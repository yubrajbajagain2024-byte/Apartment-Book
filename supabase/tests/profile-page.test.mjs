// Migration 18 (profile page) against PGlite: usernames, who-can-see settings, classes, private likes and saves,
// profile numbers, view counts and pinned posts.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the profile-page migration re-runs cleanly", async () => { await db.exec(read("migrations/20260927000000_profile_page.sql")); });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const A = await mk("a@txstate.edu", "Sunil Sherpa"), B = await mk("b@txstate.edu", "Bob Builder"), C = await mk("c@txstate.edu", "Carol Chen"), D = await mk("d@txstate.edu", "Sunil Sherpa");
const username = async (id) => (await one(db.query("select username from public.profiles where id=$1", [id]))).username;
const follow = (from, to) => as(from, () => db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [from, to]));
const setVis = (uid, col, v) => as(uid, () => db.query(`update public.profiles set ${col} = $2 where id = $1`, [uid, v]));
const access = (viewer, owner) => (viewer ? as(viewer, () => one(db.query("select * from public.profile_section_access($1)", [owner])))
  : asAnon(() => one(db.query("select * from public.profile_section_access($1)", [owner]))));
const post = async (uid, body, kind = "post") => (await as(uid, () => one(db.query(
  kind === "reel"
    ? `insert into public.feed_posts (author_id, kind, body, videos) values ($1, 'reel', $2, '[{"media_id":"00000000-0000-4000-8000-000000000001","playback_id":"pb","poster_url":null,"width":1080,"height":1920,"duration_seconds":5}]'::jsonb) returning id`
    : "insert into public.feed_posts (author_id, body) values ($1,$2) returning id",
  [uid, body])))).id;

// --- usernames ---------------------------------------------------------------
await expectOk("usernames: every profile gets one from the name; two people with the same name get different ones", async () => {
  const a = await username(A), d = await username(D);
  if (a !== "sunilsherpa") throw new Error("first Sunil: " + a);
  if (!/^sunilsherpa\d{4}$/.test(d)) throw new Error("second Sunil: " + d);
  if ((await username(B)) !== "bobbuilder") throw new Error("Bob: " + (await username(B)));
});
await expectOk("usernames: a change is tidied (no @, lowercase) and saved", async () => {
  await as(A, () => db.query("update public.profiles set username = ' @Crf153 ' where id = $1", [A]));
  if ((await username(A)) !== "crf153") throw new Error("got " + (await username(A)));
});
await expectError("usernames: someone else's username is refused", () => as(B, () => db.query("update public.profiles set username = 'crf153' where id = $1", [B])), "That username is taken");
await expectError("usernames: a malformed one is refused with the rules", () => as(B, () => db.query("update public.profiles set username = 'b!' where id = $1", [B])), "3 to 30 characters");
await expectError("usernames: two dots in a row are refused", () => as(B, () => db.query("update public.profiles set username = 'bob..b' where id = $1", [B])), "3 to 30 characters");
await expectError("usernames: reserved names are refused", () => as(B, () => db.query("update public.profiles set username = 'support' where id = $1", [B])), "reserved");
await expectOk("usernames: clearing it keeps the old one", async () => {
  await as(B, () => db.query("update public.profiles set username = '' where id = $1", [B]));
  if ((await username(B)) !== "bobbuilder") throw new Error("got " + (await username(B)));
});

// --- visibility ----------------------------------------------------------------
await expectOk("settings: classes start at friends, saved at only me, liked at everyone", async () => {
  const p = await one(db.query("select classes_visibility, saved_visibility, liked_visibility from public.profiles where id=$1", [A]));
  if (p.classes_visibility !== "friends" || p.saved_visibility !== "private" || p.liked_visibility !== "public") throw new Error(JSON.stringify(p));
});
await expectError("settings: only public, friends or private", () => setVis(A, "saved_visibility", "followers"), "profiles_section_visibility_check");
await expectOk("access: the owner sees everything; a stranger sees only what is public; friends see friends-only parts", async () => {
  let r = await access(A, A); if (!r.classes || !r.saved || !r.liked) throw new Error("owner: " + JSON.stringify(r));
  r = await access(B, A); if (r.classes || r.saved || !r.liked) throw new Error("stranger: " + JSON.stringify(r));
  r = await access(null, A); if (r.classes || r.saved || !r.liked) throw new Error("signed out: " + JSON.stringify(r));
  await follow(A, B); r = await access(B, A); if (r.classes) throw new Error("one-way follow counted as friends");
  await follow(B, A); r = await access(B, A); if (!r.classes || r.saved) throw new Error("friend: " + JSON.stringify(r));
});

// --- classes -------------------------------------------------------------------
let cls;
await expectOk("classes: the owner adds 'cs3358 ' and it is stored as 'CS 3358'; a blank title is no title", async () => {
  cls = await as(A, () => one(db.query("insert into public.profile_classes (user_id, term, code, title) values ($1, 'Fall 2026', 'cs3358 ', '  ') returning id, code, title", [A])));
  if (cls.code !== "CS 3358" || cls.title !== null) throw new Error(JSON.stringify(cls));
  await as(A, () => db.query("insert into public.profile_classes (user_id, term, code, title) values ($1, 'Fall 2026', 'MATH 3398', 'Discrete Math')", [A]));
});
await expectError("classes: the same class twice in a semester is refused", () => as(A, () => db.query("insert into public.profile_classes (user_id, term, code) values ($1, 'Fall 2026', 'CS3358')", [A])), "already on your Fall 2026 classes");
await expectError("classes: a made-up semester name is refused", () => as(A, () => db.query("insert into public.profile_classes (user_id, term, code) values ($1, 'Autumn 2026', 'CS 1428')", [A])), "profile_classes_term_check");
await expectError("classes: nobody adds classes to someone else's profile", () => as(B, () => db.query("insert into public.profile_classes (user_id, term, code) values ($1, 'Fall 2026', 'CS 1428')", [A])), "row-level security");
await expectOk("classes: friends-only shows them to a friend (Bob) and hides them from a stranger (Carol) and from signed-out visitors", async () => {
  const sel = "select code from public.profile_classes where user_id = $1 order by code";
  if ((await as(B, () => rows(db.query(sel, [A])))).length !== 2) throw new Error("friend sees none");
  if ((await as(C, () => rows(db.query(sel, [A])))).length !== 0) throw new Error("stranger sees classes");
  if ((await asAnon(() => rows(db.query(sel, [A])))).length !== 0) throw new Error("signed-out visitor sees classes");
  await setVis(A, "classes_visibility", "public");
  if ((await asAnon(() => rows(db.query(sel, [A])))).length !== 2) throw new Error("public classes hidden");
  await setVis(A, "classes_visibility", "private");
  if ((await as(B, () => rows(db.query(sel, [A])))).length !== 0) throw new Error("private classes shown to a friend");
  if ((await as(A, () => rows(db.query(sel, [A])))).length !== 2) throw new Error("owner lost their own classes");
  await setVis(A, "classes_visibility", "public");
});
await expectError("classes: at most 12 in a semester", async () => {
  for (let i = 0; i < 11; i++) await as(A, () => db.query("insert into public.profile_classes (user_id, term, code) values ($1, 'Spring 2027', $2)", [A, `CS ${1000 + i}`]));
  await as(A, () => db.query("insert into public.profile_classes (user_id, term, code) values ($1, 'Spring 2027', 'CS 1999')", [A]));
  await as(A, () => db.query("insert into public.profile_classes (user_id, term, code) values ($1, 'Spring 2027', 'CS 2000')", [A]));
}, "up to 12 classes");
await expectOk("classes: the owner can remove one", async () => {
  await as(A, () => db.query("delete from public.profile_classes where id = $1", [cls.id]));
  if ((await rows(db.query("select 1 from public.profile_classes where id=$1", [cls.id]))).length) throw new Error("not removed");
});

// --- likes: private by setting, counts unchanged ---------------------------------
let p1;
await expectOk("likes: counts include everyone; nobody reads someone else's likes row by row", async () => {
  p1 = await post(A, "Study group?");
  await as(B, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [p1, B]));
  await as(C, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [p1, C]));
  const e = await as(D, () => one(db.query("select * from public.post_engagement('post', $1)", [p1])));
  if (Number(e.likes) !== 2 || e.liked_by_me) throw new Error("engagement for D: " + JSON.stringify(e));
  const many = await as(D, () => one(db.query("select * from public.post_engagement_many('post', array[$1]::uuid[])", [p1])));
  if (Number(many.likes) !== 2) throw new Error("engagement_many: " + JSON.stringify(many));
  if ((await as(D, () => rows(db.query("select * from public.post_likes where target_id = $1", [p1])))).length !== 0) throw new Error("D read other people's like rows");
  if ((await as(B, () => rows(db.query("select * from public.post_likes where target_id = $1", [p1])))).length !== 1) throw new Error("B cannot read their own like");
  const mine = await as(B, () => one(db.query("select liked_by_me from public.post_engagement('post', $1)", [p1])));
  if (!mine.liked_by_me) throw new Error("liked_by_me lost for B");
});
await expectOk("likes: 'Liked by' faces show public likers, drop private ones, but the count stays", async () => {
  const faces = async (viewer) => (await as(viewer, () => rows(db.query("select user_id from public.post_likers_many('post', array[$1]::uuid[])", [p1])))).map((r) => r.user_id).sort();
  let f = await faces(D); if (f.length !== 2) throw new Error("both public: " + f.length);
  await setVis(C, "liked_visibility", "private");
  f = await faces(D); if (f.length !== 1 || f[0] !== B) throw new Error("private liker shown: " + JSON.stringify(f));
  f = await faces(C); if (!f.includes(C)) throw new Error("Carol does not see her own face");
  const e = await as(D, () => one(db.query("select likes from public.post_engagement('post', $1)", [p1])));
  if (Number(e.likes) !== 2) throw new Error("count dropped to " + e.likes);
});
await expectOk("likes: the Liked list follows the setting (public, friends, only me)", async () => {
  const list = (viewer, owner) => as(viewer, () => rows(db.query("select target_id from public.profile_liked_items($1)", [owner])));
  if ((await list(D, B)).length !== 1) throw new Error("public list hidden");
  await setVis(B, "liked_visibility", "friends");
  let refused = false; try { await list(D, B); } catch { refused = true; }
  if (!refused) throw new Error("friends-only list shown to a stranger");
  if ((await list(A, B)).length !== 1) throw new Error("friends-only list hidden from a friend (A and B follow each other)");
  await setVis(B, "liked_visibility", "private");
  refused = false; try { await list(A, B); } catch { refused = true; }
  if (!refused) throw new Error("private list shown to a friend");
  if ((await list(B, B)).length !== 1) throw new Error("owner cannot see their own likes");
  await setVis(B, "liked_visibility", "public");
});
await expectOk("likes: the reels feed still counts private likes", async () => {
  const r = await post(A, "Tour", "reel");
  await as(C, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post',$1,$2)", [r, C]));
  const row = await as(D, () => one(db.query("select likes from public.reels_feed() where source_id = $1", [r])));
  if (!row || Number(row.likes) !== 1) throw new Error("reels_feed likes: " + JSON.stringify(row));
});

// --- saved ----------------------------------------------------------------------
await expectOk("saved: private by default, shown when the owner opens it up", async () => {
  await as(B, () => db.query("insert into public.saved_listings (user_id, target_type, target_id) values ($1,'post',$2)", [B, p1]));
  const list = (viewer) => as(viewer, () => rows(db.query("select target_type, target_id from public.profile_saved_items($1)", [B])));
  let refused = false; try { await list(D); } catch (e) { refused = /private/.test(e.message); }
  if (!refused) throw new Error("private saved list shown");
  if ((await list(B)).length !== 1) throw new Error("owner cannot see their saves");
  await setVis(B, "saved_visibility", "public");
  const shown = await list(D); if (shown.length !== 1 || shown[0].target_id !== p1) throw new Error("public saved list: " + JSON.stringify(shown));
  if ((await as(D, () => rows(db.query("select * from public.saved_listings where user_id = $1", [B])))).length !== 0) throw new Error("saved rows readable directly");
});
await expectOk("blocking: a blocked person sees none of the profile's sections, even public ones", async () => {
  await as(A, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [A, D]));
  const r = await access(D, A); if (r.classes || r.saved || r.liked) throw new Error(JSON.stringify(r));
  if ((await as(D, () => rows(db.query("select 1 from public.profile_classes where user_id = $1", [A])))).length) throw new Error("blocked person sees classes");
  const s = await as(D, () => one(db.query("select * from public.profile_stats($1)", [A])));
  if (Number(s.posts) !== 0 || Number(s.likes_received) !== 0) throw new Error("blocked person sees numbers: " + JSON.stringify(s));
  await as(A, () => db.query("delete from public.blocks where blocker_id=$1 and blocked_id=$2", [A, D]));
});

// --- numbers, views, pins ----------------------------------------------------------
await expectOk("profile numbers: posts, reels and every like received (posts, reels and listings)", async () => {
  const apt = (await as(A, () => one(db.query("insert into public.apartments (owner_id, title, price_per_month, address, city, latitude, longitude, bedrooms, bathrooms) values ($1,'Room','500','1 St','San Marcos',29.88,-97.94,1,1) returning id", [A])))).id;
  await as(C, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('apartment',$1,$2)", [apt, C]));
  const s = await as(B, () => one(db.query("select * from public.profile_stats($1)", [A])));
  if (Number(s.posts) !== 1 || Number(s.reels) !== 1 || Number(s.likes_received) !== 4) throw new Error(JSON.stringify(s));
});
await expectOk("views: counted per post for anyone to read", async () => {
  await db.query("insert into public.post_views (target_type, target_id, viewer_key) values ('post',$1,'k1'),('post',$1,'k2')", [p1]);
  const v = await asAnon(() => one(db.query("select views from public.post_view_counts('post', array[$1]::uuid[])", [p1])));
  if (Number(v.views) !== 2) throw new Error("views " + v.views);
});
await expectOk("pins: the author pins (the time is stamped), a new post never starts pinned, re-pinning keeps the order", async () => {
  const fresh = await as(A, () => one(db.query("insert into public.feed_posts (author_id, body, pinned_at) values ($1,'x', now() - interval '9 days') returning pinned_at", [A])));
  if (fresh.pinned_at !== null) throw new Error("a new post started pinned");
  await as(A, () => db.query("update public.feed_posts set pinned_at = '2001-01-01' where id = $1", [p1]));
  const first = (await one(db.query("select pinned_at from public.feed_posts where id=$1", [p1]))).pinned_at;
  if (!first || new Date(first).getFullYear() < 2026) throw new Error("pinned_at not stamped by the server: " + first);
  await as(A, () => db.query("update public.feed_posts set pinned_at = now() where id = $1", [p1]));
  const again = (await one(db.query("select pinned_at from public.feed_posts where id=$1", [p1]))).pinned_at;
  if (String(again) !== String(first)) throw new Error("re-pinning moved the post");
  const r = await as(B, () => db.query("update public.feed_posts set pinned_at = now() where id = $1", [p1]));
  if (r.affectedRows) throw new Error("someone else pinned Sunil's post");
});
await expectError("pins: at most three", async () => {
  for (let i = 0; i < 3; i++) { const id = await post(A, "p" + i); await as(A, () => db.query("update public.feed_posts set pinned_at = now() where id = $1", [id])); }
}, "pin up to 3");
await expectOk("pins: unpinning clears it", async () => {
  await as(A, () => db.query("update public.feed_posts set pinned_at = null where id = $1", [p1]));
  if ((await one(db.query("select pinned_at from public.feed_posts where id=$1", [p1]))).pinned_at !== null) throw new Error("still pinned");
});
await expectOk("account deletion takes the classes with it", async () => {
  await db.query("delete from auth.users where id=$1", [A]);
  if ((await rows(db.query("select 1 from public.profile_classes where user_id=$1", [A]))).length) throw new Error("classes left behind");
});
done("MIGRATION-18 PROFILE PAGE");
