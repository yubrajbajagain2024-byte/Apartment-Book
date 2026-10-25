// The website has no admin section: /admin is the ordinary 404, robots.txt does not mention it, home and login still render.
// Usage: start the site (npm run dev -w web), then BASE=http://localhost:3000 node apps/web/e2e/no-admin.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3000";
let failures = 0; const errors = [];
const step = async (n, fn) => { try { await fn(); console.log(`  ✓ ${n}`); } catch (e) { failures++; console.log(`  ✗ ${n}: ${(e?.message ?? e).toString().slice(0, 300)}`); } };
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(30000);
page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
try {
  await step("home renders with the public navbar", async () => { const r = await page.goto(BASE + "/"); if (r.status() !== 200) throw new Error("status " + r.status()); await page.getByRole("link", { name: /log in/i }).first().waitFor(); });
  await step("/admin is the ordinary 404 page (no redirect to login)", async () => { const r = await page.goto(BASE + "/admin"); if (r.status() !== 404) throw new Error("status " + r.status() + " url " + page.url()); await page.getByRole("heading", { name: "Page not found" }).waitFor(); });
  await step("/admin/staff and /admin/security are 404 too", async () => { for (const p of ["/admin/staff", "/admin/security"]) { const r = await page.goto(BASE + p); if (r.status() !== 404) throw new Error(p + " status " + r.status()); } });
  await step("robots.txt no longer mentions /admin", async () => { const r = await page.goto(BASE + "/robots.txt"); const t = await r.text(); if (/admin/i.test(t)) throw new Error(t); });
  await step("login page still works", async () => { await page.goto(BASE + "/login"); await page.getByRole("button", { name: "Log in", exact: true }).waitFor(); });
  await step("no browser errors", async () => { const real = errors.filter((e) => !/favicon|404|net::ERR_ABORTED|Failed to load resource/i.test(e)); if (real.length) throw new Error(real.slice(0, 3).join(" | ")); });
} finally { await browser.close(); console.log(failures ? `\n${failures} NO-ADMIN CHECK(S) FAILED` : "\nALL NO-ADMIN CHECKS PASSED"); process.exit(failures ? 1 : 0); }
