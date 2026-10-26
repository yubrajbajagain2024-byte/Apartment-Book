// Browser checks of the invitation and password-reset link handling that need no real email and send nothing to
// Supabase Auth: expired and malformed links, unsupported link types, the password page's gate, and (when the
// server runs with CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY but without MEDIA_WORKER_ENABLED) that the worker stays off.
//   BASE=http://localhost:3002 [CRON_SECRET=…] node apps/admin/e2e/invite-links.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3001";
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url)); fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0; const errors = [];
const step = async (n, fn) => { try { await fn(); console.log(`  ✓ ${n}`); } catch (e) { failures++; console.log(`  ✗ ${n}: ${(e?.message ?? e).toString().split("\n")[0].slice(0, 300)}`); } };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(20000);
page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
try {
  await step("/auth/confirm without a token hands over to /auth/accept (default Supabase links carry the session in the fragment)", async () => {
    const r = await page.request.get(`${BASE}/auth/confirm?next=%2Fpassword`, { maxRedirects: 0 });
    const loc = r.headers().location ?? ""; if (r.status() !== 307 || !loc.includes("/auth/accept?next=%2Fpassword")) throw new Error(`${r.status()} ${loc}`);
  });
  await step("/auth/confirm refuses link types it does not use (signup, magiclink) without contacting Supabase", async () => {
    for (const type of ["signup", "magiclink", "email_change"]) {
      const r = await page.request.get(`${BASE}/auth/confirm?token_hash=abc&type=${type}`, { maxRedirects: 0 });
      const loc = decodeURIComponent(r.headers().location ?? ""); if (r.status() !== 307 || !/not used here/.test(loc)) throw new Error(`${type}: ${r.status()} ${loc}`);
    }
  });
  await step("/auth/confirm keeps next= on this site (an outside next falls back to /password)", async () => {
    const r = await page.request.get(`${BASE}/auth/confirm?next=https%3A%2F%2Fevil.example`, { maxRedirects: 0 });
    const loc = r.headers().location ?? ""; if (!loc.includes("next=%2Fpassword")) throw new Error(loc);
  });
  await step("an expired link (Supabase's error fragment) says so, offers the login page, and the fragment is removed", async () => {
    await page.goto(`${BASE}/auth/accept?next=%2Fpassword#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    await page.getByText(/expired or was already used/).waitFor();
    if (new URL(page.url()).hash) throw new Error("fragment still in the address bar: " + page.url());
    await page.getByRole("link", { name: /login page/i }).waitFor();
    await page.screenshot({ path: SHOTS + "invite-01-expired-link.png" });
  });
  await step("a fragment session of another kind (magiclink) is not accepted", async () => {
    await page.goto(`${BASE}/auth/accept#access_token=a.b.c&refresh_token=r&type=magiclink`);
    await page.getByText(/incomplete/).waitFor();
    if (new URL(page.url()).hash) throw new Error("fragment kept");
  });
  await step("a server-side verification error is shown on /auth/accept", async () => {
    await page.goto(`${BASE}/auth/accept?error_description=${encodeURIComponent("This link has expired or was already used. Ask an owner or admin to send a new one.")}`);
    await page.getByText(/Ask an owner or admin to send a new one/).waitFor();
  });
  await step("signed out, /password goes to the login page and comes back to it", async () => {
    const r = await page.request.get(`${BASE}/password`, { maxRedirects: 0 });
    const loc = r.headers().location ?? ""; if (r.status() !== 307 || !loc.includes("/login?next=%2Fpassword")) throw new Error(`${r.status()} ${loc}`);
  });
  await step("the login page tells staff how to get a password reset (no anonymous reset form)", async () => {
    await page.goto(`${BASE}/login`); await page.getByText(/send you a reset email from the Staff page/).waitFor();
    if (await page.getByRole("button", { name: /forgot|reset/i }).count()) throw new Error("an anonymous reset button exists");
  });
  if (process.env.CRON_SECRET) {
    await step("with the service-role key but without MEDIA_WORKER_ENABLED, the worker endpoint stays off even with the right secret", async () => {
      const r = await page.request.get(`${BASE}/api/media/worker`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
      const body = await r.text(); if (r.status() !== 503 || !/switched off/.test(body)) throw new Error(`${r.status()} ${body}`);
    });
  } else console.log("  - worker check skipped: start the server with CRON_SECRET and pass the same CRON_SECRET here");
  await step("no browser errors", async () => { const real = errors.filter((e) => !/favicon|401|404|net::ERR_ABORTED|Failed to load resource/i.test(e)); if (real.length) throw new Error(real.slice(0, 3).join(" | ")); });
} finally { await browser.close(); console.log(failures ? `\n${failures} INVITE LINK CHECK(S) FAILED` : "\nALL INVITE LINK CHECKS PASSED"); process.exit(failures ? 1 : 0); }
