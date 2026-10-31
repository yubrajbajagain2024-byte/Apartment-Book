#!/usr/bin/env node
/**
 * One-shot Supabase setup for UniBuzz.
 *
 * Preferred: a personal access token (https://supabase.com/dashboard/account/tokens)
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=abcdefghij node scripts/supabase-setup.mjs
 * It will: run the migration + seed, fetch the API keys, write apps/web/.env.local and apps/admin/.env.local,
 * keep the project URL and service key in Vault for purge_snaps() (migration 28),
 * and set the auth Site URL / redirect URLs.
 *
 * Alternative (database password only):
 *   SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
 *   node scripts/supabase-setup.mjs
 * It will run the migration + seed. You then fill in apps/web/.env.local yourself.
 *
 * Options: SITE_URL (default http://localhost:3000), BUSINESS_SITE_URL (the business portal's own address, e.g.
 *          https://business.<your domain>: its /auth/callback is allowed too), SKIP_SEED=1, SKIP_MIGRATION=1,
 *          ADMIN_URL (default http://localhost:3001): the public URL of CampConnect Admin (apps/admin); its /auth/**
 *                      is added to the redirect allow-list and apps/admin/.env.local is written next to the website's
 *          SKIP_ENV=1 (do not rewrite apps/web/.env.local and apps/admin/.env.local; use when pointing auth at production)
 *          SKIP_AUTH=1 (do not touch the auth settings; use when the script only applies a migration, so the
 *                      production Site URL is not overwritten with SITE_URL)
 *          DRY_RUN=1 (connect, list which migrations would be applied, change nothing and stop)
 *          ALLOW_OUT_OF_ORDER=1 (see below)
 *          ADMIN_OWNER_EMAIL=you@txstate.edu (make that account the first owner of CampConnect Admin through
 *                      migration 14's admin_bootstrap_owner(), which only the database owner may call. If it has not
 *                      signed up yet it is invited and becomes owner the moment the address is confirmed. With a
 *                      token, TOTP two-factor authentication is also switched on in Supabase Auth.)
 *
 * Safeguards (from the step-admin branch):
 *   * Every migration runs in its own transaction together with its public._migrations row: a failing file leaves
 *     nothing behind, neither objects nor a tracking row.
 *   * A pending file OLDER than the newest name in public._migrations is applied only with ALLOW_OUT_OF_ORDER=1.
 *     Usually that means a file applied by hand has no tracking row, and re-running an old migration over a newer one
 *     can undo it (11-13 recreate what CampConnect Admin's 15 hardens): fix the table instead. But it is also
 *     production's real state when a migration is added behind the newest one on purpose, as 44 and 46 were
 *     (docs/migrations.md): then read the dry run, be sure, and pass the override. A dry run warns and lists either way.
 *   * DRY_RUN=1 changes nothing: no migration, seed, owner, Vault, env file or auth setting.
 *
 * First owner on the live project, without touching anything else:
 *   SKIP_ENV=1 SKIP_SEED=1 SKIP_AUTH=1 ADMIN_OWNER_EMAIL=you@txstate.edu \
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=abcdefghij node scripts/supabase-setup.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase/migrations");
const migrations = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: fs.readFileSync(path.join(migrationsDir, name), "utf8") }));
const seedSql = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
const envPath = path.join(root, "apps/web/.env.local");
const adminEnvPath = path.join(root, "apps/admin/.env.local");

const token = process.env.SUPABASE_ACCESS_TOKEN;
const dbUrl = process.env.SUPABASE_DB_URL;
const siteUrl = (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const businessSiteUrl = (process.env.BUSINESS_SITE_URL || "").replace(/\/$/, "");
const adminUrl = (process.env.ADMIN_URL || "http://localhost:3001").replace(/\/$/, "");
const ownerEmail = (process.env.ADMIN_OWNER_EMAIL || "").trim();
const API = "https://api.supabase.com";

function log(msg) { console.log(msg); }
function done(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); }

async function api(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = typeof data === "object" && data ? (data.message || data.error || JSON.stringify(data)) : String(data);
    throw new Error(`${method} ${route} → ${res.status}: ${message}`);
  }
  return data;
}

const firstRow = (rows) => (Array.isArray(rows) ? rows[0] : rows?.rows?.[0]);

/** Names of migrations already applied, tracked in public._migrations (created here). */
async function appliedMigrations(runQuery) {
  await runQuery("create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now()); alter table public._migrations enable row level security;");
  const rows = await runQuery("select name from public._migrations order by name");
  const list = (Array.isArray(rows) ? rows : rows?.rows ?? []).map((r) => r.name);
  if (list.length === 0) {
    // Projects set up before migration tracking existed: the first migration is
    // applied when the core tables are present.
    const probe = firstRow(await runQuery("select count(*)::int as n from pg_tables where schemaname = 'public' and tablename in ('apartments','messages','profiles')"));
    if (Number(probe?.n) === 3 && migrations[0]) {
      await runQuery(`insert into public._migrations (name) values ('${migrations[0].name}') on conflict do nothing`);
      list.push(migrations[0].name);
    }
  }
  return new Set(list);
}

