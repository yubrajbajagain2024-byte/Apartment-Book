// Every page a student, a business team and the UniBuzz team use, opened in a browser against whatever database the
// site is pointed at: the page answers, renders without an error screen, and the browser logs no error. Used by the
// release rehearsal on staging (supabase/tests/staging/release-rehearsal.mjs) before the release, after it and after its
// rollback, to show which pages work with which database state. It also fails if the browser talks to production.
// Usage: start the site pointed at staging (npm run dev -w web -- -p 3060, with the staging project's URL and keys in the
// environment), run the rehearsal's `seed` step, then:
//   BASE=http://localhost:3060 PLAYWRIGHT_CHANNEL=chrome node apps/web/e2e/release-smoke.mjs [label]
// It reads the accounts from supabase/tests/staging/.rehearsal.json and changes nothing (it only opens pages).
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3060";
const PRODUCTION = "dskbzoqreandwwpxiplh";
const label = process.argv[2] ?? "";
const state = JSON.parse(fs.readFileSync(new URL("../../../supabase/tests/staging/.rehearsal.json", import.meta.url), "utf8"));
const A = state.accounts, I = state.ids;
const ROLES = [
  { who: "signed out", login: null, pages: ["/", "/login", "/signup", "/business/login", "/privacy", "/guidelines", `/businesses/${I.business}`, "/events"] },
  { who: "student", login: ["/login", A.ben], pages: ["/", "/?tab=buzz", "/?tab=reels", "/?tab=posts", "/apartments", `/apartments/${I.apartment}`, `/businesses/${I.business}`, "/deals", "/messages", `/messages/${I.inquiry}`, `/messages/${I.direct}`, "/notifications", "/profile/me", `/profile/${A.cam.id}`, "/saved", "/search?q=river", `/buzz/${I.thread}`, "/settings/profile", "/events", "/events?view=all&when=week", "/events/saved"] },
  { who: "business owner", login: ["/business/login", A.owner], pages: ["/business", "/business/deals", "/business/deals/new", `/business/deals/${I.deal}/edit`, "/business/listings", `/business/listings/${I.apartment}/edit`, "/business/ads", "/business/ads/new", "/business/inbox", `/business/inbox/${I.inquiry}`, "/business/team", "/business/analytics", "/business/profile", "/business/notifications", "/business/billing", "/business/settings", "/business/settings/verification", "/business/settings/account", "/business/preview"] },
  { who: "business staffer", login: ["/business/login", A.staff], pages: ["/business", "/business/inbox", `/business/inbox/${I.inquiry}`, "/business/deals", "/business/settings", "/business/settings/account", "/business/preview"] },
  { who: "UniBuzz team", login: ["/business/login", A.ops], pages: ["/business/admin", "/business/admin/ads", "/business/admin/reports", "/business/admin/audit"] },
];

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const results = [];
let production = 0;
for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  let errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("request", (r) => { if (r.url().includes(PRODUCTION)) production++; });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/_next/")) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 160)}`); });
  if (role.login) {
    const [path, u] = role.login;
    await page.goto(BASE + path);
    await page.fill("#email", u.email);
    await page.fill("#password", u.password);
    await page.locator("button[type=submit]").first().click();
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {});
    if (new URL(page.url()).pathname.endsWith("/login")) { results.push({ who: role.who, path: `${path} (sign in)`, ok: false, why: "still on the login page" }); await ctx.close(); continue; }
  }
  for (const path of role.pages) {
    errors = [];
    let status = 0;
    try {
      const res = await page.goto(BASE + path, { waitUntil: "load" });
      status = res?.status() ?? 0;
      await page.waitForTimeout(1500);
    } catch (e) { errors.push(`navigation: ${e.message.split("\n")[0]}`); }
    const text = await page.locator("body").innerText().catch(() => "");
    const errorScreen = /Something went wrong|Application error|Unhandled Runtime Error/.test(text);
    // Hydration warnings and the dev server's own HMR chatter are not the page failing.
    const real = errors.filter((e) => !/hydrat|Download the React DevTools|\[HMR\]|\[Fast Refresh\]|favicon|^console: Failed to load resource/i.test(e));
    const ok = status > 0 && status < 400 && !errorScreen && real.length === 0;
    const landed = new URL(page.url()).pathname + new URL(page.url()).search;
    results.push({ who: role.who, path, ok, why: ok ? (landed !== path ? `→ ${landed}` : "") : [status >= 400 ? `HTTP ${status}` : "", errorScreen ? "error screen" : "", ...real.slice(0, 2)].filter(Boolean).join("; ").slice(0, 300) });
  }
  await ctx.close();
}
await browser.close();
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.who}: ${r.path}${r.why ? `  (${r.why})` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`  ${production === 0 ? "✓" : "✗"} requests to production: ${production}`);
console.log(`${failed || production ? "✗" : "✓"} release smoke${label ? ` (${label})` : ""}: ${results.length - failed} of ${results.length} pages fine`);
process.exit(failed || production ? 1 : 0);
