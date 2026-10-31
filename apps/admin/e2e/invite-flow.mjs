// The whole staff invitation flow against a REAL Supabase project (use a staging project, never production):
// an owner invites someone, Supabase sends the email, the invitee opens the link, chooses a password, sets up
// two-factor and reaches the dashboard; the link cannot be reused; a withdrawn invitation's account is deleted.
// Everything it creates is removed at the end.
//
// The admin app must run against that project with SUPABASE_SERVICE_ROLE_KEY set (and WITHOUT MEDIA_WORKER_ENABLED):
//   BASE=http://localhost:3001 \
//   SUPABASE_URL=https://<staging>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
//   OWNER_EMAIL=… OWNER_PASSWORD=… OWNER_TOTP_SECRET=<base32 setup key of the owner's authenticator> \
//   E2E_INVITE_EMAIL=someone+invite@yourdomain.com \
//   node apps/admin/e2e/invite-flow.mjs
// E2E_INVITE_EMAIL must be an address Supabase may send to (with the built-in email service: a member of your
// Supabase organization; with custom SMTP: anything deliverable). The link is taken from Supabase's admin API
// (generateLink), so the test does not need to read the mailbox; the email itself is still sent by the app.
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OWNER_EMAIL", "OWNER_PASSWORD", "OWNER_TOTP_SECRET", "E2E_INVITE_EMAIL"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.log(`Set ${missing.join(", ")} (see the comment at the top). Use a staging project.`); process.exit(2); }
if (/dskbzoqreandwwpxiplh/.test(process.env.SUPABASE_URL) && process.env.I_KNOW_THIS_IS_PRODUCTION !== "yes") {
  console.log("SUPABASE_URL is the production project. Run this against staging (or set I_KNOW_THIS_IS_PRODUCTION=yes after approval)."); process.exit(2);
}
const BASE = process.env.BASE || "http://localhost:3001";
const INVITEE = process.env.E2E_INVITE_EMAIL.toLowerCase();
const WITHDRAWN = INVITEE.replace("@", `+withdrawn${Date.now().toString(36)}@`);
const NEW_PASSWORD = `Invite-${Date.now().toString(36)}-correct horse`;
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url)); fs.mkdirSync(SHOTS, { recursive: true });
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const step = async (n, fn) => { try { await fn(); console.log(`  ✓ ${n}`); } catch (e) { failures++; console.log(`  ✗ ${n}: ${(e?.message ?? e).toString().split("\n").slice(0, 2).join(" // ").slice(0, 400)}`); } };
function totp(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const bytes = []; let bits = 0, value = 0;
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) { value = (value << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 0xff); value &= (1 << bits) - 1; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
async function freshCode(page, secret) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30); if (left < 5) await page.waitForTimeout(left * 1000 + 400);
  return totp(secret);
}
async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 }); if (error) throw error;
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email); if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

