#!/usr/bin/env node
/**
 * A read-only backup of a Supabase project through the Management API, for "take a backup before a production
 * migration" (supabase/CLAUDE.md). It only reads: the project is not changed in any way.
 *
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=<ref> node scripts/backup.mjs <label> [--full]
 *   → ~/CampConnect-backups/<UTC date>-<label>/ (or BACKUP_DIR), readable by the owner only:
 *     schema.json          every function's definition, table, column, constraint, index, trigger, policy, view,
 *                          grant, extension, pg_cron job and storage bucket, and the migrations applied
 *     data/<table>.json    every row of every table in public
 *     auth-users.json      the accounts (no password hashes: nothing in a release changes them)
 *     storage-objects.json the records of the stored files (the files themselves stay in Storage)
 *     manifest.json        when, which project, row counts, and the SHA-256 of every file
 *   and, with --full, what a restore needs as well (scripts/restore.mjs puts it all back into a project):
 *     auth/users.json, auth/identities.json, auth/mfa_factors.json   the accounts whole, password hashes included
 *     files/<bucket>/<path>                                           every stored file, private buckets included
 *
 * It refuses to write into a folder that already exists, so an earlier backup is never overwritten.
 *
 * Without --full it is a snapshot to compare row counts and to recover individual rows by hand. With --full it is the
 * backup that restores (scripts/restore.mjs, rehearsed on staging): the schema comes from this repo's migrations, the
 * rows, the accounts and the files from the folder. A full backup holds students' data and the means to sign in as
 * them: it stays on the owner's Mac (0600), is never committed, and is deleted when no longer needed. Supabase's own
 * daily backups (Pro plan) remain the better path when the organisation has them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const FULL = process.argv.includes("--full");
const label = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!token || !ref || !label || !/^[a-z0-9-]+$/.test(label)) {
  console.error("Usage: SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=<ref> node scripts/backup.mjs <label (a-z, 0-9, -)> [--full]");
  process.exit(1);
}

async function api(method, route, body) {
  const res = await fetch(`https://api.supabase.com${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => api("POST", `/v1/projects/${ref}/database/query`, { query });
const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;

const project = await api("GET", `/v1/projects/${ref}`);
const dir = path.join(process.env.BACKUP_DIR || path.join(os.homedir(), "CampConnect-backups"), `${new Date().toISOString().slice(0, 10)}-${label}`);
if (fs.existsSync(dir)) {
  console.error(`${dir} already exists: pick another label, an earlier backup is never overwritten.`);
  process.exit(1);
}
fs.mkdirSync(path.join(dir, "data"), { recursive: true, mode: 0o700 });
const sums = {};
function save(file, value) {
  const text = JSON.stringify(value, null, 1);
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, file), text, { mode: 0o600 });
  sums[file] = crypto.createHash("sha256").update(text).digest("hex");
}
console.log(`Backing up ${project.name} (${ref}) to ${dir}`);

// One read-only transaction per query; the schema first, so a definition and the rows it governs are close in time.
const schema = (
  await sql(`
with ext as (select objid from pg_depend where deptype = 'e')
select jsonb_build_object(
  'migrations', (select coalesce(jsonb_agg(m order by m.name), '[]'::jsonb) from public._migrations m),
  'extensions', (select jsonb_agg(jsonb_build_object('name', extname, 'version', extversion, 'schema', extnamespace::regnamespace::text) order by extname) from pg_extension),
  'functions', (select jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text, 'definition', pg_get_functiondef(p.oid), 'acl', p.proacl::text[]) order by p.oid::regprocedure::text)
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.oid not in (select objid from ext)),
  'tables', (select jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind::text, 'rls', c.relrowsecurity, 'acl', c.relacl::text[]) order by c.relname)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') and c.oid not in (select objid from ext)),
  'columns', (select jsonb_agg(jsonb_build_object('table', c.table_name, 'column', c.column_name, 'type', c.data_type, 'udt', c.udt_name, 'default', c.column_default, 'nullable', c.is_nullable) order by c.table_name, c.ordinal_position)
    from information_schema.columns c where c.table_schema = 'public'),
  'column_grants', (select jsonb_agg(jsonb_build_object('table', c.relname, 'column', a.attname, 'acl', a.attacl::text[]))
    from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null and a.attnum > 0 and not a.attisdropped),
  'constraints', (select jsonb_agg(jsonb_build_object('table', con.conrelid::regclass::text, 'name', con.conname, 'definition', pg_get_constraintdef(con.oid)))
    from pg_constraint con where con.connamespace = 'public'::regnamespace and con.conrelid <> 0),
  'indexes', (select jsonb_agg(jsonb_build_object('table', i.tablename, 'name', i.indexname, 'definition', i.indexdef)) from pg_indexes i where i.schemaname = 'public'),
  'triggers', (select jsonb_agg(jsonb_build_object('table', t.tgrelid::regclass::text, 'name', t.tgname, 'definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled::text))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace, 'storage'::regnamespace)),
  'policies', (select jsonb_agg(to_jsonb(p)) from pg_policies p where p.schemaname in ('public', 'storage', 'realtime')),
  'views', (select jsonb_agg(jsonb_build_object('name', v.viewname, 'definition', v.definition)) from pg_views v where v.schemaname = 'public'),
  'buckets', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from storage.buckets b)
) as schema`)
)[0].schema;
// pg_cron's jobs, where the extension is installed.
schema.cron_jobs = (await sql("select to_regclass('cron.job') is not null as ok"))[0].ok
  ? (await sql("select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'command', command, 'active', active)), '[]'::jsonb) as jobs from cron.job"))[0].jobs
  : null;
save("schema.json", schema);
console.log(`  ✓ schema: ${schema.functions.length} functions, ${schema.tables.length} tables, ${schema.policies.length} policies, ${schema.migrations.length} migrations recorded`);

const PAGE = 2000;
const counts = {};
for (const { name, kind } of schema.tables.filter((t) => t.kind === "r" || t.kind === "p")) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = (await sql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows from (select * from public.${quoteIdent(name)} order by ctid limit ${PAGE} offset ${offset}) t`))[0].rows;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  counts[name] = rows.length;
  save(`data/${name}.json`, rows);
}
console.log(`  ✓ rows: ${Object.values(counts).reduce((a, b) => a + b, 0)} in ${Object.keys(counts).length} tables`);

const accounts = (await sql(`select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'phone', phone, 'created_at', created_at, 'email_confirmed_at', email_confirmed_at,
  'last_sign_in_at', last_sign_in_at, 'banned_until', banned_until, 'deleted_at', deleted_at, 'raw_user_meta_data', raw_user_meta_data, 'raw_app_meta_data', raw_app_meta_data) order by created_at), '[]'::jsonb) as rows from auth.users`))[0].rows;
save("auth-users.json", accounts);
const objects = (await sql(`select coalesce(jsonb_agg(jsonb_build_object('id', id, 'bucket_id', bucket_id, 'name', name, 'owner', owner, 'owner_id', owner_id, 'created_at', created_at,
  'updated_at', updated_at, 'metadata', metadata) order by created_at), '[]'::jsonb) as rows from storage.objects`))[0].rows;
save("storage-objects.json", objects);
console.log(`  ✓ ${accounts.length} accounts, ${objects.length} storage objects`);

// --full: the accounts whole and every file, read with the project's service key (the Storage API serves private buckets to it).
let files = 0;
if (FULL) {
  for (const t of ["users", "identities", "mfa_factors"]) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = (await sql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows from (select * from auth.${t} order by created_at, id limit ${PAGE} offset ${offset}) t`))[0].rows;
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    save(`auth/${t}.json`, rows);
  }
  const keys = await api("GET", `/v1/projects/${ref}/api-keys?reveal=true`);
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!service) throw new Error("no service_role key: the files cannot be read");
  for (const o of objects) {
    if (!o.name || o.name.endsWith("/")) continue;
    const res = await fetch(`https://${ref}.supabase.co/storage/v1/object/${o.bucket_id}/${o.name.split("/").map(encodeURIComponent).join("/")}`, { headers: { Authorization: `Bearer ${service}`, apikey: service } });
    if (!res.ok) throw new Error(`file ${o.bucket_id}/${o.name} → ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const file = path.join("files", o.bucket_id, o.name);
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, file), bytes, { mode: 0o600 });
    sums[file] = crypto.createHash("sha256").update(bytes).digest("hex");
    files++;
  }
  console.log(`  ✓ full: the accounts whole, ${files} files`);
}

const manifest = { taken_at: new Date().toISOString(), project: ref, project_name: project.name, full: FULL, tables: counts, accounts: accounts.length, storage_objects: objects.length, files, sha256: sums };
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 1), { mode: 0o600 });
console.log(`  ✓ manifest.json (${Object.keys(sums).length} files). Done: ${dir}`);
