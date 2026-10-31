#!/usr/bin/env node
/**
 * Restores a full backup (scripts/backup.mjs <label> --full) into a Supabase project through the Management API and the
 * Storage API: the accounts (password hashes included, so people sign in as before), every row of every table in
 * public, and every stored file. The schema is not in the backup: the target must already have this repo's migrations,
 * exactly those the backup was taken under (`npm run db:setup`, database-URL mode, from the commit of that time).
 *
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=<target ref> node scripts/restore.mjs <backup folder> [--yes]
 *
 * It replaces what the target holds: every public row, every account and every file go, and the backup's come in.
 * It refuses the production project unless RESTORE_INTO_PRODUCTION=1 is set as well (a disaster is the one reason),
 * and asks for --yes before touching anything. Rehearsed on staging (docs/testing.md); the Management API's role cannot
 * switch constraints off, so tables load in foreign-key order with their user triggers paused, and a foreign key
 * inside a cycle is filled in afterwards.
 *
 * Afterwards, every table has the backup's row count, the accounts and the files are counted, and PostgREST reloads
 * its schema. Vault (the project URL and service key purge_snaps() uses) is the target's own and is left alone.
 */
import fs from "node:fs";
import path from "node:path";

const PRODUCTION = "dskbzoqreandwwpxiplh";
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
const YES = process.argv.includes("--yes");
if (!token || !ref || !dir) {
  console.error("Usage: SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=<target ref> node scripts/restore.mjs <backup folder> --yes");
  process.exit(1);
}
if (ref === PRODUCTION && process.env.RESTORE_INTO_PRODUCTION !== "1") {
  console.error("Refusing to restore into production. Set RESTORE_INTO_PRODUCTION=1 as well if that is really what is wanted.");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
if (!manifest.full) {
  console.error("This backup was taken without --full: it has no password hashes and no files, so it cannot be restored. Take one with --full.");
  process.exit(1);
}
const schema = JSON.parse(fs.readFileSync(path.join(dir, "schema.json"), "utf8"));
const load = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

async function api(method, route, body) {
  const res = await fetch(`https://api.supabase.com${route}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => api("POST", `/v1/projects/${ref}/database/query`, { query });
const one = async (q) => (await sql(q))[0];
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const ident = (name) => `"${name.replace(/"/g, '""')}"`;
const project = await api("GET", `/v1/projects/${ref}`);
console.log(`Restoring ${dir} (${manifest.project_name}, ${manifest.taken_at}) into ${project.name} (${ref})`);

// --- The target must carry the backup's schema -------------------------------------------------------------------------
// Compared table by table and column by column (the backup's rows must fit), not by public._migrations, which is data
// this restore replaces and which a broken target may have lost.
const targetColumns = new Set((await sql("select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public'")).map((r) => r.c));
const wanted = schema.columns.map((c) => `${c.table}.${c.column}`);
const missing = wanted.filter((c) => !targetColumns.has(c));
if (missing.length) {
  console.error(`The target lacks ${missing.length} column(s) the backup has (${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}): bring it to the backup's schema first (npm run db:setup from the commit the backup was taken under; its migrations are listed in schema.json).`);
  process.exit(1);
}
const extra = [...targetColumns].filter((c) => !wanted.includes(c) && Object.keys(manifest.tables).includes(c.split(".")[0]));
if (extra.length) console.log(`  note: the target has ${extra.length} column(s) the backup does not (${extra.slice(0, 6).join(", ")}${extra.length > 6 ? ", …" : ""}); they take their defaults.`);
const counts = async () => Object.fromEntries((await sql(`select ${Object.keys(manifest.tables).map((t) => `(select count(*)::int from public.${ident(t)}) as ${ident(t)}`).join(", ")}`)).map((r) => Object.entries(r))[0]);
const before = await counts();
console.log(`  target now: ${Object.values(before).reduce((a, b) => a + b, 0)} rows, ${(await one("select count(*)::int as n from auth.users")).n} accounts, ${(await one("select count(*)::int as n from storage.objects")).n} files`);
if (!YES) {
  console.error("Add --yes to replace all of it with the backup.");
  process.exit(1);
}

// --- What goes where: columns that can be written, tables in foreign-key order ---------------------------------------------
const columns = {};
for (const c of await sql("select table_schema, table_name, column_name from information_schema.columns where table_schema in ('public', 'auth') and is_generated = 'NEVER' order by table_schema, table_name, ordinal_position")) {
  (columns[`${c.table_schema}.${c.table_name}`] ??= []).push(c.column_name);
}
const fks = await sql(`select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent, a.attname as col, a.attnotnull as required
  from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.confrelid::regclass::text in (select ${ident("tablename")} from pg_tables where schemaname = 'public')`);
const tables = Object.keys(manifest.tables);
const name = (t) => t.replace(/^public\./, "").replace(/^"|"$/g, "");
// Kahn's order; an edge that would close a cycle (a self-reference, or two tables pointing at each other) is filled in later.
const deferred = [];
const edges = fks.map((f) => ({ child: name(f.child), parent: name(f.parent), col: f.col, required: f.required })).filter((e) => tables.includes(e.child) && tables.includes(e.parent));
const order = [];
const left = new Set(tables);
while (left.size) {
  const ready = [...left].filter((t) => !edges.some((e) => e.child === t && e.parent !== t && left.has(e.parent) && !deferred.includes(e)));
  if (ready.length === 0) {
    // Break the cycle at a nullable key; a required one in a cycle cannot be restored this way.
    const e = edges.find((x) => left.has(x.child) && left.has(x.parent) && x.child !== x.parent && !deferred.includes(x) && !x.required);
    if (!e) throw new Error(`a cycle of required foreign keys among ${[...left].join(", ")}`);
    deferred.push(e);
    continue;
  }
  for (const t of ready.sort()) { order.push(t); left.delete(t); }
}
for (const e of edges) if (e.child === e.parent && !deferred.includes(e)) { if (e.required) throw new Error(`${e.child}.${e.col} is a required self-reference`); deferred.push(e); }
const deferredCols = (t) => deferred.filter((e) => e.child === t).map((e) => e.col);

// --- Out with the target's data --------------------------------------------------------------------------------------------
// Every public table's user triggers pause while rows are truncated and loaded (the audit log's append-only trigger would
// refuse the truncate; a notification or a job must not be made twice) and run while the accounts are made, because
// sign-up's triggers on auth.users make each account's profile row the way they always do. A restore that stopped
// halfway leaves them paused, so they are turned on first.
const pause = () => sql(order.map((t) => `alter table public.${ident(t)} disable trigger user`).join("; "));
const resume = () => sql(order.map((t) => `alter table public.${ident(t)} enable trigger user`).join("; "));
await resume();
// What sign-up's triggers on auth.users read: the campuses (the email domain check). Loaded before the accounts, again after.
const AUTH_NEEDS = ["universities"];
const CHUNK = 100;
async function insert(table, rows, cols) {
  const list = cols.map(ident).join(", ");
  for (let i = 0; i < rows.length; i += CHUNK) {
    // "overriding system value": an identity column (generated always) takes the backup's values.
    await sql(`insert into ${table} (${list}) overriding system value select ${list} from jsonb_populate_recordset(null::${table}, ${lit(JSON.stringify(rows.slice(i, i + CHUNK)))}::jsonb)`);
  }
}
const truncateAll = () => sql(`truncate ${tables.map((t) => `public.${ident(t)}`).join(", ")} cascade`);
const loadPublic = async (which) => {
  for (const t of order.filter((x) => which.includes(x))) {
    const rows = load(`data/${t}.json`);
    if (rows.length === 0) continue;
    const later = deferredCols(t);
    await insert(`public.${ident(t)}`, rows, columns[`public.${t}`].filter((c) => c in rows[0] && !later.includes(c)));
  }
};
const keys = await api("GET", `/v1/projects/${ref}/api-keys?reveal=true`);
const service = keys.find((k) => k.name === "service_role")?.api_key;
if (!service) throw new Error("no service_role key: the files cannot be written");
const storage = async (method, route, body, headers = {}) => {
  const res = await fetch(`https://${ref}.supabase.co/storage/v1${route}`, { method, headers: { Authorization: `Bearer ${service}`, apikey: service, ...headers }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};
const existing = await sql("select bucket_id, name from storage.objects where name not like '%/'");
for (const bucket of [...new Set(existing.map((o) => o.bucket_id))]) {
  const names = existing.filter((o) => o.bucket_id === bucket).map((o) => o.name);
  for (let i = 0; i < names.length; i += 100) await storage("DELETE", `/object/${bucket}`, JSON.stringify({ prefixes: names.slice(i, i + 100) }), { "Content-Type": "application/json" });
}
// The accounts go first (their public rows go with them); the public tables are emptied only once the backup's accounts
// are in, because the sign-up trigger on auth.users reads public.universities.
await sql("delete from auth.mfa_factors; delete from auth.identities; delete from auth.users");
await pause();
await truncateAll();
await loadPublic(AUTH_NEEDS);
await resume();
console.log("  ✓ the target's accounts, rows and files removed");

// --- In with the backup's ------------------------------------------------------------------------------------------------
// The accounts: auth.users' own triggers run (they make each account's profile row, replaced below).
for (const t of ["users", "identities", "mfa_factors"]) {
  const rows = load(`auth/${t}.json`);
  await insert(`auth.${ident(t)}`, rows, columns[`auth.${t}`].filter((c) => c in (rows[0] ?? {})));
}
console.log(`  ✓ ${load("auth/users.json").length} accounts`);
await pause();
try {
  await truncateAll();
  // Public tables in foreign-key order.
  await loadPublic(order);
  for (const e of deferred) {
    const rows = load(`data/${e.child}.json`).filter((r) => r[e.col] !== null && r[e.col] !== undefined);
    const pk = (await one(`select string_agg(a.attname, ',') as pk from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey) where i.indrelid = ${lit(`public.${e.child}`)}::regclass and i.indisprimary`)).pk.split(",");
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => Object.fromEntries([...pk, e.col].map((c) => [c, r[c]])));
      await sql(`update public.${ident(e.child)} t set ${ident(e.col)} = s.${ident(e.col)} from jsonb_populate_recordset(null::public.${ident(e.child)}, ${lit(JSON.stringify(chunk))}::jsonb) s where ${pk.map((c) => `t.${ident(c)} = s.${ident(c)}`).join(" and ")}`);
    }
  }
  // Serial columns: their sequences go past the highest value restored.
  for (const s of await sql("select s.relname as seq, t.relname as tbl, a.attname as col from pg_class s join pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i') join pg_class t on t.oid = d.refobjid join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid where s.relkind = 'S' and t.relnamespace = 'public'::regnamespace")) {
    await sql(`select setval(${lit(`public.${s.seq}`)}, coalesce((select max(${ident(s.col)}) from public.${ident(s.tbl)}), 0) + 1, false)`);
  }
} finally {
  await resume();
}
console.log(`  ✓ ${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} rows in ${order.length} tables`);

// The files, through the Storage API (so Storage's own records are right), then their uploader and dates from the backup.
const objects = load("storage-objects.json").filter((o) => o.name && !o.name.endsWith("/"));
for (const o of objects) {
  const bytes = fs.readFileSync(path.join(dir, "files", o.bucket_id, o.name));
  const cache = String(o.metadata?.cacheControl ?? "max-age=3600");
  await storage("POST", `/object/${o.bucket_id}/${o.name.split("/").map(encodeURIComponent).join("/")}`, bytes, { "Content-Type": o.metadata?.mimetype ?? "application/octet-stream", "x-upsert": "true", "cache-control": cache.startsWith("max-age=") ? cache : `max-age=${cache}` });
}
for (let i = 0; i < objects.length; i += CHUNK) {
  const chunk = objects.slice(i, i + CHUNK).map((o) => ({ bucket_id: o.bucket_id, name: o.name, owner: o.owner, owner_id: o.owner_id, created_at: o.created_at, updated_at: o.updated_at }));
  await sql(`update storage.objects t set owner = s.owner, owner_id = s.owner_id, created_at = s.created_at, updated_at = s.updated_at from jsonb_to_recordset(${lit(JSON.stringify(chunk))}::jsonb) as s(bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz, updated_at timestamptz) where t.bucket_id = s.bucket_id and t.name = s.name`);
}
await sql("notify pgrst, 'reload schema'");
console.log(`  ✓ ${objects.length} files`);

// --- Check ----------------------------------------------------------------------------------------------------------------
const after = await counts();
const off = Object.keys(manifest.tables).filter((t) => manifest.tables[t] !== after[t]).map((t) => `${t} ${manifest.tables[t]} → ${after[t]}`);
const accounts = (await one("select count(*)::int as n from auth.users")).n;
const files = (await one("select count(*)::int as n from storage.objects where name not like '%/'")).n;
const good = off.length === 0 && accounts === manifest.accounts && files === objects.length;
console.log(good ? `✓ restored: every table at the backup's row count, ${accounts} accounts, ${files} files` : `✗ differences: ${off.join(", ") || "rows fine"}; accounts ${accounts}/${manifest.accounts}; files ${files}/${objects.length}`);
process.exit(good ? 0 : 1);