const browser = await chromium.launch();
const ownerPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); ownerPage.setDefaultTimeout(30000);
let invitee = null;
try {
  for (const e of [INVITEE, WITHDRAWN]) { const u = await findUser(e); if (u) await admin.auth.admin.deleteUser(u.id); } // leftovers of an earlier run

  await step("owner signs in with password and two-factor", async () => {
    await ownerPage.goto(`${BASE}/login?next=%2Fstaff`); await ownerPage.waitForLoadState("networkidle");
    await ownerPage.fill("#email", process.env.OWNER_EMAIL); await ownerPage.fill("#password", process.env.OWNER_PASSWORD);
    await ownerPage.getByRole("button", { name: "Log in", exact: true }).click();
    await ownerPage.waitForURL((u) => u.pathname === "/security"); await ownerPage.waitForLoadState("networkidle");
    await ownerPage.fill("input[name='code']", await freshCode(ownerPage, process.env.OWNER_TOTP_SECRET)); await ownerPage.press("input[name='code']", "Enter");
    await ownerPage.waitForURL((u) => u.pathname === "/staff");
  });
  await step("inviting a moderator says the email was sent, and the pending list shows it", async () => {
    await ownerPage.fill("#staffEmail", INVITEE); await ownerPage.selectOption("#staffRole", "moderator");
    await ownerPage.getByRole("button", { name: "Add to team" }).click();
    await ownerPage.getByText(`Invitation email sent to ${INVITEE}`).waitFor();
    await ownerPage.reload(); await ownerPage.getByText(INVITEE).first().waitFor(); await ownerPage.getByText(/Email sent/).first().waitFor();
    await ownerPage.screenshot({ path: SHOTS + "invite-02-sent.png" });
    invitee = await findUser(INVITEE);
    if (!invitee || invitee.email_confirmed_at || !invitee.invited_at) throw new Error("Supabase did not create an unconfirmed invited account: " + JSON.stringify(invitee && { confirmed: invitee.email_confirmed_at, invited: invitee.invited_at }));
  });
  let tokenHash = null;
  await step("the invitee opens the link (server-verified token_hash), lands on the password page as Moderator", async () => {
    const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email: INVITEE, options: { redirectTo: `${BASE}/auth/confirm?next=%2Fpassword` } });
    if (error) throw error; tokenHash = data.properties.hashed_token;
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.setDefaultTimeout(30000);
    await p.goto(`${BASE}/auth/confirm?next=%2Fpassword&token_hash=${encodeURIComponent(tokenHash)}&type=invite`);
    await p.waitForURL((u) => u.pathname === "/password"); await p.getByText(/on the team as Moderator/).waitFor();
    await p.screenshot({ path: SHOTS + "invite-03-password.png" });
    await step("before choosing a password and two-factor, nothing else opens (dashboard goes to Security)", async () => {
      await p.goto(`${BASE}/`); await p.waitForURL((u) => u.pathname === "/security");
      await p.goto(`${BASE}/password`);
    });
    await step("a weak or mismatched password is refused; a good one leads to two-factor setup", async () => {
      await p.waitForLoadState("networkidle");
      await p.fill("#password", "short"); await p.fill("#confirm", "short"); await p.getByRole("button", { name: /Save/ }).click();
      if (!(await p.getByText(/at least 12 characters/i).count())) await p.getByText(/12/).first().waitFor();
      await p.fill("#password", NEW_PASSWORD); await p.fill("#confirm", NEW_PASSWORD + "x"); await p.getByRole("button", { name: /Save/ }).click();
      await p.getByText(/not the same/).waitFor();
      await p.fill("#password", NEW_PASSWORD); await p.fill("#confirm", NEW_PASSWORD); await p.getByRole("button", { name: /Save/ }).click();
      await p.waitForURL((u) => u.pathname === "/security");
    });
    await step("two-factor setup completes and opens the dashboard", async () => {
      await p.waitForLoadState("networkidle"); await p.getByRole("button", { name: "Start setup" }).click();
      const secret = (await p.locator("code").first().innerText()).replace(/\s+/g, "");
      await p.fill("input[name='code']", await freshCode(p, secret)); await p.getByRole("button", { name: "Turn on" }).click();
      await p.waitForURL((u) => u.pathname === "/"); await p.getByRole("heading", { name: "Overview" }).waitFor();
      await p.screenshot({ path: SHOTS + "invite-04-dashboard.png" });
    });
    await step("the new password works for a fresh sign-in (then two-factor is asked)", async () => {
      const q = await (await browser.newContext()).newPage(); q.setDefaultTimeout(30000);
      await q.goto(`${BASE}/login`); await q.waitForLoadState("networkidle"); await q.fill("#email", INVITEE); await q.fill("#password", NEW_PASSWORD);
      await q.getByRole("button", { name: "Log in", exact: true }).click(); await q.waitForURL((u) => u.pathname === "/security");
    });
  });
  await step("the same link cannot be used twice", async () => {
    const p = await (await browser.newContext()).newPage(); p.setDefaultTimeout(30000);
    await p.goto(`${BASE}/auth/confirm?next=%2Fpassword&token_hash=${encodeURIComponent(tokenHash)}&type=invite`);
    await p.getByText(/expired or was already used/).waitFor();
  });
  await step("the owner's team and audit log show the accepted invitation and the two-factor enrolment", async () => {
    await ownerPage.goto(`${BASE}/staff`); await ownerPage.getByText(INVITEE).first().waitFor();
    if (await ownerPage.getByText(/Pending invitations/).locator("..").locator("..").getByText(INVITEE).count()) throw new Error("still listed as pending");
    await ownerPage.goto(`${BASE}/audit`); await ownerPage.getByText("Invitation email sent").first().waitFor(); await ownerPage.getByText("Joined the team from an invitation").first().waitFor();
  });
  await step("withdrawing an invitation deletes the unused account its email created", async () => {
    await ownerPage.goto(`${BASE}/staff`); await ownerPage.fill("#staffEmail", WITHDRAWN); await ownerPage.selectOption("#staffRole", "moderator");
    await ownerPage.getByRole("button", { name: "Add to team" }).click(); await ownerPage.getByText(`Invitation email sent to ${WITHDRAWN}`).waitFor();
    if (!(await findUser(WITHDRAWN))) throw new Error("no account created by the email");
    ownerPage.once("dialog", (d) => d.accept());
    await ownerPage.reload(); await ownerPage.locator("li", { hasText: WITHDRAWN }).getByRole("button", { name: "Withdraw" }).click();
    await ownerPage.getByText(/unused account its email created was deleted/).waitFor();
    if (await findUser(WITHDRAWN)) throw new Error("the account is still there");
  });
} finally {
  // Clean up: off the team (through the database's own rules is not possible as a service role), then the account.
  try { const u = await findUser(INVITEE); if (u) await admin.auth.admin.deleteUser(u.id); } catch (e) { console.log("  ! cleanup:", e.message); }
  try { const u = await findUser(WITHDRAWN); if (u) await admin.auth.admin.deleteUser(u.id); } catch (e) { console.log("  ! cleanup:", e.message); }
  await browser.close();
  console.log(failures ? `\n${failures} INVITE FLOW CHECK(S) FAILED` : "\nALL INVITE FLOW CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}
