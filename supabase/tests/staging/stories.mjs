// Stories (migrations 58 and 59) on the staging project, through the real Supabase stack the app uses: Auth sessions,
// the REST API (PostgREST's embeds by foreign-key name, the policies, the functions), Storage (the move into the stories
// folder, who may list it, the file deleted with its story through pg_net) and pg_cron. Never runs against production:
// it refuses production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/stories.mjs [--restore]
//
// Applies 58 and then 59 when staging does not have them yet (each file, then its public._migrations row, as db:setup
// records them; the earlier pending migrations are left alone, as production's own apply ahead of the release leaves
// them). When staging's Vault lacks the project URL and service key purge_snaps() uses (production has them), it keeps
// staging's own there, as db:setup's token mode does, so the file deletion runs for real. Then six students (confirmed
// txstate.edu accounts made by the admin API, no email sent) do what the app does: a photo uploaded to posts/ and moved
// into the stories folder, a story under each audience, a video story, the tray's read with its embeds, views, the
// picked people, a delete; every refusal the database owes (signed out, updates, the wrong author, the block, a second
// view, more than 50 picked, a photo from another folder, someone else's video). The sweep and its schedule are checked
// as the service. Everything made is deleted at the end and every table's row count compared with the start. With
// --restore, 59 and 58 are rolled back afterwards (their rollback files and the removal of their _migrations rows).
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const RESTORE = process.argv.includes("--restore");
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This test writes, deletes and may roll migrations back: it never runs against production.");

