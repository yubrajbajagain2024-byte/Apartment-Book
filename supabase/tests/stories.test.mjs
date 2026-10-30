// Migration 58 (Stories) against PGlite: who sees a story under each audience (campus by verified email, global,
// friends both ways, selected people), never across a block, never after it expires, never signed out; the author
// alone inserts (the server stamps the author, the time and the 24 hours), deletes and picks viewers; views recorded
// once per viewer by mark_story_seen() only, read in full by the author and one's own only by a viewer; the sweep; the
// rollback and a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, ok, fail, expectOk, expectError, done } from "./harness.mjs";

const NAME = "20261110000100_stories.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261110000100_stories.down.sql";
const BEFORE = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const VIDEO = { media_id: "00000000-0000-4000-8000-000000000001", playback_id: "pb1abcdef", poster_url: null, width: 1080, height: 1920, duration_seconds: 12 };
const check = (cond, message) => { if (!cond) throw new Error(message); };
const expectRefused = async (name, fn, message, code = "42501") => {
  try { await fn(); fail(name, "no error"); } catch (e) { if (e.message.includes(message) && (!code || e.code === code)) ok(name); else fail(name, `${e.code}: ${e.message}`); }
};

const { db, mk, as, asAnon } = await boot({ upTo: BEFORE });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
await expectOk(`the migration applies after ${BEFORE} and re-runs cleanly`, async () => { await db.exec(read(MIGRATION)); await db.exec(read(MIGRATION)); });

const UT = (await one(db.query("select id from public.universities where name = 'University of Texas at Austin'"))).id;
await db.query("update public.universities set email_domain = 'utexas.edu' where id = $1", [UT]);
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const ANN = await mk("ann@txstate.edu", "Ann Author");
const CAMPUS = await mk("cara@txstate.edu", "Cara Campus"); // Ann's campus, no follows
const OTHER = await mk("oli@utexas.edu", "Oli Other"); // another campus, no follows
const FRI = await mk("fay@utexas.edu", "Fay Friend"); // follows Ann and is followed back
const PICK = await mk("pia@utexas.edu", "Pia Picked"); // picked for the selected story
const NOPICK = await mk("ned@utexas.edu", "Ned Notpicked");
const BLK = await mk("bo@txstate.edu", "Bo Blocked"); // Ann's campus, but has blocked Ann
const UNCONFIRMED = await mk("una@txstate.edu", "Una Unconfirmed", { confirmed: false });
const follow = (a, b) => as(a, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [a, b]));
await follow(FRI, ANN); await follow(ANN, FRI); await follow(NOPICK, ANN); await follow(ANN, NOPICK);
await as(BLK, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [BLK, ANN]));

/** Ann shares a story; returns the row the insert hands back. */
const share = (uid, cols) => {
  const keys = Object.keys(cols);
  return as(uid, () => one(db.query(`insert into public.stories (author_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) returning *`, [uid, ...Object.values(cols)])));
};
const sees = async (who, id) => (await as(who, () => rows(db.query("select id from public.stories where id = $1", [id])))).length === 1;
const seen = (who, id) => as(who, () => one(db.query("select public.mark_story_seen($1) as added", [id]))).then((r) => r.added);
const pick = (who, id, ids) => as(who, () => one(db.query("select public.set_story_viewers($1, $2::uuid[]) as n", [id, ids]))).then((r) => r.n);

// --- The row -------------------------------------------------------------------------------------------------------
let photo;
await expectOk("a photo story: the server stamps the author, the time and 24 hours, whatever the client sent", async () => {
  photo = await share(ANN, { kind: "photo", image_url: "https://x.example/p.jpg", image_meta: JSON.stringify({ width: 1080, height: 1920, blur: null }), created_at: "2020-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" });
  const ageMs = Date.now() - Date.parse(photo.created_at);
  const life = (Date.parse(photo.expires_at) - Date.parse(photo.created_at)) / 3600_000;
  check(photo.author_id === ANN && ageMs < 60_000 && Math.abs(life - 24) < 0.01 && photo.audience === "global", JSON.stringify(photo));
});
await expectError("a story is a photo or a video, never both or neither", () => share(ANN, { kind: "photo", video: JSON.stringify(VIDEO) }), "stories_media_check");
await expectError("…nor a video without one", () => share(ANN, { kind: "video" }), "stories_media_check");
await expectError("an audience outside the four is refused", () => share(ANN, { kind: "photo", image_url: "x", audience: "nope" }), "stories_audience_check");
await expectOk("a story written as someone else is the writer's (the trigger stamps the author)", async () => {
  const s = await as(ANN, () => one(db.query("insert into public.stories (author_id, kind, image_url) values ($1, 'photo', 'https://x.example/r.jpg') returning author_id", [CAMPUS])));
  check(s.author_id === ANN, s.author_id);
});
await expectRefused("signed out, nothing is written", () => asAnon(() => db.query("insert into public.stories (author_id, kind, image_url) values ($1, 'photo', 'x')", [ANN])), "", null);
await expectOk("nothing is updated: the API has no update right", async () => {
  try {
    await as(ANN, () => db.query("update public.stories set expires_at = now() + interval '7 days' where id = $1", [photo.id]));
    throw new Error("the update went through");
  } catch (e) {
    check(/permission denied/.test(e.message), e.message);
  }
});

