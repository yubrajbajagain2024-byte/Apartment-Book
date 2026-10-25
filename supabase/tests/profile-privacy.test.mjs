// Migration 37 (profile privacy) against PGlite: Saved, Liked and Listings start private, Listings has a setting of its
// own that the access check knows, the old "Everyone" default on Liked becomes private once (never again on a re-run),
// and the Notifications badge leaves new messages and Snaps to Messages while their rows (and pushes) stay.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
const MIGRATION = "migrations/20261030000000_profile_privacy.sql";
await expectOk("the migration re-runs cleanly", async () => { await db.exec(read(MIGRATION)); });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;

const A = await mk("ann@txstate.edu", "Ann Avery"), B = await mk("ben@txstate.edu", "Ben Brooks"), C = await mk("cat@txstate.edu", "Cat Cruz");
const settings = (id) => one(db.query("select classes_visibility, saved_visibility, liked_visibility, listings_visibility from public.profiles where id = $1", [id]));
const ask = (fn) => (viewer, owner) => (viewer ? as(viewer, () => one(db.query(`select * from public.${fn}($1)`, [owner]))) : asAnon(() => one(db.query(`select * from public.${fn}($1)`, [owner]))));
const access = ask("profile_visible_sections");
const oldAccess = ask("profile_section_access");
const setVis = (who, column, value) => as(who, () => db.query(`update public.profiles set ${column} = $1 where id = $2`, [value, who]));
const follow = (a, b) => as(a, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [a, b]));

await expectOk("defaults: a new profile keeps Saved, Liked and Listings to itself; Classes stay with friends", async () => {
  const s = await settings(A);
  if (s.classes_visibility !== "friends" || s.saved_visibility !== "private" || s.liked_visibility !== "private" || s.listings_visibility !== "private") throw new Error(JSON.stringify(s));
});
await expectOk("access: the owner opens every tab, including Listings", async () => {
  const a = await access(A, A);
  if (!(a.classes && a.saved && a.liked && a.listings)) throw new Error(JSON.stringify(a));
});
await expectOk("access: a stranger and a signed-out visitor open none of Classes, Saved, Liked or Listings by default", async () => {
  for (const viewer of [B, null]) {
    const a = await access(viewer, A);
    if (a.classes || a.saved || a.liked || a.listings) throw new Error(`${viewer ?? "signed out"}: ${JSON.stringify(a)}`);
  }
});
await expectOk("Listings set to Everyone: a stranger and a signed-out visitor see it, nothing else opens with it", async () => {
  await setVis(A, "listings_visibility", "public");
  for (const viewer of [B, null]) {
    const a = await access(viewer, A);
    if (!a.listings || a.saved || a.liked) throw new Error(`${viewer ?? "signed out"}: ${JSON.stringify(a)}`);
  }
});
await expectOk("Listings set to Friends: a friend sees it, a one-way follower and a signed-out visitor do not", async () => {
  await setVis(A, "listings_visibility", "friends");
  await follow(A, B); await follow(B, A); // Ann and Ben are friends
  await follow(C, A); // Cat only follows Ann
  if (!(await access(B, A)).listings) throw new Error("friend kept out");
  if ((await access(C, A)).listings) throw new Error("one-way follower let in");
  if ((await access(null, A)).listings) throw new Error("signed out let in");
});
await expectOk("blocking closes Listings both ways, even set to Everyone", async () => {
  await setVis(A, "listings_visibility", "public");
  await as(A, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [A, C]));
  if ((await access(C, A)).listings) throw new Error("the blocked person sees Listings");
  await as(A, () => db.query("delete from public.blocks where blocker_id = $1 and blocked_id = $2", [A, C]));
  if (!(await access(C, A)).listings) throw new Error("unblocking did not open it again");
});
await expectError("Listings takes only Everyone, Friends or Only me", () => setVis(A, "listings_visibility", "nobody"), "profiles_section_visibility_check");
await expectOk("nobody sets someone else's Listings (the update finds no row)", async () => {
  const r = await as(B, () => db.query("update public.profiles set listings_visibility = 'private' where id = $1", [A]));
  if (r.affectedRows !== 0 || (await settings(A)).listings_visibility !== "public") throw new Error("someone else's setting changed");
});
await expectOk("the API still reads whole profile rows with the new column (select * signed in and signed out)", async () => {
  const signedIn = await as(B, () => one(db.query("select * from public.profiles where id = $1", [A])));
  const signedOut = await asAnon(() => one(db.query("select * from public.profiles where id = $1", [A])));
  if (signedIn.listings_visibility !== "public" || signedOut.listings_visibility !== "public") throw new Error("listings_visibility not readable");
});
await expectOk("the first run turns Liked tabs still on the old default (Everyone) private, and keeps a Friends choice", async () => {
  // Back to the state before migration 37: no Listings column, the Liked default Everyone, two profiles on it.
  await db.exec("alter table public.profiles drop column listings_visibility; alter table public.profiles alter column liked_visibility set default 'public';");
  await db.query("update public.profiles set liked_visibility = 'public' where id = any($1::uuid[])", [[A, B]]);
  await db.query("update public.profiles set liked_visibility = 'friends' where id = $1", [C]);
  await db.exec(read(MIGRATION));
  const [a, b, c] = [await settings(A), await settings(B), await settings(C)];
  if (a.liked_visibility !== "private" || b.liked_visibility !== "private") throw new Error(`old default kept: ${a.liked_visibility}, ${b.liked_visibility}`);
  if (c.liked_visibility !== "friends") throw new Error(`a choice was overwritten: ${c.liked_visibility}`);
  if (a.listings_visibility !== "private") throw new Error(`Listings did not start private: ${a.listings_visibility}`);
});
await expectOk("a re-run leaves a later Everyone choice alone", async () => {
  await setVis(A, "liked_visibility", "public");
  await db.exec(read(MIGRATION));
  if ((await settings(A)).liked_visibility !== "public") throw new Error("the re-run reset Ann's choice");
  if (!(await access(B, A)).liked) throw new Error("Ann's public Liked tab is closed");
});
await expectOk("profile_visible_sections answers for all four tabs; profile_section_access keeps its three for installed builds", async () => {
  for (const viewer of [B, null]) {
    const keys = Object.keys(await access(viewer, A)).sort().join(",");
    if (keys !== "classes,liked,listings,saved") throw new Error(keys);
    const old = await oldAccess(viewer, A);
    if (Object.keys(old).sort().join(",") !== "classes,liked,saved") throw new Error(JSON.stringify(old));
    const now = await access(viewer, A);
    if (old.classes !== now.classes || old.saved !== now.saved || old.liked !== now.liked) throw new Error("the two disagree");
  }
});
await expectOk("migration 18 still re-runs after this one, and this one after it", async () => {
  await db.exec(read("migrations/20260927000000_profile_page.sql"));
  await db.exec(read(MIGRATION));
});

