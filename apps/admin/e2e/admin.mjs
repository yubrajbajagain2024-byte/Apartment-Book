// Browser check of CampConnect Admin (apps/admin): signed-out gates, robots and the worker endpoint; with test accounts,
// the staff flow with two-factor authentication and every page of the app. Usage: start it (npm run dev -w admin), then:
//   BASE=http://localhost:3001 node apps/admin/e2e/admin.mjs
// Optional accounts (their checks are skipped with a note when unset):
//   ADMIN_E2E_EMAIL + ADMIN_E2E_PASSWORD   a staff account; ADMIN_E2E_TOTP_SECRET is its authenticator key (base32) for the 2FA step.
//                                          An owner or admin also gets Analytics and Business (migration 59) checked: every view
//                                          renders, or says it needs migration 59 or the admin role; a moderator must not see them.
//   E2E_USER_EMAIL + E2E_USER_PASSWORD     an ordinary (non-staff) account, which must land on /no-access
//   VERCEL_BYPASS                          bypass secret when Vercel Deployment Protection guards the deployment
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3001";
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url)); fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0; const errors = []; const notes = [];
const ok = (m) => console.log(`  ✓ ${m}`); const bad = (m, e) => { failures++; console.log(`  ✗ ${m}: ${(e?.message ?? String(e)).split("\n").slice(0, 3).join(" // ").slice(0, 400)}`); };
const note = (m) => { notes.push(m); console.log(`  - ${m}`); };
const step = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };

/** RFC 6238 TOTP as Supabase Auth issues it: base32 secret, 30-second steps, HMAC-SHA-1, 6 digits. */
function totp(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const bytes = []; let bits = 0, value = 0;
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) { value = (value << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 0xff); value &= (1 << bits) - 1; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}

