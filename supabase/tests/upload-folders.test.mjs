// Migration 60 (a person's uploads theirs alone to list; a post's photos from, and with, the post) against PGlite: through
// the API every folder of the uploads bucket is read by its uploader alone (anyone else, and signed out, sees nothing;
// own-folder writes still work); a post takes only photos its author uploaded to their own posts folder of this project,
// on the way in and when edited (the server's rows are not checked); a post's photos are deleted through the Storage
// API when the post goes or loses them (a stand-in for pg_net and Vault, as in snaps.test.mjs), never one another post
// or a story still shows, never a file from elsewhere; stories (59) still work; the rollback restores 59 exactly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, ok, fail, expectOk, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";

const NAME = "20261112000200_upload_folders.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261112000200_upload_folders.down.sql";
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

const HOST = "https://proj.supabase.co";
const urlOf = (name, host = HOST) => `${host}/storage/v1/object/public/uploads/${name}`;
const file = async (owner, name) => { await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [name, owner, owner]); return urlOf(name); };
const annPosts = [await file(ANN, `posts/${ANN}/1730000000000-a1.jpg`), await file(ANN, `posts/${ANN}/1730000000001-a2.jpg`), await file(ANN, `posts/${ANN}/1730000000002-a3.jpg`)];
const annApartment = await file(ANN, `apartments/${ANN}/1730000000003-r1.jpg`);
await file(ANN, `avatars/${ANN}/1730000000004-v1.jpg`);
await file(ANN, "buzz/anon/0123456789abcdef.jpg");
const annStory = await file(ANN, `stories/${ANN}/1730000000005-s1.jpg`);
const caraPost = await file(CARA, `posts/${CARA}/1730000000006-c1.jpg`);

const listed = async (who, prefix) => (await (who ? as(who, () => rows(db.query("select name from storage.objects where bucket_id = 'uploads' and name like $1", [`${prefix}%`]))) : asAnon(() => rows(db.query("select name from storage.objects where bucket_id = 'uploads' and name like $1", [`${prefix}%`]))))).length;

// --- The folders ----------------------------------------------------------------------------------------------------------
await expectOk("through the API, a person's folders are listed by that person alone: posts, apartments, avatars, buzz/anon and stories", async () => {
  check((await listed(ANN, "")) === 7, `Ann lists ${await listed(ANN, "")} of her 7 files`);
  check((await listed(CARA, "")) === 1 && (await listed(CARA, `posts/${CARA}/`)) === 1, "Cara does not list exactly her own file");
  for (const prefix of [`posts/${ANN}/`, `apartments/${ANN}/`, `avatars/${ANN}/`, "buzz/anon/", `stories/${ANN}/`]) {
    check((await listed(CARA, prefix)) === 0, `Cara lists ${prefix}`);
    check((await listed(null, prefix)) === 0, `signed out lists ${prefix}`);
  }
});
await expectOk("writing to one's own folders still works; to someone else's it does not; one's own files can still be deleted", async () => {
  await as(ANN, () => db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [`posts/${ANN}/new.jpg`, ANN, ANN]));
  let refused = false;
  try { await as(ANN, () => db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [`posts/${CARA}/new.jpg`, ANN, ANN])); } catch { refused = true; }
  check(refused, "Ann wrote into Cara's folder");
  check((await as(ANN, () => rows(db.query("delete from storage.objects where bucket_id = 'uploads' and name = $1 returning name", [`posts/${ANN}/new.jpg`])))).length === 1, "Ann could not delete her own file");
});

