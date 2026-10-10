// Migration 19 (profile page tuning) against PGlite: newest visible likers per post, Saved/Liked paging across
// items from the same instant, unchanged profile numbers, and older call shapes still working.
import { boot, read, expectOk, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the tuning migration re-runs cleanly", async () => { await db.exec(read("migrations/20260928000000_profile_page_tuning.sql")); });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const users = [];
for (const name of ["Owner One", "Ann", "Ben", "Cat", "Dan", "Eve"]) users.push(await mk(`${name.toLowerCase().replace(/\s/g, "")}@txstate.edu`, name));
const [O, A, B, C, D, E] = users;
const post = async (body) => (await as(O, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1,$2) returning id", [O, body])))).id;
const likeAt = (uid, target, at) => db.query("insert into public.post_likes (target_type, target_id, user_id, created_at) values ('post',$1,$2,$3)", [target, uid, at]);

let p1, p2;
await expectOk("likers: the newest three visible likers of each post, newest first; a private liker is skipped, not counted", async () => {
  p1 = await post("first"); p2 = await post("second");
  await likeAt(A, p1, "2026-10-01T10:00:00Z"); await likeAt(B, p1, "2026-10-01T11:00:00Z"); await likeAt(C, p1, "2026-10-01T12:00:00Z");
  await likeAt(D, p1, "2026-10-01T13:00:00Z"); await likeAt(E, p1, "2026-10-01T14:00:00Z");
  await likeAt(A, p2, "2026-10-02T10:00:00Z");
  await as(E, () => db.query("update public.profiles set liked_visibility = 'private' where id = $1", [E]));
  const got = await asAnon(() => rows(db.query("select target_id, user_id from public.post_likers_many('post', array[$1,$2]::uuid[])", [p1, p2])));
  const p1Faces = got.filter((r) => r.target_id === p1).map((r) => r.user_id);
  if (p1Faces.join() !== [D, C, B].join()) throw new Error("post 1 faces: " + JSON.stringify(p1Faces));
  if (got.filter((r) => r.target_id === p2).length !== 1) throw new Error("post 2 faces");
  if (got[0].target_id !== p1) throw new Error("posts not in the order asked");
  const self = await as(E, () => rows(db.query("select user_id from public.post_likers_many('post', array[$1]::uuid[], 1)", [p1])));
  if (self.length !== 1 || self[0].user_id !== E) throw new Error("Eve does not see her own newest like: " + JSON.stringify(self));
});
await expectOk("stats: the Likes total still counts every like (private ones too)", async () => {
  const s = await asAnon(() => one(db.query("select * from public.profile_stats($1)", [O])));
  if (Number(s.posts) !== 2 || Number(s.likes_received) !== 6) throw new Error(JSON.stringify(s));
});
await expectOk("paging: items saved in the same instant are all reached across pages", async () => {
  await as(A, () => db.query("update public.profiles set saved_visibility = 'public', liked_visibility = 'public' where id = $1", [A]));
  const p3 = await post("third");
  const at = "2026-10-05T09:00:00Z";
  for (const t of [p1, p2, p3]) await db.query("insert into public.saved_listings (user_id, target_type, target_id, created_at) values ($1,'post',$2,$3)", [A, t, at]);
  const first = await asAnon(() => rows(db.query("select target_id, created_at from public.profile_saved_items($1, 2)", [A])));
  if (first.length !== 2) throw new Error("first page: " + first.length);
  const last = first[first.length - 1];
  const second = await asAnon(() => rows(db.query("select target_id from public.profile_saved_items($1, 2, $2, $3)", [A, last.created_at, last.target_id])));
  const seen = new Set([...first.map((r) => r.target_id), ...second.map((r) => r.target_id)]);
  if (second.length !== 1 || seen.size !== 3) throw new Error(`second page ${second.length}, distinct ${seen.size}`);
});
await expectOk("paging: the Liked list walks ties the same way", async () => {
  const at = "2026-10-06T09:00:00Z";
  const ids = [await post("x"), await post("y"), await post("z")];
  for (const t of ids) await likeAt(B, t, at);
  await as(B, () => db.query("update public.profiles set liked_visibility = 'public' where id = $1", [B]));
  const first = await asAnon(() => rows(db.query("select target_id, created_at from public.profile_liked_items($1, 2)", [B])));
  const last = first[first.length - 1];
  const second = await asAnon(() => rows(db.query("select target_id from public.profile_liked_items($1, 2, $2, $3)", [B, last.created_at, last.target_id])));
  // Bob also liked an older post earlier, which may come along on the second page: what matters is that all three ties appear.
  const seen = new Set([...first, ...second].map((r) => r.target_id));
  if (!ids.every((id) => seen.has(id))) throw new Error("liked ties lost: " + ids.filter((id) => !seen.has(id)).length + " missing");
});
await expectOk("compatibility: the call shapes migration 18 introduced still work", async () => {
  const r = await asAnon(() => rows(db.query("select * from public.profile_saved_items(p_user_id => $1, p_limit => 30, p_before => null)", [A])));
  if (r.length !== 3) throw new Error("named call: " + r.length);
  const l = await asAnon(() => rows(db.query("select * from public.profile_liked_items($1)", [B])));
  if (l.length < 3) throw new Error("one-argument call: " + l.length);
});
done("MIGRATION-19 PROFILE TUNING");
