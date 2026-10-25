#!/usr/bin/env node
/**
 * Deploy CampConnect Admin (apps/admin) to its OWN Vercel project. The website's project
 * (linked in .vercel/project.json at the repository root) is never read for settings,
 * never changed and never deployed by this script.
 *
 *   vercel login                                   # once, in your terminal (browser approval)
 *   node scripts/deploy-admin.mjs                  # plan: checks everything, changes nothing
 *   node scripts/deploy-admin.mjs --apply          # create/update the project, set env vars, deploy to production
 *
 * What --apply does:
 *   1. Finds or creates the Vercel project ADMIN_PROJECT (default "campconnect-admin") in the
 *      website's team, with Root Directory apps/admin and the Next.js preset.
 *   2. Sets ONLY public variables (production + preview): the Supabase URL and anon key from
 *      apps/admin/.env.local (refused if the key is not the anon/publishable key), the website's
 *      URL for links, and NEXT_PUBLIC_GOOGLE_LOGIN=off. The admin URL itself comes from Vercel's
 *      VERCEL_PROJECT_PRODUCTION_URL, so no guess is needed.
 *   3. Refuses to continue if SUPABASE_SERVICE_ROLE_KEY, MUX_TOKEN_ID, MUX_TOKEN_SECRET or
 *      CRON_SECRET exist on the admin project: the media worker (which moves and deletes files)
 *      stays inert until you add them on purpose. Pass --allow-worker once you have done so.
 *   4. Deploys the committed working tree from the repository root (so the shared package is
 *      included) with VERCEL_ORG_ID/VERCEL_PROJECT_ID pointing at the admin project, then checks
 *      that .vercel/project.json is byte-for-byte unchanged.
 *   5. Probes the production URL: login page, noindex header, worker endpoint disabled (503).
 *
 * Options (environment): ADMIN_PROJECT, MAIN_SITE_URL (default https://apartment-book-vyass.vercel.app),
 * VERCEL_BYPASS (a "Protection Bypass for Automation" secret, only if Deployment Protection is on).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const allowWorker = process.argv.includes("--allow-worker");
const projectName = process.env.ADMIN_PROJECT || "campconnect-admin";
const mainSiteUrl = (process.env.MAIN_SITE_URL || "https://apartment-book-vyass.vercel.app").replace(/\/$/, "");
const WORKER_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "MUX_TOKEN_ID", "MUX_TOKEN_SECRET", "CRON_SECRET"];
const EXPECTED_SUPABASE_HOST = "dskbzoqreandwwpxiplh.supabase.co";

const log = (m) => console.log(m);
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
function die(m) {
  console.error(`\n  ✗ ${m}\n`);
  process.exit(1);
}

/** Run the Vercel CLI; resolves { code, out, err }. Never prompts. */
function vercel(args, { input, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn("vercel", [...args, "--non-interactive", "--no-color"], { cwd: root, env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Authenticated Vercel API call through the CLI. Returns parsed JSON, or null for a 404 when allowed. */
async function api(route, { method = "GET", body, allow404 = false } = {}) {
  const args = ["api", route, "--raw", "-X", method];
  // The CLI does not read a body from stdin reliably ("Invalid JSON"), so it goes through a private temp file.
  let bodyDir;
  if (body !== undefined) {
    bodyDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-admin-"));
    const file = path.join(bodyDir, "body.json");
    fs.writeFileSync(file, JSON.stringify(body), { mode: 0o600 });
    args.push("--input", file);
  }
  let r;
  try {
    r = await vercel(args);
  } finally {
    if (bodyDir) fs.rmSync(bodyDir, { recursive: true, force: true });
  }
  const text = `${r.out}\n${r.err}`;
  if (r.code !== 0) {
    if (allow404 && /\b404\b|not[_ ]found/i.test(text)) return null;
    throw new Error(`${method} ${route} failed: ${text.trim().slice(0, 500)}`);
  }
  try {
    return r.out.trim() ? JSON.parse(r.out) : {};
  } catch {
    throw new Error(`${method} ${route}: unexpected output: ${r.out.slice(0, 300)}`);
  }
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** "anon" | "publishable" | "service_role" | "unknown": decides whether a key may be shipped to browsers. */
function keyKind(key) {
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "service_role";
  const parts = key.split(".");
  if (parts.length !== 3) return "unknown";
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).role ?? "unknown";
  } catch {
    return "unknown";
  }
}

const sha = (file) => (fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing");

async function main() {
  log(`CampConnect Admin deploy (${apply ? "APPLY" : "plan only: nothing will be changed"})\n`);

  // ---- local checks ------------------------------------------------------------------------------
  log("Local");
  const websiteLink = path.join(root, ".vercel/project.json");
  if (!fs.existsSync(websiteLink)) die(".vercel/project.json (the website's link) not found; it tells this script which team to use.");
  const website = JSON.parse(fs.readFileSync(websiteLink, "utf8"));
  const linkHash = sha(websiteLink);
  ok(`team ${website.orgId} (from the website's link; the website project ${website.projectName} is left alone)`);

  const git = await new Promise((resolve) => {
    const c = spawn("git", ["status", "--porcelain"], { cwd: root });
    let o = "";
    c.stdout.on("data", (d) => (o += d));
    c.on("close", () => resolve(o.trim()));
  });
  const branch = await new Promise((resolve) => {
    const c = spawn("git", ["branch", "--show-current"], { cwd: root });
    let o = "";
    c.stdout.on("data", (d) => (o += d));
    c.on("close", () => resolve(o.trim()));
  });
  if (git) die(`the working tree has uncommitted changes; commit them first so the deployment is exactly the branch:\n${git}`);
  ok(`clean working tree on branch ${branch}`);
  if (!fs.existsSync(path.join(root, "apps/admin/package.json"))) die("apps/admin is missing on this branch");

  const localEnv = readEnvFile(path.join(root, "apps/admin/.env.local"));
  const supabaseUrl = localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) die("apps/admin/.env.local needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (npm run db:setup writes it, or copy them from apps/web/.env.local)");
  const host = new URL(supabaseUrl).host;
  if (host !== EXPECTED_SUPABASE_HOST) warn(`Supabase host is ${host}, not ${EXPECTED_SUPABASE_HOST}; continuing with ${host}`);
  const kind = keyKind(anonKey);
  if (kind !== "anon" && kind !== "publishable") die(`NEXT_PUBLIC_SUPABASE_ANON_KEY is a "${kind}" key. Only the anon/publishable key may go into a NEXT_PUBLIC_ variable.`);
  ok(`Supabase ${host} with the ${kind} key`);

  // ---- Vercel ------------------------------------------------------------------------------------
  log("\nVercel");
  const who = await vercel(["whoami"]);
  if (who.code !== 0 || /logged out/i.test(`${who.out}${who.err}`)) die("the Vercel CLI is not logged in. Run `vercel login` in your terminal, approve it in the browser, then run this again.");
  ok(`logged in as ${who.out.trim().split("\n").pop()}`);
  const team = `teamId=${encodeURIComponent(website.orgId)}`;

  let project = await api(`/v9/projects/${encodeURIComponent(projectName)}?${team}`, { allow404: true });
  if (project && project.id === website.projectId) die(`"${projectName}" resolves to the website's project; choose another ADMIN_PROJECT name.`);
  if (!project) {
    if (!apply) {
      ok(`would create project "${projectName}" (Root Directory apps/admin, Next.js)`);
    } else {
      project = await api(`/v11/projects?${team}`, { method: "POST", body: { name: projectName, framework: "nextjs", rootDirectory: "apps/admin" } });
      ok(`created project "${projectName}" (${project.id})`);
    }
  } else {
    ok(`project "${projectName}" exists (${project.id})`);
    if (project.rootDirectory !== "apps/admin" || project.framework !== "nextjs") {
      if (!apply) ok(`would set Root Directory apps/admin and the Next.js preset (now: ${project.rootDirectory ?? "repository root"}, ${project.framework ?? "no preset"})`);
      else {
        project = await api(`/v9/projects/${project.id}?${team}`, { method: "PATCH", body: { rootDirectory: "apps/admin", framework: "nextjs" } });
        ok("Root Directory set to apps/admin");
      }
    }
  }

  // Worker secrets must not be there yet.
  if (project) {
    const env = await api(`/v9/projects/${project.id}/env?${team}`);
    const present = (env.envs ?? []).map((e) => e.key).filter((k) => WORKER_KEYS.includes(k));
    if (present.length && !allowWorker) die(`the admin project already has ${present.join(", ")}. The media worker would run and move/delete files. Remove them, or pass --allow-worker if you approved it.`);
    if (present.length) warn(`worker variables present and allowed (--allow-worker): ${present.join(", ")}`);
    else ok("no worker secrets on the project: the media worker stays disabled");
    const protection = project.ssoProtection ? `on (${project.ssoProtection.deploymentType})` : "off";
    ok(`Deployment Protection: ${protection}`);
  }

  const vars = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey],
    ["NEXT_PUBLIC_MAIN_SITE_URL", mainSiteUrl],
    ["NEXT_PUBLIC_GOOGLE_LOGIN", process.env.GOOGLE_LOGIN === "on" ? "on" : "off"],
  ];
  if (!apply) {
    ok(`would set ${vars.map(([k]) => k).join(", ")} for production and preview`);
    log("\nPlan complete. Nothing was changed. Run again with --apply to create the project and deploy.");
    return;
  }
  // One request per variable: the CLI turns a JSON array body into "Invalid JSON".
  for (const [key, value] of vars) {
    await api(`/v10/projects/${project.id}/env?upsert=true&${team}`, { method: "POST", body: { key, value, type: "encrypted", target: ["production", "preview"] } });
  }
  ok(`set ${vars.map(([k]) => k).join(", ")}`);

  // ---- deploy ------------------------------------------------------------------------------------
  log("\nDeploy (this uploads the repository, minus .vercelignore, and builds apps/admin on Vercel)");
  const deploy = await vercel(["deploy", "--prod", "--yes", "--archive=tgz"], { env: { VERCEL_ORG_ID: website.orgId, VERCEL_PROJECT_ID: project.id } });
  if (sha(websiteLink) !== linkHash) die(".vercel/project.json changed during the deploy; restore it with `git checkout .vercel/project.json` if it is tracked, or re-run `vercel link` for the website.");
  ok("the website's .vercel/project.json is unchanged");
  if (deploy.code !== 0) die(`deploy failed:\n${(deploy.err || deploy.out).trim().slice(-2000)}`);
  const deploymentUrl = (`${deploy.out}\n${deploy.err}`.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g) ?? []).pop();
  ok(`deployed ${deploymentUrl ?? "(URL not printed)"}`);

  const fresh = await api(`/v9/projects/${project.id}?${team}`);
  const prodHost = fresh.targets?.production?.alias?.find((a) => a.endsWith(".vercel.app")) ?? fresh.targets?.production?.alias?.[0];
  const prodUrl = prodHost ? `https://${prodHost}` : deploymentUrl;
  ok(`production URL ${prodUrl}`);

  // ---- probe -------------------------------------------------------------------------------------
  log("\nProbe");
  const headers = process.env.VERCEL_BYPASS ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS } : {};
  const login = await fetch(`${prodUrl}/login`, { headers, redirect: "manual" });
  if (login.status === 401 || login.status === 403) {
    warn(`login page answered ${login.status}: Vercel Deployment Protection is in front of the app (fine for an admin tool). Open it in a browser signed in to Vercel, or set VERCEL_BYPASS for automated checks.`);
  } else {
    if (login.status !== 200) die(`/login answered ${login.status}`);
    if (!/noindex/.test(login.headers.get("x-robots-tag") ?? "")) die("/login has no X-Robots-Tag noindex header");
    ok("/login answers 200 with noindex");
    const page = await fetch(`${prodUrl}/reports`, { headers, redirect: "manual" });
    if (page.status !== 307 || !(page.headers.get("location") ?? "").includes("/login")) die(`/reports signed out answered ${page.status} ${page.headers.get("location")}`);
    ok("signed-out /reports redirects to /login");
    const worker = await fetch(`${prodUrl}/api/media/worker`, { headers });
    if (worker.status !== 503 && !allowWorker) die(`/api/media/worker answered ${worker.status}; expected 503 while CRON_SECRET is unset`);
    ok(`/api/media/worker answers ${worker.status}: the scheduled worker is off`);
  }

  log(`\nDone. Admin app: ${prodUrl}`);
  log("Next: sign in there with the owner account and enrol the authenticator (README → Launch checklist, step 4).");
  log(`Browser check: BASE=${prodUrl} node apps/admin/e2e/admin.mjs`);
}

main().catch((error) => die(error.message));
