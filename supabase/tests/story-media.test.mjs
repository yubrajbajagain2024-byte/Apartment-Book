// Migration 59 (a story's photo and video) against PGlite: a photo story takes only a file its author uploaded to their
// own stories folder of this project; a video story only the author's own finished upload, with its size and length
// from that record; the stories folder is read through the API by its owner alone (posts' and Buzz's folders keep their
// rules); a story's photo file is deleted through the Storage API when the story goes (a stand-in for pg_net and Vault,
// as in snaps.test.mjs), never someone else's file or one outside the folder; the sweep deletes a story at expiry;
// 58's rules still hold; the rollback restores 58 exactly, and the migration applies again.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, ok, fail, expectOk, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";

const NAME = "20261112000100_story_media.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261112000100_story_media.down.sql";
const BEFORE = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const check = (cond, message) => { if (!cond) throw new Error(message); };
const expectRefused = async (name, fn, message) => {
  try { await fn(); fail(name, "no error"); } catch (e) { if (e.message.includes(message)) ok(name); else fail(name, `${e.code}: ${e.message}`); }
};

const { db, mk, as, asAnon } = await boot({ upTo: BEFORE });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
await expectOk(`the migration applies after ${BEFORE} and re-runs cleanly`, async () => { await db.exec(read(MIGRATION)); await db.exec(read(MIGRATION)); });

const ANN = await mk("ann@txstate.edu", "Ann Author");
const CARA = await mk("cara@txstate.edu", "Cara Campus");
const OLI = await mk("oli@txstate.edu", "Oli Other");

// Files as Storage records them: the uploader is the owner.
const HOST = "https://proj.supabase.co";
const urlOf = (name, host = HOST) => `${host}/storage/v1/object/public/uploads/${name}`;
const file = async (owner, name) => { await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [name, owner, owner]); return urlOf(name); };
const annPhoto = await file(ANN, `stories/${ANN}/1730000000000-a1b2c3.jpg`);
const annPost = await file(ANN, `posts/${ANN}/1730000000001-d4e5f6.jpg`);
const caraPhoto = await file(CARA, `stories/${CARA}/1730000000002-g7h8i9.jpg`);
await file(ANN, `stories/${ANN}/deeper/1730000000003-x.jpg`);

const share = (uid, cols) => {
  const keys = Object.keys(cols);
  return as(uid, () => one(db.query(`insert into public.stories (author_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) returning *`, [uid, ...Object.values(cols)])));
};
const photo = (uid, url, extra = {}) => share(uid, { kind: "photo", image_url: url, image_meta: JSON.stringify({ width: 1080, height: 1920, blur: null }), ...extra });

// --- The photo --------------------------------------------------------------------------------------------------------
let first;
await expectOk("a photo from the author's own stories folder is shared, and 58's stamps still apply (author, 24 hours, verified campus)", async () => {
  first = await photo(ANN, annPhoto, { audience: "campus", expires_at: "2099-01-01T00:00:00Z" });
  check(first.author_id === ANN && first.university_id && Math.abs((Date.parse(first.expires_at) - Date.parse(first.created_at)) / 3600_000 - 24) < 0.01, JSON.stringify(first));
});
await expectRefused("a photo from another folder (the posts folder) is refused", () => photo(ANN, annPost), "Upload the photo to your story first");
await expectRefused("…from someone else's stories folder", () => photo(ANN, caraPhoto), "Upload the photo to your story first");
await expectRefused("…on another host, with the same path", () => photo(ANN, urlOf(`stories/${ANN}/1730000000000-a1b2c3.jpg`, "https://tracker.example")), "Upload the photo to your story first");
await expectRefused("…a file that was never uploaded", () => photo(ANN, urlOf(`stories/${ANN}/never-there.jpg`)), "Upload the photo to your story first");
await expectRefused("…in a subfolder", () => photo(ANN, urlOf(`stories/${ANN}/deeper/1730000000003-x.jpg`)), "Upload the photo to your story first");
await expectRefused("…with a query string or a way out of the folder", () => photo(ANN, `${annPhoto}?x=1`), "Upload the photo to your story first");
await expectRefused("…or a path that climbs out", () => photo(ANN, urlOf(`stories/${ANN}/../${CARA}/1730000000002-g7h8i9.jpg`)), "Upload the photo to your story first");
// The cases below each share and delete stories showing Ann's file; this first one would keep it in use.
await db.query("delete from public.stories where id = $1", [first.id]);

