// Migration 38 (Reels like counts) against PGlite, twice: on this repo's migrations alone, where it must change
// nothing, and on the schema the live project has (this repo's migrations with the two in supabase/applied-outside-repo
// after 36, as they ran live), where it must put every like back in reels_feed()'s count and change nothing else.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { postgis } from "@electric-sql/pglite-postgis";
import { boot, read, expectOk, done } from "./harness.mjs";

const MIGRATION = "migrations/20261031000000_reels_feed_like_counts.sql";
const VIDEO = `'[{"media_id":"00000000-0000-4000-8000-000000000001","playback_id":"pb","poster_url":null,"width":1080,"height":1920,"duration_seconds":5}]'::jsonb`;
const fnState = (db) => db.query("select md5(prosrc) as body, prosecdef as definer, proconfig::text as config, proacl::text as acl from pg_proc where oid = 'public.reels_feed(uuid,integer,integer)'::regprocedure").then((r) => r.rows[0]);

// --- This repo's migrations alone ----------------------------------------------------------------------------
{
  const { db, mk, as, asAnon } = await boot();
  const before = await fnState(db);
  await expectOk("repo only: the migration re-runs cleanly", async () => { await db.exec(read(MIGRATION)); await db.exec(read(MIGRATION)); });
  await expectOk("repo only: reels_feed() is left exactly as migration 18 made it (body, rights, settings, grants)", async () => {
    const after = await fnState(db);
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  });
  await expectOk("repo only: the Reels feed still counts every like, private ones too", async () => {
    const A = await mk("ann@txstate.edu", "Ann"), B = await mk("ben@txstate.edu", "Ben"), C = await mk("cat@txstate.edu", "Cat");
    const reel = (await as(A, () => db.query(`insert into public.feed_posts (author_id, kind, body, videos) values ($1, 'reel', 'Tour', ${VIDEO}) returning id`, [A]))).rows[0].id;
    for (const u of [B, C]) await as(u, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post', $1, $2)", [reel, u]));
    const likes = Number((await asAnon(() => db.query("select likes from public.reels_feed() where source_id = $1", [reel]))).rows[0].likes);
    if (likes !== 2) throw new Error(`signed out: ${likes}`);
  });
}

// --- The live schema: this repo's migrations with the two outside ones after 36 ---------------------------
const supabaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harness = fs.readFileSync(path.join(supabaseDir, "tests/harness.mjs"), "utf8");
const db = new PGlite({ extensions: { pgcrypto, postgis } });
await db.exec(harness.match(/await db\.exec\(`(create role anon[\s\S]*?)`\);/)[1]);
// What Supabase has and the harness does not, which the outside migrations use (as in supabase/applied-outside-repo/verify.mjs).
await db.exec(`do $do$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $do$; -- the harness may have made it already
  alter table auth.users add column if not exists email_confirmed_at timestamptz, add column if not exists created_at timestamptz not null default now(), add column if not exists banned_until timestamptz;
  create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text, factor_type text);
  create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;`);
const repo = fs.readdirSync(path.join(supabaseDir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const f of repo.filter((f) => f <= "20261029000000_push.sql")) await db.exec(read(`migrations/${f}`));
for (const f of ["20261023000000_admin.sql", "20261024000000_moderation_support.sql"]) await db.exec(read(`applied-outside-repo/${f}`));
for (const f of repo.filter((f) => f > "20261029000000_push.sql" && f < "20261031000000_reels_feed_like_counts.sql")) await db.exec(read(`migrations/${f}`));
await db.exec("grant execute on all functions in schema extensions to anon, authenticated;");
await db.exec(read("seed.sql"));

const mk = async (email, name) => (await db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2, now()) returning id", [email, JSON.stringify({ full_name: name })])).rows[0].id;
const as = async (uid, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}"}', false);`); try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claims', '', false);"); } };
const asAnon = async (fn) => { await db.exec("set role anon; select set_config('request.jwt.claims', '', false);"); try { return await fn(); } finally { await db.exec("reset role;"); } };
const row = async (fn, id) => (await fn(() => db.query("select likes, liked_by_me from public.reels_feed() where source_id = $1", [id]))).rows[0];
const A = await mk("ann@txstate.edu", "Ann Avery"), B = await mk("ben@txstate.edu", "Ben Brooks"), C = await mk("cat@txstate.edu", "Cat Cruz");
const reel = (await as(A, () => db.query(`insert into public.feed_posts (author_id, kind, body, videos) values ($1, 'reel', 'Tour', ${VIDEO}) returning id`, [A]))).rows[0].id;
for (const u of [B, C]) await as(u, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('post', $1, $2)", [reel, u]));
await db.query("update public.profiles set liked_visibility = 'private' where id = any($1::uuid[])", [[B, C]]);
const before = await fnState(db);

await expectOk("live schema, before: the Reels feed counts only the reader's own like (0 signed out, 1 for a liker)", async () => {
  const anon = await row(asAnon, reel), ben = await row((f) => as(B, f), reel);
  if (Number(anon.likes) !== 0 || Number(ben.likes) !== 1) throw new Error(`signed out ${anon.likes}, Ben ${ben.likes}`);
});
await db.exec(read(MIGRATION));
await expectOk("live schema, after: every like counts, private ones too, for everyone", async () => {
  for (const [who, fn] of [["signed out", asAnon], ["Ann", (f) => as(A, f)], ["Ben", (f) => as(B, f)]]) {
    const r = await row(fn, reel);
    if (Number(r.likes) !== 2) throw new Error(`${who}: ${r.likes}`);
  }
});
await expectOk("live schema, after: liked_by_me is still each reader's own", async () => {
  if (!(await row((f) => as(B, f), reel)).liked_by_me || (await row((f) => as(A, f), reel)).liked_by_me) throw new Error("liked_by_me wrong");
});
await expectOk("live schema, after: still a caller's-rights function with search_path public and the same grants", async () => {
  const after = await fnState(db);
  if (after.definer || after.config !== before.config || after.acl !== before.acl) throw new Error(`${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  if (after.body === before.body) throw new Error("the body did not change");
});
await expectOk("live schema, after: a hidden reel stays out of the feed", async () => {
  await db.exec("set app.moderation = 'on'");
  await db.query("update public.feed_posts set hidden_at = now(), hidden_reason = 'test' where id = $1", [reel]);
  await db.exec("reset app.moderation");
  if (await row(asAnon, reel)) throw new Error("hidden reel listed");
  await db.exec("set app.moderation = 'on'");
  await db.query("update public.feed_posts set hidden_at = null, hidden_reason = null where id = $1", [reel]);
  await db.exec("reset app.moderation");
});
await expectOk("live schema, after: a suspended author's reel stays out of the feed", async () => {
  await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'test suspension')", [A]);
  if (await row(asAnon, reel)) throw new Error("suspended author's reel listed");
  await db.query("update public.account_restrictions set lifted_at = now() where user_id = $1", [A]);
  if (!(await row(asAnon, reel))) throw new Error("the reel did not come back after the suspension ended");
});
await expectOk("live schema: the migration re-runs cleanly and leaves the same function", async () => {
  const once = await fnState(db);
  await db.exec(read(MIGRATION));
  if (JSON.stringify(await fnState(db)) !== JSON.stringify(once)) throw new Error("a re-run changed it");
});
await expectOk("live schema: supabase/rollbacks/…down.sql puts reels_feed() back exactly as it was (body, rights, settings, grants)", async () => {
  await db.exec(read("rollbacks/20261031000000_reels_feed_like_counts.down.sql"));
  const back = await fnState(db);
  if (JSON.stringify(back) !== JSON.stringify(before)) throw new Error(`${JSON.stringify(before)} -> ${JSON.stringify(back)}`);
  if (Number((await row(asAnon, reel)).likes) !== 0) throw new Error("the old count did not come back");
  await db.exec(read(MIGRATION));
  if (Number((await row(asAnon, reel)).likes) !== 2) throw new Error("re-applying after the rollback did not fix it again");
});
await expectOk("live schema: the rest of the chain after it still applies", async () => {
  for (const f of repo.filter((f) => f > "20261031000000_reels_feed_like_counts.sql")) await db.exec(read(`migrations/${f}`));
});

done("MIGRATION-38 REELS LIKE COUNTS");