/**
 * What applySql() would do, from this repo's migration file names and the names recorded in public._migrations. Pure,
 * so it can be checked offline. `pending`: repo files with no row, in file order. `outside`: recorded names that are
 * no file here (on production, CampConnect Admin's). `newestApplied`: the newest recorded name, file or not: the
 * tracking table is the authority. `outOfOrder`: the pending files older than it.
 */
export function planMigrations(names, applied) {
  const sorted = [...names].sort();
  const pending = sorted.filter((name) => !applied.has(name));
  const outside = [...applied].filter((name) => !names.includes(name)).sort();
  const newestApplied = [...applied].sort().at(-1) ?? null;
  const outOfOrder = newestApplied ? pending.filter((name) => name < newestApplied) : [];
  return { pending, outside, newestApplied, outOfOrder };
}

/**
 * Applies the pending migrations in file order, each in its own transaction together with its tracking row (all or
 * nothing per file). Refuses a pending file older than the newest applied name unless ALLOW_OUT_OF_ORDER=1 (header).
 * Returns false when DRY_RUN=1 so the caller stops before touching anything else.
 */
export async function applySql(runQuery) {
  const dryRun = process.env.DRY_RUN === "1";
  if (process.env.SKIP_MIGRATION !== "1") {
    const applied = await appliedMigrations(runQuery);
    const plan = planMigrations(migrations.map((m) => m.name), applied);
    for (const m of migrations) if (applied.has(m.name)) done(`${m.name}: already applied`);
    if (plan.outside.length) log(`  applied outside this repo (no file here): ${plan.outside.join(", ")}`);
    if (plan.outOfOrder.length) {
      const why =
        `${plan.outOfOrder.join(", ")} would run after ${plan.newestApplied}, which is already applied. Either a file applied by hand has ` +
        "no row in public._migrations (check what really ran, insert its name, run this again; never re-run an older migration over a " +
        "newer one), or a migration was added behind the newest one on purpose, as 44 and 46 were on production (docs/migrations.md).";
      if (process.env.ALLOW_OUT_OF_ORDER === "1") log(`  ! out of order, allowed by ALLOW_OUT_OF_ORDER=1: ${why}`);
      else if (dryRun) log(`  ! out of order; a real run refuses this unless ALLOW_OUT_OF_ORDER=1: ${why}`);
      else throw new Error(`refusing to apply out of order: ${why} Once you are sure it is the second case, run again with ALLOW_OUT_OF_ORDER=1.`);
    }
    if (dryRun) {
      log(plan.pending.length ? `\nDRY_RUN: would apply, in order:\n${plan.pending.map((name) => `  - ${name}`).join("\n")}` : "\nDRY_RUN: nothing to apply.");
      log("DRY_RUN: nothing was changed (no migrations, seed, owner, Vault, env files or auth settings).");
      return false;
    }
    for (const m of migrations) {
      if (!plan.pending.includes(m.name)) continue;
      const name = m.name.replace(/'/g, "''");
      await runQuery(`begin;\n${m.sql}\n;\ninsert into public._migrations (name) values ('${name}') on conflict do nothing;\ncommit;`);
      done(`${m.name}: applied`);
    }
  } else if (dryRun) {
    log("\nDRY_RUN: migrations skipped (SKIP_MIGRATION=1); nothing was changed.");
    return false;
  }
  if (process.env.SKIP_SEED !== "1") {
    await runQuery(seedSql);
    const n = firstRow(await runQuery("select count(*)::int as n from public.universities"))?.n;
    const domains = (await runQuery("select email_domain from public.universities where email_domain is not null order by 1"));
    const list = (Array.isArray(domains) ? domains : domains?.rows ?? []).map((r) => r.email_domain);
    done(`seed applied: ${n} universities; sign-ups allowed from ${list.map((d) => "@" + d).join(", ") || "any domain"}`);
  }
  return true;
}

/**
 * ADMIN_OWNER_EMAIL: make that account the first owner of CampConnect Admin through migration 14's
 * admin_bootstrap_owner(), which only the database owner may call (the function is not on a database built from this
 * repo alone: it came with supabase/applied-outside-repo/). Prints owner: added | invited | already owner.
 */
async function bootstrapOwner(runQuery) {
  if (!ownerEmail) return;
  log("\nCampConnect Admin owner");
  const has = firstRow(await runQuery("select to_regprocedure('public.admin_bootstrap_owner(text)') is not null as ok"))?.ok;
  if (!has) throw new Error("ADMIN_OWNER_EMAIL: this project has no admin_bootstrap_owner(): CampConnect Admin's migration 14 is not applied (supabase/applied-outside-repo/README.md)");
  try {
    const row = firstRow(await runQuery(`select public.admin_bootstrap_owner('${ownerEmail.replace(/'/g, "''")}') as result`));
    const result = row?.result ?? JSON.stringify(row);
    done(`owner: ${result}`);
    if (result === "invited") log(`  ${ownerEmail} has no confirmed account yet; the owner role is claimed when that address confirms its sign-up.`);
    if (result === "added") log(`  ${ownerEmail} can sign in to the admin app now; two-factor setup is asked for at /security.`);
  } catch (error) {
    // Rethrown rather than exiting here: the caller's finally still closes the database connection, then the top-level handler exits 1.
    throw new Error(`could not set the owner: ${error.message}`);
  }
}

const ENV_HEADER = "# Generated by scripts/supabase-setup.mjs. Do not commit this file.";
const MANAGED_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_MAIN_SITE_URL"];

/** Both apps talk to the same project: the website gets its own URL, the admin app its URL plus the website's for links. */
function writeEnv(values) {
  writeEnvFile(envPath, [`NEXT_PUBLIC_SUPABASE_URL=${values.url}`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${values.anonKey}`, `NEXT_PUBLIC_SITE_URL=${values.siteUrl}`]);
  writeEnvFile(adminEnvPath, [
    `NEXT_PUBLIC_SUPABASE_URL=${values.url}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${values.anonKey}`,
    `NEXT_PUBLIC_SITE_URL=${values.adminUrl}`,
    `NEXT_PUBLIC_MAIN_SITE_URL=${values.siteUrl}`,
  ]);
}

/**
 * Rewrites the managed keys and keeps every other line of an existing file: the server-side settings the README asks
 * for (SUPABASE_SERVICE_ROLE_KEY, MUX_*, MODERATION_AI_API_KEY, comments…) must survive a re-run.
 */
function writeEnvFile(filePath, managedLines) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const isManaged = (line) => line.trim() === ENV_HEADER || MANAGED_KEYS.some((key) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(line));
  const preserved = existing.filter((line) => !isManaged(line));
  while (preserved.length && preserved[0].trim() === "") preserved.shift();
  while (preserved.length && preserved[preserved.length - 1].trim() === "") preserved.pop();
  const lines = [ENV_HEADER, ...managedLines, "", ...(preserved.length ? [...preserved, ""] : [])];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"));
  const kept = preserved.filter((line) => line.trim() && !line.trim().startsWith("#")).length;
  done(`wrote ${path.relative(root, filePath)}${kept ? ` (kept ${kept} other setting${kept === 1 ? "" : "s"})` : ""}`);
}

async function withManagementApi() {
  let ref = process.env.SUPABASE_PROJECT_REF;
  const projects = await api("GET", "/v1/projects");
  if (!ref) {
    if (projects.length === 1) ref = projects[0].id;
    else throw new Error(`Set SUPABASE_PROJECT_REF. Your projects: ${projects.map((p) => `${p.name} (${p.id})`).join(", ")}`);
  }
  const project = projects.find((p) => p.id === ref);
  if (!project) throw new Error(`Project ${ref} not found in this account`);
  log(`Project: ${project.name} (${ref}) · region ${project.region} · status ${project.status}`);
  if (project.status !== "ACTIVE_HEALTHY") log("  ! project is not ACTIVE_HEALTHY yet; SQL may fail until it finishes provisioning");

  log("\nDatabase");
  const runQuery = async (query) => api("POST", `/v1/projects/${ref}/database/query`, { query });
  if ((await applySql(runQuery)) === false) return;
  await bootstrapOwner(runQuery);

  log("\nAPI keys");
  const keys = await api("GET", `/v1/projects/${ref}/api-keys?reveal=true`);
  const anon = keys.find((k) => k.name === "anon") ?? keys.find((k) => k.type === "publishable") ?? keys.find((k) => /publishable/.test(k.name));
  if (!anon?.api_key) throw new Error(`Could not find the anon/publishable key. Keys: ${keys.map((k) => k.name).join(", ")}`);
  const url = `https://${ref}.supabase.co`;
  if (process.env.SKIP_ENV === "1") done("kept existing apps/web/.env.local and apps/admin/.env.local (SKIP_ENV=1)");
  else writeEnv({ url, anonKey: anon.api_key, siteUrl, adminUrl });

  // purge_snaps() deletes Snap files through the Storage API (pg_net), which takes the service key: it reads that and
  // the project URL from Vault. Kept there (or refreshed) on every run, so a rotated key is picked up.
  log("\nSnap cleanup");
  const hasSetter = firstRow(await runQuery("select to_regprocedure('public.set_snap_purge_credentials(text,text)') is not null as ok"))?.ok;
  const service = keys.find((k) => k.name === "service_role") ?? keys.find((k) => k.type === "secret");
  if (!hasSetter) log("  ! migration 28 (Snaps) is not applied yet: nothing to set up");
  else if (!service?.api_key) log("  ! no service key found: purge_snaps() cannot delete Snap files until one is kept in Vault");
  else {
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    await runQuery(`select public.set_snap_purge_credentials(${quote(url)}, ${quote(service.api_key)})`);
    done("purge_snaps() can delete Snap files (project URL and service key kept in Vault)");
  }

  log("\nAuth settings");
  if (process.env.SKIP_AUTH === "1") {
    done("kept the existing Site URL and redirect URLs (SKIP_AUTH=1)");
  } else {
    const current = await api("GET", `/v1/projects/${ref}/config/auth`);
    const existing = (current.uri_allow_list || "").split(",").map((s) => s.trim()).filter(Boolean);
    // The business portal on its own host sends its sign-up emails back to that host's /auth/callback. CampConnect
    // Admin signs in against this project too, and its invitation links land on its /auth/confirm: its /auth/** is allowed.
    const wanted = new Set([
      ...existing,
      "http://localhost:3000/auth/callback",
      `${siteUrl}/auth/callback`,
      ...(businessSiteUrl ? [`${businessSiteUrl}/auth/callback`] : []),
      "http://localhost:3001/auth/**",
      `${adminUrl}/auth/**`,
    ]);
    await api("PATCH", `/v1/projects/${ref}/config/auth`, {
      site_url: siteUrl,
      uri_allow_list: [...wanted].join(","),
    });
    done(`site_url = ${siteUrl}`);
    done(`redirect URLs = ${[...wanted].join(", ")}`);
    log(`  email confirmation: ${current.mailer_autoconfirm ? "OFF (sign-ups log in immediately)" : "ON (users must click the email link)"}`);
    log(`  google sign-in: ${current.external_google_enabled ? "enabled" : "not enabled (optional)"}`);
  }

  if (ownerEmail) {
    // Best effort: admin actions need a TOTP code, so the authenticator-app factor must be allowed.
    log("\nTwo-factor authentication");
    try {
      await api("PATCH", `/v1/projects/${ref}/config/auth`, { mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true });
      done("TOTP (authenticator app) enrolment and verification enabled");
    } catch (error) {
      fail(`could not enable TOTP: ${error.message}`);
      log("  Enable it by hand: Supabase dashboard → Authentication → Multi-Factor → TOTP (authenticator app).");
    }
  }

  log("\nAll done. Next: npm run dev (website on http://localhost:3000, CampConnect Admin on http://localhost:3001)");
}

async function withDatabaseUrl() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  log("Connected to the database");
  try {
    const runQuery = async (query) => (await client.query(query)).rows;
    if ((await applySql(runQuery)) === false) return;
    await bootstrapOwner(runQuery);
  } finally {
    await client.end();
  }
  if (!fs.existsSync(envPath)) {
    log(`\nNow copy apps/web/.env.example to apps/web/.env.local and fill in the project URL and anon key.`);
  }
  if (ownerEmail) {
    log("\nTwo-factor authentication: enable TOTP under Authentication → Multi-Factor in the Supabase dashboard (this needs an access token to be done from here).");
  }
  log("\nAll done.");
}

// Run only as a script: the planning functions above are importable for an offline check.
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    if (token) await withManagementApi();
    else if (dbUrl) await withDatabaseUrl();
    else {
      fail("Set SUPABASE_ACCESS_TOKEN (+ SUPABASE_PROJECT_REF) or SUPABASE_DB_URL. See the comment at the top of this file.");
      process.exit(1);
    }
  } catch (error) {
    fail(error.message);
    process.exit(1);
  }
}