// --- The video --------------------------------------------------------------------------------------------------------
const media = async (owner, playback, status = "ready") => (await one(db.query("insert into public.media (owner_id, provider, playback_id, status, duration_seconds, width, height, poster_url) values ($1, 'mux', $2, $3, 14.5, 1080, 1920, $4) returning id", [owner, playback, status, `https://image.mux.com/${playback}/thumbnail.jpg?time=1`]))).id;
const annVideo = await media(ANN, "annPlayback0001");
await media(CARA, "caraPlayback0001");
await media(ANN, "annPending0001", "processing");
const video = (uid, v) => share(uid, { kind: "video", video: JSON.stringify(v) });
await expectOk("a video that is the author's own finished upload is shared; its size and length come from the record, the chosen cover is kept", async () => {
  const s = await video(ANN, { media_id: "00000000-0000-4000-8000-000000000009", playback_id: "annPlayback0001", poster_url: "https://image.mux.com/annPlayback0001/thumbnail.jpg?time=3.2&width=1080&fit_mode=preserve", width: 1, height: 1, duration_seconds: 1 });
  check(s.video.media_id === annVideo && s.video.width === 1080 && s.video.height === 1920 && Number(s.video.duration_seconds) === 14.5, JSON.stringify(s.video));
  check(s.video.poster_url === "https://image.mux.com/annPlayback0001/thumbnail.jpg?time=3.2&width=1080&fit_mode=preserve", s.video.poster_url);
});
await expectOk("a cover that is not a still of that video is replaced by the record's poster", async () => {
  const s = await video(ANN, { playback_id: "annPlayback0001", poster_url: "https://tracker.example/p.jpg" });
  check(s.video.poster_url === "https://image.mux.com/annPlayback0001/thumbnail.jpg?time=1", s.video.poster_url);
});
await expectRefused("someone else's video is refused", () => video(ANN, { playback_id: "caraPlayback0001" }), "That video isn't ready yet");
await expectRefused("…one still processing", () => video(ANN, { playback_id: "annPending0001" }), "That video isn't ready yet");
await expectRefused("…a playback id that does not exist or is malformed", () => video(ANN, { playback_id: "x/../y" }), "That video isn't ready yet");

// --- The folder -------------------------------------------------------------------------------------------------------
const readable = async (who, name) => (await (who ? as(who, () => rows(db.query("select name from storage.objects where bucket_id = 'uploads' and name = $1", [name]))) : asAnon(() => rows(db.query("select name from storage.objects where bucket_id = 'uploads' and name = $1", [name]))))).length === 1;
await expectOk("through the API, a stories folder is read by its owner alone; posts' files keep their rule", async () => {
  const name = `stories/${ANN}/1730000000000-a1b2c3.jpg`;
  check(await readable(ANN, name), "the owner cannot read her own story photo");
  check(!(await readable(CARA, name)) && !(await readable(OLI, name)) && !(await readable(null, name)), "someone else reads a stories folder");
  check(await readable(CARA, `posts/${ANN}/1730000000001-d4e5f6.jpg`), "posts' files changed rule");
});
await expectOk("writing to one's own stories folder still works; to someone else's it does not", async () => {
  await as(ANN, () => db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [`stories/${ANN}/new.jpg`, ANN, ANN]));
  let refused = false;
  try { await as(ANN, () => db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [`stories/${CARA}/new.jpg`, ANN, ANN])); } catch { refused = true; }
  check(refused, "Ann wrote into Cara's stories folder");
});

// --- The file goes with its story ---------------------------------------------------------------------------------------
await expectOk("without pg_net and Vault (as here so far), deleting a story deletes the row and asks nothing", async () => {
  const s = await photo(ANN, annPhoto);
  check((await as(ANN, () => rows(db.query("delete from public.stories where id = $1 returning id", [s.id])))).length === 1, "not deleted");
});
await db.exec(`create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  insert into vault.secrets (name, secret) values ('snaps_project_url', '${HOST}/'), ('snaps_service_key', 'sb_secret_test');
  create schema net;
  create table net.calls (id bigserial primary key, url text, headers jsonb);
  create function net.http_delete(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language sql as $$ insert into net.calls (url, headers) values (url, headers) returning id $$;`);