const ROOT = new URL("../../../", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), "utf8");
const MIGRATIONS = ["20261110000100_stories.sql", "20261112000100_story_media.sql"];
// The tray's read, as packages/shared/src/queries/stories.ts sends it.
const STORY_SELECT = "id, author_id, kind, image_url, image_meta, video, audience, created_at, expires_at, author:profiles!stories_author_id_fkey(id, full_name, avatar_url), views:story_views(viewer_id)";

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const anon = createClient(URL_, ANON, opts);

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const val = async (q) => { const row = (await sql(q))[0]; return row ? row[Object.keys(row)[0]] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 500)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const must = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code ?? ""} ${error.message}`); return data; };
const expect = (cond, message) => { if (!cond) throw new Error(message); };
/** The request must fail, with an error matching the pattern (PostgREST reports an RLS refusal as 42501). */
const refused = async (p, pattern) => { const { error } = await p; expect(error && new RegExp(pattern, "i").test(`${error.code ?? ""} ${error.message}`), error ? `other error: ${error.code} ${error.message}` : "it was allowed"); };
async function counts() {
  const tables = (await sql("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).map((r) => r.relname);
  return Object.fromEntries((await sql(`select ${tables.map((t) => `(select count(*)::int from public."${t}") as "${t}"`).join(", ")}`)).map((r) => Object.entries(r))[0]);
}
/** Whether a file is in the uploads bucket, read as the service (Storage's own record). */
const stored = async (path) => (await val(`select count(*)::int from storage.objects where bucket_id = 'uploads' and name = ${lit(path)}`)) === 1;
/** Waits for pg_net to carry out a deletion the database asked for (it sends requests a moment after the commit). */
async function gone(path, ms = 20_000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(1000)) if (!(await stored(path))) return true;
  return false;
}

const run = Date.now().toString(36);
const accounts = [];
const files = [];
console.log(`Staging project ${project.name} (${REF}): Stories (run ${run})${RESTORE ? ", restoring afterwards" : ""}`);

// --- 58 and 59 on staging, as production takes them -----------------------------------------------------------------------
const before = new Set((await sql("select name from public._migrations")).map((r) => r.name));
for (const m of MIGRATIONS) {
  if (before.has(m)) { ok(`${m} is already on staging`); continue; }
  const earlierPending = fs.readdirSync(new URL("supabase/migrations/", ROOT)).filter((f) => f.endsWith(".sql") && f < m && !before.has(f) && !MIGRATIONS.includes(f)).length;
  await check(`${m} applies ahead of the ${earlierPending} earlier migrations still pending, and is recorded`, async () => {
    const t0 = Date.now();
    await sql(read(`supabase/migrations/${m}`));
    await sql(`insert into public._migrations (name) values (${lit(m)}) on conflict do nothing`);
    console.log(`    applied in ${Date.now() - t0} ms`);
  });
}
await sql("notify pgrst, 'reload schema'");
await sleep(4000); // PostgREST reloads its schema cache; the first requests below need the new tables in it.
await check("the objects are there: three tables, the functions, both triggers, five policies, the sweep every ten minutes", async () => {
  const [h] = await sql(`select to_regclass('public.stories') is not null as stories, to_regclass('public.story_viewers') is not null as viewers, to_regclass('public.story_views') is not null as views,
    to_regprocedure('public.can_see_story(uuid, uuid, text, uuid)') is not null as can_see, to_regprocedure('public.set_story_viewers(uuid, uuid[])') is not null as pick, to_regprocedure('public.mark_story_seen(uuid)') is not null as seen,
    to_regprocedure('public.stories_sweep(timestamptz)') is not null as sweep, to_regprocedure('public.story_photo_ok(text, uuid)') is not null as photo_ok,
    exists (select 1 from pg_trigger where tgname = 'stories_before_insert') as before_insert, exists (select 1 from pg_trigger where tgname = 'stories_after_delete') as after_delete,
    (select count(*)::int from pg_policies where tablename in ('stories', 'story_viewers', 'story_views')) = 5 as policies,
    exists (select 1 from cron.job where jobname = 'stories-sweep' and schedule = '*/10 * * * *') as cron`);
  expect(Object.values(h).every((v) => v === true), JSON.stringify(h));
});
if (!(await val("select count(*)::int from vault.secrets where name in ('snaps_project_url', 'snaps_service_key')"))) {
  await check("staging's Vault keeps its own project URL and service key (production has them), as db:setup's token mode does", () => sql(`select public.set_snap_purge_credentials(${lit(URL_)}, ${lit(SERVICE)})`));
}
const start = await counts();

try {
  // --- Students, as the app makes them ------------------------------------------------------------------------------------
  const txstate = await val("select id from public.universities where email_domain = 'txstate.edu'");
  async function student(name) {
    const email = `st-${name}-${run}@txstate.edu`;
    const password = `St-${run}-${Math.random().toString(36).slice(2, 10)}!`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `St ${name[0].toUpperCase()}${name.slice(1)}` } });
    if (error) throw new Error(`${email}: ${error.message}`);
    accounts.push(data.user.id);
    const c = createClient(URL_, ANON, opts);
    const signIn = await c.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`${email}: ${signIn.error.message}`);
    return { id: data.user.id, api: c };
  }
  const [ann, cara, fay, pia, bo, ned] = await Promise.all(["ann", "cara", "fay", "pia", "bo", "ned"].map(student));
  await sql(`update public.profiles set university_id = ${lit(txstate)} where id in (${accounts.map(lit).join(", ")})`);
  await must(fay.api.from("follows").insert({ follower_id: fay.id, followee_id: ann.id }));
  await must(ann.api.from("follows").insert({ follower_id: ann.id, followee_id: fay.id }));
  await must(bo.api.from("blocks").insert({ blocker_id: bo.id, blocked_id: ann.id }));
  const people = { ann, cara, fay, pia, bo, ned };
  /** Who, of the six, gets the story from the tray's read. */
  const audienceOf = async (id) => (await Promise.all(Object.entries(people).map(async ([n, p]) => ((await must(p.api.from("stories").select("id").eq("id", id))).length ? n : null)))).filter(Boolean).join(" ");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  /** A photo as the publish screen sends it ahead: to posts/<you>/…; the app then moves it into the stories folder. */
  async function photoAhead(who, n) {
    const path = `posts/${who.id}/st-${run}-${n}.png`;
    const up = await who.api.storage.from("uploads").upload(path, png, { contentType: "image/png", upsert: false });
    if (up.error) throw new Error(up.error.message);
    files.push(path);
    return path;
  }
  async function storyPhoto(who, n) {
    const from = await photoAhead(who, n);
    const to = `stories/${who.id}/st-${run}-${n}.png`;
    const moved = await who.api.storage.from("uploads").move(from, to);
    if (moved.error) throw new Error(`move: ${moved.error.message}`);
    files.push(to);
    return { path: to, url: who.api.storage.from("uploads").getPublicUrl(to).data.publicUrl };
  }

  // --- The photo, the way the app shares one ------------------------------------------------------------------------------
  let photo;
  await check("the app's path: the photo sent ahead to posts/ moves into the author's stories folder in one request (the posts copy is gone)", async () => {
    photo = await storyPhoto(ann, 1);
    expect((await stored(photo.path)) && !(await stored(`posts/${ann.id}/st-${run}-1.png`)), "the move did not happen");
  });
  await check("the stories folder: listed by its owner alone (not another student, not signed out); its public address loads for whoever has it", async () => {
    const own = await must(ann.api.storage.from("uploads").list(`stories/${ann.id}`));
    const other = await must(cara.api.storage.from("uploads").list(`stories/${ann.id}`));
    const outside = await must(anon.storage.from("uploads").list(`stories/${ann.id}`));
    expect(own.some((f) => f.name === `st-${run}-1.png`) && other.length === 0 && outside.length === 0, `own ${own.length}, other ${other.length}, anon ${outside.length}`);
    expect((await fetch(photo.url)).status === 200, "the public address does not load");
    await refused(cara.api.storage.from("uploads").upload(`stories/${ann.id}/intruder.png`, png, { contentType: "image/png" }), "row-level security|403|Unauthorized");
  });
  const share = (who, audience, extra = {}) => must(who.api.from("stories").insert({ author_id: who.id, kind: "photo", image_url: photo.url, image_meta: { width: 1, height: 1, blur: null }, audience, ...extra }).select("id, author_id, university_id, created_at, expires_at").single());
  const stories = {};
  await check("a campus story: the server stamps the author, the clock, 24 hours and the verified campus, whatever the client sent", async () => {
    const s = await share(ann, "campus", { created_at: "2020-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", university_id: null });
    expect(s.author_id === ann.id && s.university_id === txstate && Date.now() - Date.parse(s.created_at) < 60_000 && Math.abs((Date.parse(s.expires_at) - Date.parse(s.created_at)) / 3600_000 - 24) < 0.01, JSON.stringify(s));
    stories.campus = s.id;
  });
  await check("the other three audiences are accepted; a fifth is not; a story needs its photo or video", async () => {
    stories.global = (await share(ann, "global")).id;
    stories.friends = (await share(ann, "friends")).id;
    stories.selected = (await share(ann, "selected")).id;
    await refused(ann.api.from("stories").insert({ author_id: ann.id, kind: "photo", image_url: photo.url, audience: "nope" }), "stories_audience_check");
    // 59's trigger refuses a video story without its video before the table's own check would.
    await refused(ann.api.from("stories").insert({ author_id: ann.id, kind: "video", audience: "global" }), "stories_media_check|isn't ready yet");
  });
  await check("a photo from anywhere but the author's own stories folder is refused: the posts folder, someone else's story photo, another host, a file never uploaded", async () => {
    const ahead = await photoAhead(ann, 2);
    const caraPhoto = await storyPhoto(cara, 3);
    for (const url of [ann.api.storage.from("uploads").getPublicUrl(ahead).data.publicUrl, caraPhoto.url, photo.url.replace(URL_, "https://tracker.example"), photo.url.replace(`st-${run}-1.png`, "never-there.png")]) {
      await refused(ann.api.from("stories").insert({ author_id: ann.id, kind: "photo", image_url: url, audience: "global" }), "Upload the photo to your story first");
    }
  });
  await check("a video story takes the author's own finished upload, with its size and length from the record; someone else's or an unfinished one is refused", async () => {
    await sql(`insert into public.media (owner_id, provider, playback_id, status, duration_seconds, width, height) values (${lit(ann.id)}, 'mux', ${lit(`stAnn${run}`)}, 'ready', 9.5, 1080, 1920), (${lit(cara.id)}, 'mux', ${lit(`stCara${run}`)}, 'ready', 5, 720, 1280), (${lit(ann.id)}, 'mux', ${lit(`stWait${run}`)}, 'processing', null, null, null)`);
    const v = await must(ann.api.from("stories").insert({ author_id: ann.id, kind: "video", video: { playback_id: `stAnn${run}`, duration_seconds: 1, width: 1, height: 1, poster_url: `https://image.mux.com/stAnn${run}/thumbnail.jpg?time=2` }, audience: "global" }).select("id, video").single());
    expect(v.video.width === 1080 && Number(v.video.duration_seconds) === 9.5 && v.video.poster_url === `https://image.mux.com/stAnn${run}/thumbnail.jpg?time=2`, JSON.stringify(v.video));
    stories.video = v.id;
    for (const pb of [`stCara${run}`, `stWait${run}`]) await refused(ann.api.from("stories").insert({ author_id: ann.id, kind: "video", video: { playback_id: pb }, audience: "global" }), "isn't ready yet");
  });
  await check("Ann picks Pia for the selected story (and cannot pick herself, a blocker, or 51 people)", async () => {
    expect((await must(ann.api.rpc("set_story_viewers", { p_story_id: stories.selected, p_user_ids: [pia.id, ann.id, bo.id] }))) === 1, "the pick count is not 1");
    await refused(ann.api.rpc("set_story_viewers", { p_story_id: stories.selected, p_user_ids: Array.from({ length: 51 }, () => crypto.randomUUID()) }), "50");
    await refused(cara.api.rpc("set_story_viewers", { p_story_id: stories.selected, p_user_ids: [cara.id] }), "42501|author|own");
  });

  // --- Who sees what, through the tray's read ------------------------------------------------------------------------------
  await check("the tray's read works with its embeds (the author by the foreign key's name, the views), and each audience reaches exactly its people, never across the block", async () => {
    const tray = await must(cara.api.from("stories").select(STORY_SELECT).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }));
    const row = tray.find((s) => s.id === stories.campus);
    expect(row && row.author?.id === ann.id && row.author.full_name === "St Ann" && Array.isArray(row.views), JSON.stringify(row));
    expect((await audienceOf(stories.campus)) === "ann cara fay pia ned", `campus: ${await audienceOf(stories.campus)}`);
    expect((await audienceOf(stories.global)) === "ann cara fay pia ned", `global: ${await audienceOf(stories.global)}`);
    expect((await audienceOf(stories.friends)) === "ann fay", `friends: ${await audienceOf(stories.friends)}`);
    expect((await audienceOf(stories.selected)) === "ann pia", `selected: ${await audienceOf(stories.selected)}`);
  });
  await check("signed out, stories are closed; nothing is updated through the API; nobody else writes as Ann", async () => {
    await refused(anon.from("stories").select("id").limit(1), "42501");
    const { data: updated, error: updateError } = await ann.api.from("stories").update({ expires_at: "2099-01-01T00:00:00Z" }).eq("id", stories.global).select("id");
    expect(updateError || !updated?.length, "an update went through");
    const caraOwn = await storyPhoto(cara, 4);
    const theirs = await must(cara.api.from("stories").insert({ author_id: ann.id, kind: "photo", image_url: caraOwn.url, audience: "global" }).select("id, author_id").single());
    expect(theirs.author_id === cara.id, "Cara wrote as Ann");
    stories.cara = theirs.id;
    stories.caraPath = caraOwn.path;
  });
  await check("views: recorded once per viewer by mark_story_seen(), never for the author's own look or across the block; the author counts and lists them, a viewer sees only their own", async () => {
    expect((await must(cara.api.rpc("mark_story_seen", { p_story_id: stories.global }))) === true, "the first view was not recorded");
    expect((await must(cara.api.rpc("mark_story_seen", { p_story_id: stories.global }))) === false, "a second view was recorded");
    expect((await must(ann.api.rpc("mark_story_seen", { p_story_id: stories.global }))) === false, "the author's look was recorded");
    expect((await must(bo.api.rpc("mark_story_seen", { p_story_id: stories.global }))) === false, "a blocked reader's view was recorded");
    expect((await must(ned.api.rpc("mark_story_seen", { p_story_id: stories.friends }))) === false, "a view outside the audience was recorded");
    await must(fay.api.rpc("mark_story_seen", { p_story_id: stories.global }));
    const mine = await must(ann.api.from("story_views").select("created_at, viewer:profiles!story_views_viewer_id_fkey(id, full_name)").eq("story_id", stories.global).order("created_at", { ascending: false }));
    expect(mine.length === 2 && mine[0].viewer.id === fay.id && mine[1].viewer.id === cara.id, JSON.stringify(mine));
    const own = await must(cara.api.from("stories").select("id, views:story_views(viewer_id)").eq("id", stories.global).single());
    expect(own.views.length === 1 && own.views[0].viewer_id === cara.id, JSON.stringify(own.views));
    const none = await must(pia.api.from("stories").select("id, views:story_views(viewer_id)").eq("id", stories.global).single());
    expect(none.views.length === 0, "someone who has not looked sees views");
    await refused(anon.rpc("mark_story_seen", { p_story_id: stories.global }), "42501");
  });
  await check("only the author deletes; the tray no longer shows it; a photo still used by her other stories is not deleted with one of them", async () => {
    expect((await must(cara.api.from("stories").delete().eq("id", stories.friends).select("id"))).length === 0, "Cara deleted Ann's story");
    expect((await must(ann.api.from("stories").delete().eq("id", stories.friends).select("id"))).length === 1, "Ann could not delete her story");
    expect((await audienceOf(stories.friends)) === "", "a deleted story still shows");
    await sleep(3000);
    expect(await stored(photo.path), "the photo three other stories still show was deleted with this one");
  });
  await check("a story's own photo is deleted from Storage once the story goes (through pg_net, a moment after the commit)", async () => {
    const own = await storyPhoto(ann, 5);
    const s = await must(ann.api.from("stories").insert({ author_id: ann.id, kind: "photo", image_url: own.url, audience: "global" }).select("id").single());
    expect(await stored(own.path), "the photo is not there to begin with");
    await must(ann.api.from("stories").delete().eq("id", s.id));
    expect(await gone(own.path), "the photo is still in Storage 20 seconds after its story was deleted");
    expect((await fetch(own.url)).status >= 400, "its public address still loads");
  });
  await check("at expiry a story is gone from every reader; the sweep (the service's job, every ten minutes) deletes it then, and its photo", async () => {
    await sql(`update public.stories set expires_at = now() - interval '1 minute' where id = ${lit(stories.cara)}`);
    expect((await audienceOf(stories.cara)) === "", "an expired story still shows");
    expect((await must(pia.api.rpc("mark_story_seen", { p_story_id: stories.cara }))) === false, "a view of an expired story was recorded");
    expect((await val(`select count(*)::int from public.stories where id = ${lit(stories.cara)}`)) === 1, "gone before the sweep");
    expect((await val("select public.stories_sweep(now())")) >= 1, "the sweep left the expired story");
    expect((await val(`select count(*)::int from public.stories where id = ${lit(stories.cara)}`)) === 0, "the sweep left the expired story");
    expect(await gone(stories.caraPath), "the expired story's photo is still in Storage");
    await refused(ann.api.rpc("stories_sweep", { p_now: new Date().toISOString() }), "42501|PGRST202");
  });
} catch (e) {
  fail("the run stopped", e);
} finally {
  // --- cleanup ----------------------------------------------------------------------------------------------------------------
  if (files.length) await admin.storage.from("uploads").remove(files);
  for (const id of accounts) { const { error } = await admin.auth.admin.deleteUser(id); if (error) fail(`delete account ${id}`, error); }
  await check("every table has its starting row count again, and no file of the run is left (media_jobs aside: staging's video pipeline writes it meanwhile)", async () => {
    const now = await counts();
    const off = Object.keys({ ...start, ...now }).filter((t) => t !== "media_jobs" && start[t] !== now[t]).map((t) => `${t} ${start[t]} -> ${now[t]}`);
    expect(off.length === 0, off.join(", "));
    const left = await val(`select count(*)::int from storage.objects where bucket_id = 'uploads' and name like ${lit(`%st-${run}-%`)}`);
    expect(left === 0, `${left} files left`);
  });
}

if (RESTORE) {
  await check("59 and 58 rolled back, newest first (production's state before them)", async () => {
    for (const m of [...MIGRATIONS].reverse()) {
      await sql(read(`supabase/rollbacks/${m.replace(/\.sql$/, ".down.sql")}`));
      await sql(`delete from public._migrations where name = ${lit(m)}`);
    }
    const left = await sql("select relname as name from pg_class where relname in ('stories', 'story_viewers', 'story_views') union all select proname from pg_proc where proname in ('can_see_story', 'can_see_story_as', 'set_story_viewers', 'mark_story_seen', 'stories_sweep', 'stories_before_insert', 'stories_after_delete', 'story_photo_ok') union all select jobname from cron.job where jobname = 'stories-sweep'");
    expect(left.length === 0, `left behind: ${left.map((r) => r.name).join(", ")}`);
  });
}

console.log(`${failures ? "✗" : "✓"} stories on staging: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