// --- Who sees it -----------------------------------------------------------------------------------------------
await expectOk("global: every signed-in student sees it, nobody signed out, nobody across a block", async () => {
  check(await sees(CAMPUS, photo.id) && await sees(OTHER, photo.id) && await sees(FRI, photo.id), "a student does not see a global story");
  check(!(await sees(BLK, photo.id)), "the person who blocked Ann sees her story");
  try {
    await asAnon(() => rows(db.query("select id from public.stories where id = $1", [photo.id])));
    throw new Error("signed out, the table can be read");
  } catch (e) {
    check(/permission denied/.test(e.message), e.message);
  }
});
let campus;
await expectOk("campus: the author's verified campus is set by the server; only students whose email is from that campus see it", async () => {
  campus = await share(ANN, { kind: "photo", image_url: "https://x.example/c.jpg", audience: "campus", university_id: UT });
  check(campus.university_id === TX, `campus set to ${campus.university_id}, not the verified one`);
  check(await sees(CAMPUS, campus.id), "a campus-mate does not see it");
  check(!(await sees(OTHER, campus.id)) && !(await sees(FRI, campus.id)), "another campus sees it");
  check(!(await sees(UNCONFIRMED, campus.id)), "an unconfirmed email counts as the campus");
});
await expectRefused("campus: someone whose email is not confirmed has no verified campus to share with", () => share(UNCONFIRMED, { kind: "photo", image_url: "https://x.example/n.jpg", audience: "campus", university_id: TX }), "verified student");
let friends;
await expectOk("friends: only people who follow the author and are followed back", async () => {
  friends = await share(ANN, { kind: "video", video: JSON.stringify(VIDEO), audience: "friends" });
  check(await sees(FRI, friends.id) && await sees(NOPICK, friends.id), "a friend does not see it");
  check(!(await sees(CAMPUS, friends.id)) && !(await sees(OTHER, friends.id)), "a non-friend sees it");
  await as(ANN, () => db.query("delete from public.follows where follower_id = $1 and followee_id = $2", [ANN, NOPICK]));
  check(!(await sees(NOPICK, friends.id)), "a follow one way still counts as friends");
});
let selected;
await expectOk("selected: only the people the author picked; picking is the author's alone, 50 at most, never a blocker", async () => {
  selected = await share(ANN, { kind: "photo", image_url: "https://x.example/s.jpg", audience: "selected" });
  check(!(await sees(PICK, selected.id)), "picked before anyone was picked");
  check((await pick(ANN, selected.id, [PICK, ANN, BLK])) === 1, "the author, and the person who blocked them, were added");
  check(await sees(PICK, selected.id) && !(await sees(NOPICK, selected.id)) && !(await sees(FRI, selected.id)), "the pick is wrong");
  const list = await as(ANN, () => rows(db.query("select user_id from public.story_viewers where story_id = $1", [selected.id])));
  check(list.length === 1 && list[0].user_id === PICK, "the author does not read the list");
  const own = await as(PICK, () => rows(db.query("select user_id from public.story_viewers where story_id = $1", [selected.id])));
  check(own.length === 1, "a picked person does not see their own row");
  await pick(ANN, selected.id, [PICK, NOPICK]);
  const peek = await as(PICK, () => rows(db.query("select user_id from public.story_viewers where story_id = $1", [selected.id])));
  check(peek.length === 1 && peek[0].user_id === PICK, "a picked person sees who else was picked");
});
await expectRefused("…someone else cannot pick", () => pick(PICK, selected.id, [OTHER]), "Only the author");
await expectRefused("…nor pick 51 people", () => pick(ANN, selected.id, Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`)), "up to 50", "22023");
await expectOk("the author always sees their own stories, whatever the audience", async () => {
  check(await sees(ANN, photo.id) && await sees(ANN, campus.id) && await sees(ANN, friends.id) && await sees(ANN, selected.id), "the author lost a story");
});

// --- Views --------------------------------------------------------------------------------------------------------
await expectOk("a view is recorded once per viewer, by mark_story_seen() only", async () => {
  check((await seen(CAMPUS, photo.id)) === true, "the first view was not recorded");
  check((await seen(CAMPUS, photo.id)) === false, "a second view was recorded again");
  check((await seen(ANN, photo.id)) === false, "the author's own look counts as a view");
  check((await seen(OTHER, campus.id)) === false, "a view of a story one may not see was recorded");
  check((await seen(BLK, photo.id)) === false, "a blocker's view was recorded");
  const n = await as(ANN, () => one(db.query("select count(*)::int as n from public.story_views where story_id = $1", [photo.id])));
  check(n.n === 1, `views: ${n.n}`);
  try {
    await as(OTHER, () => db.query("insert into public.story_views (story_id, viewer_id) values ($1, $2)", [photo.id, OTHER]));
    throw new Error("a direct insert went through");
  } catch (e) {
    check(/permission denied/.test(e.message), e.message);
  }
});
await expectOk("the author reads every view with who it was; a viewer reads only their own", async () => {
  await seen(OTHER, photo.id);
  const mine = await as(ANN, () => rows(db.query("select viewer_id from public.story_views where story_id = $1 order by created_at", [photo.id])));
  check(mine.length === 2 && mine.some((v) => v.viewer_id === CAMPUS) && mine.some((v) => v.viewer_id === OTHER), JSON.stringify(mine));
  const theirs = await as(CAMPUS, () => rows(db.query("select viewer_id from public.story_views where story_id = $1", [photo.id])));
  check(theirs.length === 1 && theirs[0].viewer_id === CAMPUS, "a viewer sees other viewers");
  const none = await as(FRI, () => rows(db.query("select viewer_id from public.story_views where story_id = $1", [photo.id])));
  check(none.length === 0, "someone who has not looked sees views");
});

// --- Expiry, deletion, the sweep ------------------------------------------------------------------------------------
await expectOk("after 24 hours a story is gone from every reader, its author included; the sweep deletes it a day later", async () => {
  await db.query("update public.stories set expires_at = now() - interval '1 minute' where id = $1", [photo.id]);
  check(!(await sees(CAMPUS, photo.id)) && !(await sees(ANN, photo.id)), "an expired story still shows");
  check((await seen(FRI, photo.id)) === false, "a view of an expired story was recorded");
  check((await one(db.query("select public.stories_sweep(now()) as n"))).n === 0, "the sweep took a story less than a day past its expiry");
  check((await one(db.query("select public.stories_sweep(now() + interval '25 hours') as n"))).n === 1, "the sweep left an old story");
  check((await rows(db.query("select 1 from public.story_views where story_id = $1", [photo.id]))).length === 0, "its views stayed");
});
await expectOk("only the author deletes a story", async () => {
  const r = await as(PICK, () => db.query("delete from public.stories where id = $1 returning id", [selected.id]));
  check(r.rows.length === 0, "someone else deleted it");
  const mine = await as(ANN, () => db.query("delete from public.stories where id = $1 returning id", [selected.id]));
  check(mine.rows.length === 1, "the author could not delete it");
});
await expectOk("the sweep's schedule exists where pg_cron does (nothing to check without it)", async () => {
  const ext = await rows(db.query("select 1 from pg_extension where extname = 'pg_cron'"));
  if (ext.length === 0) return;
  check((await rows(db.query("select 1 from cron.job where jobname = 'stories-sweep'"))).length === 1, "no schedule");
});

// --- Rollback -------------------------------------------------------------------------------------------------------
await expectOk("the rollback removes the tables and functions; the migration applies again", async () => {
  await db.exec(read(ROLLBACK));
  const left = await rows(db.query("select relname from pg_class where relname in ('stories', 'story_viewers', 'story_views') union all select proname from pg_proc where proname in ('can_see_story', 'can_see_story_as', 'set_story_viewers', 'mark_story_seen', 'stories_sweep', 'stories_before_insert')"));
  check(left.length === 0, `left behind: ${left.map((r) => r.relname).join(", ")}`);
  await db.exec(read(MIGRATION));
  await share(ANN, { kind: "photo", image_url: "https://x.example/again.jpg" });
});

done("MIGRATION-58 STORIES");