// The Notifications badge and Messages.
const chat = (await as(B, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [A])))).id;
const badge = async (who) => Number((await as(who, () => one(db.query("select public.unread_notification_count() as n")))).n);
const notices = (who) => rows(db.query("select type, read_at from public.notifications where user_id = $1 order by created_at", [who]));
await expectOk("a new message still makes its notification row (the push rides on it) but leaves the Notifications badge alone", async () => {
  const before = await badge(A);
  await as(B, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'hi Ann')", [chat, B]));
  const all = await notices(A);
  if (!all.some((n) => n.type === "message" && n.read_at === null)) throw new Error("no message row: " + JSON.stringify(all));
  if ((await badge(A)) !== before) throw new Error(`badge moved: ${before} -> ${await badge(A)}`);
});
await expectOk("a Snap's notice stays out of the badge too", async () => {
  const before = await badge(A);
  await db.query("insert into public.notifications (user_id, actor_id, type, title, body, link) values ($1, $2, 'snap', 'Ben Brooks', 'Sent you a Snap', $3)", [A, B, `/messages/${chat}`]);
  if ((await badge(A)) !== before) throw new Error("the Snap counted");
});
await expectOk("everything else still counts: a follow lifts the badge, and reading it brings the badge back down", async () => {
  const before = await badge(A);
  await db.query("insert into public.notifications (user_id, actor_id, type, title, body, link) values ($1, $2, 'follow', 'Cat Cruz', 'started following you', '/profile/x')", [A, C]);
  if ((await badge(A)) !== before + 1) throw new Error("a follow did not count");
  await as(A, () => db.query("select public.mark_notifications_read()"));
  if ((await badge(A)) !== 0) throw new Error("still unread after Mark all as read");
});
await expectOk("the badge is still the caller's own: nobody else's notices count", async () => {
  await db.query("insert into public.notifications (user_id, actor_id, type, title, body, link) values ($1, $2, 'follow', 'Ann Avery', 'started following you', '/profile/y')", [C, A]);
  if ((await badge(A)) !== 0 || (await badge(C)) !== 1) throw new Error(`${await badge(A)} / ${await badge(C)}`);
});
await expectOk("the migration re-runs cleanly with data in place", async () => { await db.exec(read(MIGRATION)); });

done("MIGRATION-37 PROFILE PRIVACY");
