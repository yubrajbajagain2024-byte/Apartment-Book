// A fingerprint of the public schema, so two databases (or one database before and after a rollback) can be compared
// object by object: every function's definition and grants, every column, constraint, index, trigger, policy and view,
// and the grants on tables and columns, keyed by name. Objects that belong to an extension (PostGIS, pgcrypto) are left
// out. The rollout rehearsals use it offline (PGlite) and on staging (supabase/tests/staging/release-rehearsal.mjs).

export const CATALOG_SQL = `
with ext as (select objid from pg_depend where deptype = 'e')
select jsonb_build_object(
  'function', (select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) || ' acl=' || coalesce(array_to_string(p.proacl, ','), 'default') || ' secdef=' || p.prosecdef::text)
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.oid not in (select objid from ext)),
  'column', (select jsonb_object_agg(c.table_name || '.' || c.column_name, c.data_type || ' default=' || coalesce(c.column_default, '-') || ' null=' || c.is_nullable)
    from information_schema.columns c where c.table_schema = 'public'),
  'constraint', (select jsonb_object_agg(con.conrelid::regclass::text || '.' || con.conname, pg_get_constraintdef(con.oid))
    from pg_constraint con where con.connamespace = 'public'::regnamespace and con.conrelid <> 0),
  'index', (select jsonb_object_agg(i.tablename || '.' || i.indexname, i.indexdef) from pg_indexes i where i.schemaname = 'public'),
  'trigger', (select jsonb_object_agg(t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace),
  'policy', (select jsonb_object_agg(p.tablename || '.' || p.policyname, jsonb_build_object('cmd', p.cmd, 'roles', p.roles, 'permissive', p.permissive, 'using', p.qual, 'check', p.with_check))
    from pg_policies p where p.schemaname = 'public'),
  'table', (select jsonb_object_agg(c.relname, c.relkind::text || ' rls=' || c.relrowsecurity::text || ' acl=' || coalesce(array_to_string(c.relacl, ','), 'default'))
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') and c.oid not in (select objid from ext)),
  'column_grant', (select jsonb_object_agg(c.relname || '.' || a.attname, array_to_string(a.attacl, ','))
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and a.attacl is not null and a.attnum > 0 and not a.attisdropped),
  'view', (select jsonb_object_agg(v.viewname, md5(v.definition)) from pg_views v where v.schemaname = 'public')
) as catalog`;

/** The catalog of a database: { kind: { name: fingerprint } }. `query` runs SQL and resolves to its rows. */
export async function catalog(query) {
  const rows = await query(CATALOG_SQL);
  const c = rows[0].catalog;
  return Object.fromEntries(Object.entries(typeof c === "string" ? JSON.parse(c) : c).map(([k, v]) => [k, v ?? {}]));
}

/** Every difference between two catalogs, as "kind name: what changed", keeping those `keep(kind, name)` accepts. */
export function diffCatalogs(before, after, keep = () => true) {
  const out = [];
  for (const kind of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[kind] ?? {};
    const b = after[kind] ?? {};
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!keep(kind, name)) continue;
      const x = JSON.stringify(a[name]);
      const y = JSON.stringify(b[name]);
      if (x === y) continue;
      out.push(`${kind} ${name}: ${a[name] === undefined ? "added" : b[name] === undefined ? "removed" : "changed"}`);
    }
  }
  return out.sort();
}

/** Is this catalog entry Buzz's (a buzz_* table, or a buzz_* function)? */
export const isBuzz = (kind, name) => (kind === "function" ? /^buzz_/.test(name) : /^buzz_/.test(name.split(".")[0]));

/** The SQL that hashes every row of every Buzz table: one row, { table: md5 }. */
export const BUZZ_DATA_SQL = `
select coalesce(jsonb_object_agg(t.relname, public.__rows_md5(t.relname)), '{}'::jsonb) as data
from pg_class t where t.relnamespace = 'public'::regnamespace and t.relkind = 'r' and t.relname like 'buzz\\_%'`;

/** Installs the helper BUZZ_DATA_SQL needs (dropped again by dropDataHelper). */
export const DATA_HELPER_SQL = `
create or replace function public.__rows_md5(p_table text) returns text language plpgsql as $$
declare v text;
begin
  execute format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) from public.%I t', p_table) into v;
  return v;
end $$`;
export const DROP_DATA_HELPER_SQL = "drop function if exists public.__rows_md5(text)";
