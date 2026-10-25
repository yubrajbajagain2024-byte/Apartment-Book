#!/usr/bin/env node
/**
 * One-shot Supabase setup for Apartment Book.
 *
 * Preferred: a personal access token (https://supabase.com/dashboard/account/tokens)
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=abcdefghij node scripts/supabase-setup.mjs
 * It will: run the migration + seed, fetch the API keys, write apps/web/.env.local,
 * and set the auth Site URL / redirect URLs.
 *
 * Alternative (database password only):
 *   SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
 *   node scripts/supabase-setup.mjs
 * It will run the migration + seed. You then fill in apps/web/.env.local yourself.
 *
 * Options: SITE_URL (default http://localhost:3000), SKIP_SEED=1, SKIP_MIGRATION=1,
 *          ADMIN_URL (default http://localhost:3001): public URL of the admin app (apps/admin); its
 *                      /auth/callback is added to the redirect allow-list and apps/admin/.env.local is written
 *          SKIP_ENV=1 (do not rewrite apps/web/.env.local and apps/admin/.env.local; use when pointing auth at production)
 *          DRY_RUN=1 (connect, list which migrations would be applied, change nothing and stop)
 *          SKIP_AUTH=1 (do not touch the auth settings; use when the script only applies a
 *                      migration, so the production Site URL is not overwritten with SITE_URL)
 *          ADMIN_OWNER_EMAIL=you@txstate.edu (make that account the first owner of the private
 *                      /admin section. If it has not signed up yet it is invited and becomes owner
 *                      the moment the address is confirmed. With a token, TOTP two-factor
 *                      authentication is also switched on in Supabase Auth.)
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

const dryRun = process.env.DRY_RUN === "1";

/**
 * Applies the migrations that are not recorded in public._migrations, in name order,
 * each in its own transaction together with its tracking row (all or nothing).
 * Refuses to run when a pending migration is OLDER than the newest applied one: that
 * means the tracking table is incomplete (a file was applied by hand), and re-running
 * an old migration over a newer one can undo it (11-13 recreate what 15 hardens).
 * Returns false when DRY_RUN=1 so the caller stops before touching anything else.
 */
async function applySql(runQuery) {
  if (process.env.SKIP_MIGRATION !== "1") {
    const applied = await appliedMigrations(runQuery);
    const pending = migrations.filter((m) => !applied.has(m.name));
    const newestApplied = migrations.filter((m) => applied.has(m.name)).map((m) => m.name).sort().at(-1);
    const outOfOrder = newestApplied ? pending.filter((m) => m.name < newestApplied) : [];
    for (const m of migrations) if (applied.has(m.name)) done(`${m.name}: already applied`);
    if (outOfOrder.length) {
      throw new Error(
        `refusing to apply ${outOfOrder.map((m) => m.name).join(", ")}: older than ${newestApplied}, which is already applied. ` +
          "The tracking table public._migrations is probably missing rows for files applied by hand. Check which of them really ran, " +
          "insert their names into public._migrations, then run this again. Never re-run an older migration over a newer one.",
      );
    }
    if (dryRun) {
      log(pending.length ? `\nDRY_RUN: would apply, in order:\n${pending.map((m) => `  - ${m.name}`).join("\n")}` : "\nDRY_RUN: nothing to apply.");
      log("DRY_RUN: nothing was changed (no migrations, seed, owner, env files or auth settings).");
      return false;
    }
    for (const m of pending) {
      const name = m.name.replace(/'/g, "''");
      await runQuery(`begin;\n${m.sql}\n;\ninsert into public._migrations (name) values ('${name}') on conflict do nothing;\ncommit;`);
      done(`${m.name}: applied`);
    }
  }
  if (process.env.SKIP_SEED !== "1") {
    await runQuery(seedSql);
    const n = firstRow(await runQuery("select count(*)::int as n from public.universities"))?.n;
    const domains = (await runQuery("select email_domain from public.universities where email_domain is not null order by 1"));
    const list = (Array.isArray(domains) ? domains : domains?.rows ?? []).map((r) => r.email_domain);
    done(`seed applied: ${n} universities; sign-ups allowed from ${list.map((d) => "@" + d).join(", ") || "any domain"}`);
  }
}

/**
 * ADMIN_OWNER_EMAIL: make that account the first owner of the /admin section through
 * migration 14's admin_bootstrap_owner(), which only the database owner may call.
 * Prints owner: added | invited | already owner; any error ends the script with exit 1.
 */
async function bootstrapOwner(runQuery) {
  if (!ownerEmail) return;
  log("\nAdmin owner");
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

/** Rewrites the managed keys and keeps every other line of an existing file (MUX_*, SUPABASE_SERVICE_ROLE_KEY, comments…). */
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
  if (process.env.SKIP_ENV === "1") {
    done("kept existing apps/web/.env.local and apps/admin/.env.local (SKIP_ENV=1; keys not fetched)");
  } else {
    const keys = await api("GET", `/v1/projects/${ref}/api-keys?reveal=true`);
    const anon = keys.find((k) => k.name === "anon") ?? keys.find((k) => k.type === "publishable") ?? keys.find((k) => /publishable/.test(k.name));
    if (!anon?.api_key) throw new Error(`Could not find the anon/publishable key. Keys: ${keys.map((k) => k.name).join(", ")}`);
    writeEnv({ url: `https://${ref}.supabase.co`, anonKey: anon.api_key, siteUrl, adminUrl });
  }

  log("\nAuth settings");
  if (process.env.SKIP_AUTH === "1") {
    done("kept the existing Site URL and redirect URLs (SKIP_AUTH=1)");
  } else {
    const current = await api("GET", `/v1/projects/${ref}/config/auth`);
    const existing = (current.uri_allow_list || "").split(",").map((s) => s.trim()).filter(Boolean);
    // Both apps sign in against this project; each needs its own callback URL allowed.
    const wanted = new Set([...existing, "http://localhost:3000/auth/callback", `${siteUrl}/auth/callback`, "http://localhost:3001/auth/callback", `${adminUrl}/auth/callback`]);
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

  log("\nAll done. Next: npm run dev (website on http://localhost:3000, admin app on http://localhost:3001)");
}

async function withDatabaseUrl() {
  const { default: pg } = await import("pg");
  // sslmode=disable is only for a local rehearsal database (supabase/tests/staging-rehearsal.mjs); Supabase always uses TLS.
  const client = new pg.Client({ connectionString: dbUrl, ssl: /[?&]sslmode=disable\b/.test(dbUrl) ? false : { rejectUnauthorized: false } });
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
