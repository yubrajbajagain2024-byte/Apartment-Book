// Checks the two migrations in this folder, which reached the live project from outside this repo (see README.md).
//
//   node supabase/applied-outside-repo/verify.mjs
//     Offline (PGlite, like supabase/tests): this repo's migrations up to 36, then the two files here, then the rest of
//     supabase/migrations, in the order the live project ran them. Says whether everything applies.
//
//   SUPABASE_ACCESS_TOKEN=... node supabase/applied-outside-repo/verify.mjs --live
//     The same, then compares the result with the live project's catalog, read-only (functions with their bodies,
//     columns, constraints, triggers, row-level security policies). A token from `npx supabase login` works:
//     the CLI keeps it in the macOS keychain ("Supabase CLI").
//
// Nothing here writes to the live project, and supabase/migrations is not touched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { postgis } from "@electric-sql/pglite-postgis";

const here = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.resolve(here, "..");
const REF = process.env.SUPABASE_PROJECT_REF ?? "dskbzoqreandwwpxiplh";
const OUTSIDE = ["20261023000000_admin.sql", "20261024000000_moderation_support.sql"];
/** The last migration of this repo the live project had when the two outside ones ran (2026-10-25 15:11 UTC). */
const BEFORE = "20261029000000_push.sql";

const CATALOG = `select json_build_object(
  'functions', (select json_agg(p.oid::regprocedure::text || ' ' || md5(p.prosrc) || case when p.prosecdef then ' definer' else '' end order by 1) from pg_proc p where p.pronamespace = 'public'::regnamespace),
  'columns', (select json_agg(table_name || '.' || column_name || ' ' || data_type || coalesce(' default ' || column_default, '') order by 1) from information_schema.columns where table_schema = 'public'),
  'constraints', (select json_agg(conrelid::regclass::text || ' ' || conname || ' ' || md5(pg_get_constraintdef(oid)) order by 1) from pg_constraint where connamespace = 'public'::regnamespace and contype <> 'n'),
  'triggers', (select json_agg(tgrelid::regclass::text || ' ' || tgname order by 1) from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'storage.%' and tgrelid::regclass::text not like 'auth.%' and tgrelid::regclass::text not like 'realtime.%' and tgrelid::regclass::text not like 'cron.%'),
  'policies', (select json_agg(schemaname || '.' || tablename || ' ' || policyname || ' ' || md5(coalesce(qual, '') || '|' || coalesce(with_check, '')) order by 1) from pg_policies where schemaname in ('public', 'storage') and tablename <> 'buckets')
) as catalog`;

// The same imitation of Supabase as supabase/tests/harness.mjs, plus what the two outside migrations also use:
// auth.users' confirmation and ban columns, auth.mfa_factors, auth.jwt() and the service_role role.
const harness = fs.readFileSync(path.join(supabaseDir, "tests/harness.mjs"), "utf8");
const setup = harness.match(/await db\.exec\(`(create role anon[\s\S]*?)`\);/)?.[1];
if (!setup) throw new Error("Could not read the setup from supabase/tests/harness.mjs");
const db = new PGlite({ extensions: { pgcrypto, postgis } });
await db.exec(setup);
await db.exec(`do $do$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $do$; -- the harness may have made it already
  alter table auth.users add column if not exists email_confirmed_at timestamptz,
    add column if not exists created_at timestamptz not null default now(), add column if not exists banned_until timestamptz;
  create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text, factor_type text);
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;`);

const repo = fs.readdirSync(path.join(supabaseDir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const order = [...repo.filter((f) => f <= BEFORE).map((f) => ["migrations", f]), ...OUTSIDE.map((f) => ["applied-outside-repo", f]), ...repo.filter((f) => f > BEFORE).map((f) => ["migrations", f])];
for (const [folder, file] of order) {
  try {
    await db.exec(fs.readFileSync(path.join(supabaseDir, folder, file), "utf8"));
  } catch (error) {
    console.log(`✗ ${folder}/${file}: ${error.message}`);
    process.exit(1);
  }
}
console.log(`✓ applies offline: ${order.length} migrations (this repo's ${repo.length}, the two outside ones after ${BEFORE})`);
if (!process.argv.includes("--live")) process.exit(0);

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("--live needs SUPABASE_ACCESS_TOKEN");
const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: CATALOG, read_only: true }),
});
if (!response.ok) throw new Error(`live catalog: ${response.status} ${(await response.text()).slice(0, 300)}`);
const live = (await response.json())[0].catalog;
const offline = (await db.query(CATALOG)).rows[0].catalog;
// pgcrypto lives in the extensions schema on Supabase but in public here; the migration tracker exists only live.
const noise = (x) => /^(armor|crypt|dearmor|decrypt|digest|encrypt|gen_|hmac|pgp_|fips_|public\.gen_random_uuid)|^_migrations/.test(x);
let differences = 0;
for (const key of Object.keys(live)) {
  const a = new Set((offline[key] ?? []).filter((x) => !noise(x)));
  const b = new Set((live[key] ?? []).filter((x) => !noise(x)));
  const onlyHere = [...a].filter((x) => !b.has(x));
  const onlyLive = [...b].filter((x) => !a.has(x));
  differences += onlyHere.length + onlyLive.length;
  console.log(`${onlyHere.length + onlyLive.length ? "✗" : "✓"} ${key}: ${a.size} here, ${b.size} live`);
  for (const x of onlyHere.slice(0, 10)) console.log(`    only here: ${x}`);
  for (const x of onlyLive.slice(0, 10)) console.log(`    only live: ${x}`);
}
console.log(differences ? `${differences} differences from the live project` : "✓ the same schema as the live project");
process.exit(differences ? 1 : 0);