const calls = async () => rows(db.query("select url, headers from net.calls order by id"));
await expectOk("with Vault's project address, a photo must be on this project (another Supabase project's address is refused)", async () => {
  await file(ANN, `stories/${ANN}/other-project.jpg`);
  let refused = false;
  try { await photo(ANN, urlOf(`stories/${ANN}/other-project.jpg`, "https://elsewhere.supabase.co")); } catch (e) { refused = e.message.includes("Upload the photo"); }
  check(refused, "another project's address was taken");
});
await expectOk("the author deletes a story: its photo is deleted through the Storage API, with the new key as the apikey only", async () => {
  const s = await photo(ANN, annPhoto);
  await as(ANN, () => db.query("delete from public.stories where id = $1", [s.id]));
  const c = await calls();
  check(c.length === 1 && c[0].url === `${HOST}/storage/v1/object/uploads/stories/${ANN}/1730000000000-a1b2c3.jpg` && JSON.stringify(c[0].headers) === JSON.stringify({ apikey: "sb_secret_test" }), JSON.stringify(c));
});
await expectOk("a delete that is rolled back asks nothing; a legacy service_role key goes in both headers", async () => {
  await db.query("update vault.secrets set secret = 'eyJlegacy' where name = 'snaps_service_key'");
  await db.query("delete from net.calls");
  const s = await photo(ANN, annPhoto);
  await db.exec("begin");
  await db.query("delete from public.stories where id = $1", [s.id]);
  await db.exec("rollback");
  check((await calls()).length === 0, "a rolled-back delete left a request");
  await as(ANN, () => db.query("delete from public.stories where id = $1", [s.id]));
  const c = await calls();
  check(c.length === 1 && c[0].headers.Authorization === "Bearer eyJlegacy" && c[0].headers.apikey === "eyJlegacy", JSON.stringify(c));
});
await expectOk("a video story, a story made before this migration (another folder) and a row whose address points elsewhere ask for no deletion", async () => {
  await db.query("delete from net.calls");
  const v = await video(ANN, { playback_id: "annPlayback0001" });
  // Written as the service (no auth.uid()), which 59 does not check, as rows made before it were not.
  const legacy = await one(db.query("insert into public.stories (author_id, kind, image_url) values ($1, 'photo', $2) returning id", [ANN, annPost]));
  const elsewhere = await one(db.query("insert into public.stories (author_id, kind, image_url) values ($1, 'photo', $2) returning id", [ANN, caraPhoto]));
  await db.query("delete from public.stories where id = any($1::uuid[])", [[v.id, legacy.id, elsewhere.id]]);
  check((await calls()).length === 0, JSON.stringify(await calls()));
});
await expectOk("a file two stories show stays until the last of them goes", async () => {
  await db.query("delete from net.calls");
  const a = await photo(ANN, annPhoto);
  const b = await photo(ANN, annPhoto);
  await as(ANN, () => db.query("delete from public.stories where id = $1", [a.id]));
  check((await calls()).length === 0, "deleted while another story shows it");
  await as(ANN, () => db.query("delete from public.stories where id = $1", [b.id]));
  check((await calls()).length === 1, "not deleted with the last story");
});
await expectOk("only the author deletes; someone else's attempt deletes nothing and asks nothing", async () => {
  await db.query("delete from net.calls");
  const s = await photo(ANN, annPhoto);
  check((await as(CARA, () => rows(db.query("delete from public.stories where id = $1 returning id", [s.id])))).length === 0, "Cara deleted it");
  check((await calls()).length === 0, "a request went out");
  await as(ANN, () => db.query("delete from public.stories where id = $1", [s.id]));
});

// --- The sweep --------------------------------------------------------------------------------------------------------
await expectOk("the sweep deletes a story once it has expired (not a day later) and its photo with it; a live one stays", async () => {
  await db.query("delete from net.calls");
  const gone = await photo(ANN, annPhoto);
  const live = await photo(CARA, caraPhoto);
  await db.query("update public.stories set expires_at = now() - interval '1 minute' where id = $1", [gone.id]);
  check((await one(db.query("select public.stories_sweep(now()) as n"))).n === 1, "the sweep did not take the expired story");
  check((await rows(db.query("select id from public.stories where id = $1", [live.id]))).length === 1, "the sweep took a live story");
  const c = await calls();
  check(c.length === 1 && c[0].url.endsWith(`/stories/${ANN}/1730000000000-a1b2c3.jpg`), JSON.stringify(c));
});
await expectOk("the sweep stays closed to the API", async () => {
  let refused = false;
  try { await as(ANN, () => db.query("select public.stories_sweep(now())")); } catch (e) { refused = /permission denied/.test(e.message); }
  check(refused, "a student ran the sweep");
});
await expectOk("the photo check is closed to the API", async () => {
  let refused = false;
  try { await as(ANN, () => db.query("select public.story_photo_ok($1, $2)", [annPhoto, ANN])); } catch (e) { refused = /permission denied/.test(e.message); }
  check(refused, "a student called story_photo_ok()");
});

// --- Rollback ---------------------------------------------------------------------------------------------------------
await expectOk("the rollback restores 58 exactly (schema as a database that never had 59), the stories folder readable as before; the migration applies again", async () => {
  await db.exec(read(ROLLBACK));
  const reference = await boot({ upTo: BEFORE });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  const policy = async (d) => (await one(d.query("select qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'uploads_public_read'"))).qual;
  const samePolicy = (await policy(reference.db)) === (await policy(db));
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
  check(samePolicy, "the uploads read rule was not restored");
  check(await readable(CARA, `stories/${ANN}/1730000000000-a1b2c3.jpg`), "the stories folder is still closed after the rollback");
  await db.exec(read(MIGRATION));
  check(!(await readable(CARA, `stories/${ANN}/1730000000000-a1b2c3.jpg`)), "re-applied, the folder is not closed");
  await photo(ANN, annPhoto);
});

done("MIGRATION-59 STORY MEDIA");