// --- A post's photos on the way in ------------------------------------------------------------------------------------------
const post = (uid, images, extra = "") => as(uid, () => one(db.query(`insert into public.feed_posts (author_id, kind, body, images${extra ? ", " + extra : ""}) values ($1, 'post', 'hi', $2) returning id, images`, [uid, images])));
let first;
await expectOk("a post with photos from the author's own posts folder is created; one with none too", async () => {
  first = await post(ANN, [annPosts[0], annPosts[1]]);
  check(first.images.length === 2, JSON.stringify(first));
  await post(ANN, []);
});
await expectRefused("a photo from someone else's posts folder is refused", () => post(ANN, [caraPost]), "Upload the photo to your post first");
await expectRefused("…from another of the author's folders (apartments, stories)", () => post(ANN, [annPosts[2], annApartment]), "Upload the photo to your post first");
await expectRefused("…from the stories folder", () => post(ANN, [annStory]), "Upload the photo to your post first");
await expectRefused("…on another host", () => post(ANN, [urlOf(`posts/${ANN}/1730000000000-a1.jpg`, "https://tracker.example")]), "Upload the photo to your post first");
await expectRefused("…a file never uploaded, or with a query string", () => post(ANN, [urlOf(`posts/${ANN}/never.jpg`)]), "Upload the photo to your post first");
await expectRefused("…or a way out of the folder", () => post(ANN, [`${annPosts[0]}?x=1`]), "Upload the photo to your post first");
await expectOk("the server (the seeds, the e2e scripts) still writes a post with photos from anywhere", async () => {
  const s = await one(db.query("insert into public.feed_posts (author_id, kind, body, images) values ($1, 'post', 'seed', $2) returning id", [ANN, ["https://picsum.photos/seed/1/800/600"]]));
  check(Boolean(s.id), "not inserted");
});
await expectOk("editing a post: a photo already on it stays accepted; a new one must be the author's own", async () => {
  const r = await as(ANN, () => one(db.query("update public.feed_posts set images = $2 where id = $1 returning images", [first.id, [annPosts[1], annPosts[2]]])));
  check(r.images.length === 2 && r.images[1] === annPosts[2], JSON.stringify(r));
  let refused = false;
  try { await as(ANN, () => db.query("update public.feed_posts set images = $2 where id = $1", [first.id, [annPosts[1], caraPost]])); } catch (e) { refused = e.message.includes("Upload the photo"); }
  check(refused, "Cara's photo was added to Ann's post");
});

// --- A post's photos go with it ---------------------------------------------------------------------------------------------
await expectOk("without pg_net and Vault (as here so far), deleting a post deletes the row and asks nothing", async () => {
  const p = await post(ANN, [annPosts[0]]);
  check((await as(ANN, () => rows(db.query("delete from public.feed_posts where id = $1 returning id", [p.id])))).length === 1, "not deleted");
});
await db.exec(`create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  insert into vault.secrets (name, secret) values ('snaps_project_url', '${HOST}/'), ('snaps_service_key', 'sb_secret_test');
  create schema net;
  create table net.calls (id bigserial primary key, url text, headers jsonb);
  create function net.http_delete(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language sql as $$ insert into net.calls (url, headers) values (url, headers) returning id $$;`);