async function login(page, email, password, next = "/") {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`); await page.waitForLoadState("networkidle");
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Log in", exact: true }).click(); await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const expectLogin = (page, next) => { const u = new URL(page.url()); if (u.pathname !== "/login" || u.searchParams.get("next") !== next) throw new Error("url: " + page.url()); };

const browser = await chromium.launch();
// VERCEL_BYPASS: a "Protection Bypass for Automation" secret, when Vercel Deployment Protection is on for the admin project.
const BYPASS = process.env.VERCEL_BYPASS ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS, "x-vercel-set-bypass-cookie": "true" } : undefined;
async function newPage() { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: BYPASS }); const page = await ctx.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); }); return page; }
try {
  const D = await newPage();
  await step("signed out: every page goes to /login with next= pointing back", async () => {
    for (const path of ["/", "/users", "/reports", "/flagged", "/content", "/media", "/staff", "/audit", "/security"]) { await D.goto(BASE + path); await D.waitForURL((u) => u.pathname === "/login"); expectLogin(D, path); }
    await D.waitForLoadState("networkidle"); await D.getByRole("heading", { name: "CampConnect Admin" }).waitFor();
    if (await D.getByText(/create an account/i).count()) throw new Error("a sign-up link is offered");
    await D.screenshot({ path: SHOTS + "admin-01-login.png" });
  });
  await step("robots: everything disallowed, X-Robots-Tag noindex on the login page, nothing cacheable", async () => {
    const robots = await (await D.goto(BASE + "/robots.txt")).text(); if (!/^Disallow:\s*\/\s*$/m.test(robots)) throw new Error("robots.txt: " + robots.replace(/\s+/g, " ").slice(0, 200));
    const res = await D.request.get(BASE + "/login"); const h = res.headers();
    if (!/noindex/.test(h["x-robots-tag"] || "")) throw new Error(`x-robots-tag "${h["x-robots-tag"]}"`);
    // Next.js sets its own Cache-Control on dynamic pages (no-cache in dev, private no-store in production), over the proxy's; either way nothing is cacheable.
    if (!/no-store|no-cache/.test(h["cache-control"] || "")) throw new Error(`cache-control "${h["cache-control"]}"`);
  });
  await step("worker endpoint: refused without the secret (401 or 503), by GET and POST", async () => {
    for (const method of ["get", "post"]) { const r = await D.request[method](BASE + "/api/media/worker"); if (![401, 503].includes(r.status())) throw new Error(`${method} ${r.status()}`); }
    const r = await D.request.get(BASE + "/api/media/worker", { headers: { authorization: "Bearer wrong" } }); if (![401, 503].includes(r.status())) throw new Error(`wrong secret ${r.status()}`);
  });
  await step("/no-access signed out goes to login", async () => { await D.goto(BASE + "/no-access"); await D.waitForURL((u) => u.pathname === "/login"); });
  if (process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD) {
    await step("a student who signs in lands on /no-access and sees no admin shell", async () => {
      const U = await newPage(); await login(U, process.env.E2E_USER_EMAIL, process.env.E2E_USER_PASSWORD);
      await U.waitForURL((u) => u.pathname === "/no-access"); await U.getByText(/not on the team/i).waitFor();
      if (await U.getByText("Audit log").count()) throw new Error("admin navigation shown to a non-staff user");
      await U.goto(BASE + "/reports"); await U.waitForURL((u) => u.pathname === "/no-access" || u.pathname === "/security");
      await U.screenshot({ path: SHOTS + "admin-02-student-no-access.png" }); await U.context().close();
    });
  } else note("non-staff check skipped: set E2E_USER_EMAIL and E2E_USER_PASSWORD (an ordinary account)");
  if (process.env.ADMIN_E2E_EMAIL && process.env.ADMIN_E2E_PASSWORD) {
    await step("staff login lands on /security first: two-factor authentication before anything else", async () => {
      await login(D, process.env.ADMIN_E2E_EMAIL, process.env.ADMIN_E2E_PASSWORD, "/reports");
      await D.waitForURL((u) => u.pathname === "/security"); await D.getByText(/two-factor/i).first().waitFor();
      await D.screenshot({ path: SHOTS + "admin-03-security.png" });
    });
    if (process.env.ADMIN_E2E_TOTP_SECRET) {
      await step("the authenticator code opens the page asked for; every section renders", async () => {
        await D.waitForLoadState("networkidle");
        const code = D.locator("input[name='code']"); if (!(await code.count())) throw new Error("no code field on /security: has this account set up an authenticator yet?");
        const left = 30 - (Math.floor(Date.now() / 1000) % 30); if (left < 4) await D.waitForTimeout(left * 1000 + 300);
        await code.fill(totp(process.env.ADMIN_E2E_TOTP_SECRET)); await code.press("Enter");
        await D.waitForURL((u) => u.pathname === "/reports"); await D.screenshot({ path: SHOTS + "admin-04-reports.png" });
        const pages = [["/", "Overview"], ["/users", "Users"], ["/flagged", "Flagged"], ["/content", "Content"], ["/media", "Media"], ["/staff", "Staff"], ["/audit", "Audit log"]];
        for (const [path, heading] of pages) { await D.goto(BASE + path); await D.getByRole("heading", { name: heading, exact: true }).first().waitFor(); await D.screenshot({ path: SHOTS + `admin-05${path.replace(/\//g, "-") || "-overview"}.png` }); }
      });
      await step("Analytics and Business: shown to owners and admins only, and every view renders", async () => {
        await D.goto(BASE + "/"); await D.waitForLoadState("networkidle");
        const nav = D.getByRole("navigation", { name: "Admin" }).first();
        const shown = await nav.getByRole("link", { name: "Business", exact: true }).count();
        const role = (await D.locator("header").innerText()).toLowerCase();
        if (/moderator/.test(role)) { if (shown) throw new Error("a moderator sees Business"); note("Analytics and Business skipped: this account is a moderator"); return; }
        if (!shown) throw new Error("no Business link for an owner or admin");
        const views = ["/analytics", "/analytics?view=ads", "/analytics?view=revenue&range=90", "/business", "/business/advertisers", "/business/campaigns", "/business/campaigns?status=all",
          "/business/payments", "/business/pricing", "/business/reports", "/business/audit"];
        for (const path of views) {
          const res = await D.goto(BASE + path); await D.waitForLoadState("networkidle");
          const text = await D.locator("main").innerText();
          if (!res || res.status() >= 400 || /Something went wrong|Application error/.test(text)) throw new Error(`${path}: ${res?.status()} ${text.slice(0, 120)}`);
          if (!/needs migration 59|need the UniBuzz admin role|Platform|Overview|Advertisers|Campaigns|Payments|Rate card|reports|Nothing logged yet|When/.test(text)) throw new Error(`${path}: unexpected page ${text.slice(0, 160)}`);
          await D.screenshot({ path: SHOTS + `admin-06${path.replace(/[/?=&]/g, "-")}.png`, fullPage: true });
        }
        const first = D.locator("a[href^='/business/campaigns/']").first();
        await D.goto(BASE + "/business/campaigns?status=all");
        if (await first.count()) { await first.click(); await D.waitForLoadState("networkidle"); if (/Something went wrong/.test(await D.locator("main").innerText())) throw new Error("a campaign page failed"); }
        else note("no campaign to open on this database");
      });
    } else note("two-factor step skipped: set ADMIN_E2E_TOTP_SECRET (the base32 key shown at /security when the authenticator was set up)");
  } else note("staff checks skipped: set ADMIN_E2E_EMAIL and ADMIN_E2E_PASSWORD (a staff account)");
  await step("no browser errors", async () => { const real = errors.filter((e) => !/favicon|DevTools|Failed to load resource.*(mux|picsum)|net::ERR_ABORTED|404|401|503/i.test(e)); if (real.length) throw new Error(real.slice(0, 4).join(" | ")); });
} finally { await browser.close(); if (notes.length) console.log(`\n${notes.length} optional check(s) skipped`); console.log(failures ? `\n${failures} ADMIN APP CHECK(S) FAILED` : "\nALL ADMIN APP CHECKS PASSED"); process.exit(failures ? 1 : 0); }
