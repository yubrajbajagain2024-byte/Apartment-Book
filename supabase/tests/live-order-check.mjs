// The admin migrations against the schema PRODUCTION runs, not just this branch's. Production's history
// differs from step-admin's: main's migrations through 36 (20261029000000_push), then the two admin
// migrations (applied 2026-10-25 15:11 UTC, kept on main in supabase/applied-outside-repo), then main's 37 onwards.
//
// This script takes another branch's tree (default origin/main) into a temporary folder, puts this branch's
// admin migrations at those positions (14 and 15 under the order-preserving names proposed in main's
// supabase/applied-outside-repo/README.md, 16 to 18 after main's newest), uses this branch's harness (it adds
// the auth, MFA and service-role stand-ins the admin migrations need), and runs EVERY suite of both: main's
// own and the five admin suites. Nothing in the repository or any database is changed.
//
//   git fetch origin && node supabase/tests/live-order-check.mjs [ref]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REF = process.argv[2] || "origin/main";
const LIVE_14_15_AFTER = "20261029000000_push.sql";
const PLACEMENT = [
  ["20261023000000_admin.sql", "20261029100000_admin.sql"],
  ["20261024000000_moderation_support.sql", "20261029100100_moderation_support.sql"],
  ["20261103100000_admin_dashboard.sql", "20261103100000_admin_dashboard.sql"],
  ["20261103100100_hardening.sql", "20261103100100_hardening.sql"],
  ["20261103100200_staff_invite_email.sql", "20261103100200_staff_invite_email.sql"],
];
const ADMIN_SUITES = ["admin", "moderation-support", "launch-checklist", "admin-dashboard", "permissions-audit", "staff-invite-email"];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-order-"));
try {
  execFileSync("sh", ["-c", `git archive ${JSON.stringify(REF)} supabase packages package.json | tar -x -C ${JSON.stringify(dir)}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  const mig = path.join(dir, "supabase/migrations");
  const theirs = fs.readdirSync(mig).filter((f) => f.endsWith(".sql")).sort();
  if (!theirs.includes(LIVE_14_15_AFTER)) throw new Error(`${REF} has no ${LIVE_14_15_AFTER}; this check assumes production's history`);
  const newest = theirs.at(-1);
  for (const [, name] of PLACEMENT.slice(2)) if (name <= newest) throw new Error(`${name} does not sort after ${REF}'s newest migration ${newest}; rename it before applying`);
  for (const [from, to] of PLACEMENT) {
    const present = theirs.find((f) => f.replace(/^\d+_/, "") === from.replace(/^\d+_/, ""));
    if (present && present !== to) console.log(`  - ${REF} already has ${present}; using theirs`);
    else fs.copyFileSync(path.join(ROOT, "supabase/migrations", from), path.join(mig, to));
  }
  fs.copyFileSync(path.join(ROOT, "supabase/tests/harness.mjs"), path.join(dir, "supabase/tests/harness.mjs"));
  for (const s of ADMIN_SUITES) {
    let text = fs.readFileSync(path.join(ROOT, `supabase/tests/${s}.test.mjs`), "utf8");
    for (const [from, to] of PLACEMENT) text = text.replaceAll(`migrations/${from}`, `migrations/${to}`);
    fs.writeFileSync(path.join(dir, `supabase/tests/${s}.test.mjs`), text);
  }
  // Their suites may add the same auth stand-ins this harness already has; make those statements idempotent.
  for (const f of fs.readdirSync(path.join(dir, "supabase/tests")).filter((f) => f.endsWith(".test.mjs") && !ADMIN_SUITES.includes(f.replace(".test.mjs", "")))) {
    const p = path.join(dir, "supabase/tests", f);
    const t = fs.readFileSync(p, "utf8")
      .replaceAll("create role service_role nologin;", "do $x$ begin create role service_role nologin; exception when duplicate_object then null; end $x$;")
      .replaceAll("create table auth.mfa_factors (", "create table if not exists auth.mfa_factors (")
      .replaceAll("create function auth.jwt()", "create or replace function auth.jwt()");
    fs.writeFileSync(p, t);
  }

  const suites = fs.readdirSync(path.join(dir, "supabase/tests")).filter((f) => f.endsWith(".test.mjs")).sort();
  console.log(`Live-order check against ${REF} (${theirs.length} of its migrations + 4 admin migrations, ${suites.length} suites)\n`);
  const results = [];
  for (const f of suites) {
    const out = await new Promise((resolve) => {
      const c = spawn(process.execPath, [path.join("supabase/tests", f)], { cwd: dir });
      let o = "";
      c.stdout.on("data", (d) => (o += d));
      c.stderr.on("data", (d) => (o += d));
      c.on("close", (code) => resolve({ code, o }));
    });
    const failed = out.o.split("\n").filter((l) => l.includes("✗"));
    results.push({ f, ok: out.code === 0 });
    console.log(`${out.code === 0 ? "  ✓" : "  ✗"} ${f}${out.code === 0 ? "" : `\n      ${(failed.length ? failed : out.o.split("\n").filter((l) => /error/i.test(l)).slice(0, 2)).slice(0, 4).join("\n      ")}`}`);
  }
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} SUITE(S) FAILED IN LIVE ORDER` : `\nALL ${results.length} SUITES PASS IN LIVE ORDER`);
  process.exitCode = bad ? 1 : 0;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