const calls = async () => rows(db.query("select url, headers from net.calls order by id"));
const asked = async () => (await calls()).map((c) => c.url.split("/uploads/")[1]);
const reset = () => db.query("delete from net.calls");
// The first post still shows a1 and a2's successor: clear the way for the cases below.
await db.query("delete from public.feed_posts where author_id = $1", [ANN]);
await reset();
await expectOk("the author deletes a post: each of its photos is deleted through the Storage API (the new key as the apikey only)", async () => {
  const p = await post(ANN, [annPosts[0], annPosts[1]]);
  await as(ANN, () => db.query("delete from public.feed_posts where id = $1", [p.id]));
  const c = await calls();
  check(c.length === 2 && (await asked()).join(" ") === `posts/${ANN}/1730000000000-a1.jpg posts/${ANN}/1730000000001-a2.jpg` && JSON.stringify(c[0].headers) === JSON.stringify({ apikey: "sb_secret_test" }), JSON.stringify(c));
});
await expectOk("a photo taken out of a post in an edit is deleted; the ones kept are not", async () => {
  await reset();
  const p = await post(ANN, [annPosts[0], annPosts[1]]);
  await as(ANN, () => db.query("update public.feed_posts set images = $2 where id = $1", [p.id, [annPosts[1]]]));
  check((await asked()).join(" ") === `posts/${ANN}/1730000000000-a1.jpg`, JSON.stringify(await asked()));
  await as(ANN, () => db.query("delete from public.feed_posts where id = $1", [p.id]));
});
await expectOk("a photo two posts show stays until the last of them goes; one a story shows stays", async () => {
  await reset();
  const a = await post(ANN, [annPosts[0]]);
  const b = await post(ANN, [annPosts[0]]);
  await as(ANN, () => db.query("delete from public.feed_posts where id = $1", [a.id]));
  check((await calls()).length === 0, "deleted while another post shows it");
  await as(ANN, () => db.query("delete from public.feed_posts where id = $1", [b.id]));
  check((await asked()).join(" ") === `posts/${ANN}/1730000000000-a1.jpg`, "not deleted with the last post");
});
await expectOk("a rolled-back delete asks nothing; a legacy service_role key goes in both headers", async () => {
  await db.query("update vault.secrets set secret = 'eyJlegacy' where name = 'snaps_service_key'");
  await reset();
  const p = await post(ANN, [annPosts[2]]);
  await db.exec("begin");
  await db.query("delete from public.feed_posts where id = $1", [p.id]);
  await db.exec("rollback");
  check((await calls()).length === 0, "a rolled-back delete left a request");
  await as(ANN, () => db.query("delete from public.feed_posts where id = $1", [p.id]));
  const c = await calls();
  check(c.length === 1 && c[0].headers.Authorization === "Bearer eyJlegacy" && c[0].headers.apikey === "eyJlegacy", JSON.stringify(c));
});
await expectOk("a post made before this rule (a photo from elsewhere, written by the server) asks nothing when it goes; nor does someone else's attempt", async () => {
  await reset();
  const s = await one(db.query("insert into public.feed_posts (author_id, kind, body, images) values ($1, 'post', 'old', $2) returning id", [ANN, ["https://picsum.photos/seed/2/800/600", caraPost]]));
  const mine = await post(ANN, [annPosts[0]]);
  check((await as(CARA, () => rows(db.query("delete from public.feed_posts where id = $1 returning id", [mine.id])))).length === 0, "Cara deleted Ann's post");
  await db.query("delete from public.feed_posts where id = $1", [s.id]);
  check((await calls()).length === 0, JSON.stringify(await calls()));
  await as(ANN, () => db.query("delete from public.feed_posts where id = $1", [mine.id]));
});
await expectOk("an account that goes takes its posts' photos with it", async () => {
  await reset();
  await post(CARA, [caraPost]);
  await db.query("delete from public.profiles where id = $1", [CARA]);
  check((await asked()).join(" ") === `posts/${CARA}/1730000000006-c1.jpg`, JSON.stringify(await asked()));
});

// --- Stories still work (59) ------------------------------------------------------------------------------------------------
await expectOk("a story from the stories folder is still shared and still goes with its photo", async () => {
  await reset();
  const s = await as(ANN, () => one(db.query("insert into public.stories (author_id, kind, image_url) values ($1, 'photo', $2) returning id", [ANN, annStory])));
  await as(ANN, () => db.query("delete from public.stories where id = $1", [s.id]));
  check((await asked()).join(" ") === `stories/${ANN}/1730000000005-s1.jpg`, JSON.stringify(await asked()));
});
await expectOk("the photo check and the triggers' functions are closed to the API", async () => {
  for (const q of ["select public.own_upload_ok('x', $1, 'posts')", "select public.feed_posts_photos_before_write()", "select public.feed_posts_photos_after_change()"]) {
    let refused = false;
    try { await as(ANN, () => db.query(q, q.includes("$1") ? [ANN] : [])); } catch (e) { refused = /permission denied/.test(e.message); }
    check(refused, `a student ran ${q}`);
  }
});

// --- Rollback ---------------------------------------------------------------------------------------------------------------
await expectOk("the rollback restores 59 exactly (schema as a database that never had 60, the folders readable as 59 left them); the migration applies again", async () => {
  await db.exec(read(ROLLBACK));
  const reference = await boot({ upTo: BEFORE });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  const policies = async (d) => (await rows(d.query("select policyname, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'uploads_%' order by 1"))).map((p) => `${p.policyname}: ${p.qual}`).join("\n");
  const same = (await policies(reference.db)) === (await policies(db));
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
  check(same, "the uploads policies were not restored");
  check((await listed(null, `posts/${ANN}/`)) > 0, "posts folders are still closed after the rollback");
  await db.exec(read(MIGRATION));
  check((await listed(null, `posts/${ANN}/`)) === 0, "re-applied, the folders are not closed");
});

done("MIGRATION-60 UPLOAD FOLDERS");
