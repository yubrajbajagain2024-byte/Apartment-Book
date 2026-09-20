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

export async function boot() {
  const db = new PGlite({ extensions: { pgcrypto, postgis } });
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth; create schema storage; create schema extensions;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text); alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;
    create publication supabase_realtime; grant usage on schema public, auth, storage, extensions to anon, authenticated; grant all on storage.objects, storage.buckets to anon, authenticated;
    -- Supabase grants new public tables/functions to the API roles by default; migrations that revoke must win.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;`);
  for (const f of fs.readdirSync(path.join(SUPABASE_DIR, "migrations")).sort()) await db.exec(read(`migrations/${f}`));
  await db.exec(`grant execute on all functions in schema extensions to anon, authenticated;`);
  await db.exec(read("seed.sql"));
  const mk = async (email, name) => (await db.query("insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id", [email, JSON.stringify({ full_name: name })])).rows[0].id;
  const as = async (uid, fn) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}"}', false);`);
    try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
  };
  const asAnon = async (fn) => {
    await db.exec(`set role anon; select set_config('request.jwt.claims', '', false);`);
    try { return await fn(); } finally { await db.exec(`reset role;`); }
  };
  return { db, mk, as, asAnon };
}

let failures = 0;
export const ok = (n) => console.log(`  ✓ ${n}`);
export const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${e?.message ?? e}`); };
export const expectOk = async (n, fn) => { try { const r = await fn(); ok(n); return r; } catch (e) { fail(n, e); } };
export const expectError = async (n, fn, m) => { try { await fn(); fail(n, "no error"); } catch (e) { if (!m || e.message.includes(m)) ok(n); else fail(n, e.message); } };
export const done = (label) => { console.log(failures ? `${failures} FAILED` : `ALL ${label} CHECKS PASSED`); process.exit(failures ? 1 : 0); };
