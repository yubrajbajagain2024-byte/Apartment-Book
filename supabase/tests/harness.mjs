// Offline SQL test harness: runs every migration + the seed in PGlite (Postgres in
// WebAssembly, with PostGIS) behind a minimal imitation of Supabase's auth/storage
// schemas. Usage: node supabase/tests/<file>.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { postgis } from "@electric-sql/pglite-postgis";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const read = (f) => fs.readFileSync(path.join(SUPABASE_DIR, f), "utf8");

/**
 * The migrations that reached production from outside this repo (supabase/applied-outside-repo), each group after the
 * last repo migration production had when it ran. boot({ live: true }) applies them there, which is production's order.
 */
export const OUTSIDE_MIGRATIONS = [
  { after: "20261029000000_push.sql", files: ["20261023000000_admin.sql", "20261024000000_moderation_support.sql"] }, // 2026-10-25 15:11 UTC
  { after: "20261102000000_presence_channel_join.sql", files: ["20261103100000_admin_dashboard.sql", "20261103100100_hardening.sql"] }, // 22:31 UTC
];

/**
 * boot({ live: true }) applies them in production's order; boot({ upTo: "20261024000000_x.sql" }) stops after that migration;
 * boot({ skip: ["20261105000000_x.sql"] }) leaves those out (a migration applied to production ahead of others).
 */
export async function boot(opts = {}) {
  const db = new PGlite({ extensions: { pgcrypto, postgis } });
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create schema storage; create schema extensions;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb, email_confirmed_at timestamptz, created_at timestamptz not null default now(), banned_until timestamptz, invited_at timestamptz, last_sign_in_at timestamptz);
    create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, friendly_name text, factor_type text not null default 'totp', status text not null default 'unverified', created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text); alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;
    create publication supabase_realtime; grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role; grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
    -- Supabase grants new public tables/functions to the API roles by default; migrations that revoke must win.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant all on all tables in schema auth to service_role;`);
  for (const f of fs.readdirSync(path.join(SUPABASE_DIR, "migrations")).sort()) {
    if (opts.upTo && f > opts.upTo) break;
    if (!opts.skip?.includes(f)) await db.exec(read(`migrations/${f}`));
    if (opts.live) for (const o of OUTSIDE_MIGRATIONS) if (o.after === f) for (const x of o.files) await db.exec(read(`applied-outside-repo/${x}`));
  }
  await db.exec(`grant execute on all functions in schema extensions to anon, authenticated;`);
  await db.exec(read("seed.sql"));
  // Users made with mk() are confirmed; pass { confirmed: false } for a sign-up that has not clicked the email link yet.
  const mk = async (email, name, opts = {}) => (await db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1,$2,$3) returning id", [email, JSON.stringify({ full_name: name }), opts.confirmed === false ? null : new Date()])).rows[0].id;
  // as(uid, fn, { aal: "aal2" }) runs fn as a user whose session passed two-factor authentication. Like Supabase,
  // aal2 implies the account has a verified factor, so one is created in auth.mfa_factors if missing.
  const as = async (uid, fn, claims = {}) => {
    if (claims.aal === "aal2") await db.query("insert into auth.mfa_factors (user_id, status, friendly_name) select $1, 'verified', 'Authenticator app' where not exists (select 1 from auth.mfa_factors where user_id = $1 and status = 'verified')", [uid]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, ...claims })}', false);`);
    try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
  };
  const asAnon = async (fn) => {
    await db.exec(`set role anon; select set_config('request.jwt.claims', '', false);`);
    try { return await fn(); } finally { await db.exec(`reset role;`); }
  };
  // The website's server (write API, Mux webhook) runs as service_role: it bypasses RLS and has no auth.uid().
  const asService = async (fn) => {
    await db.exec(`set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false);`);
    try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
  };
  return { db, mk, as, asAnon, asService };
}

let failures = 0;
export const ok = (n) => console.log(`  ✓ ${n}`);
export const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${e?.message ?? e}`); };
export const expectOk = async (n, fn) => { try { const r = await fn(); ok(n); return r; } catch (e) { fail(n, e); } };
export const expectError = async (n, fn, m) => { try { await fn(); fail(n, "no error"); } catch (e) { if (!m || e.message.includes(m)) ok(n); else fail(n, e.message); } };
export const done = (label) => { console.log(failures ? `${failures} FAILED` : `ALL ${label} CHECKS PASSED`); process.exit(failures ? 1 : 0); };
