#!/usr/bin/env node
/**
 * Supabase Auth email settings for CampConnect Admin's staff invitations. Read-only by default.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=<ref> ADMIN_URL=https://<admin app> node scripts/configure-auth-email.mjs
 *       # report, change nothing
 *   SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=<ref> ADMIN_URL=… [SMTP_* …] node scripts/configure-auth-email.mjs --apply
 *
 * Every argument is explicit on purpose: there is no default project and no default admin URL, so the script
 * cannot be pointed at production by accident. With --apply it writes auth settings of the named project, which
 * is a production write when that project is production: it needs the owner's approval first (root CLAUDE.md).
 *
 * The report says whether the project sends with custom SMTP or Supabase's built-in service
 * (a few emails per hour, delivered only to members of your Supabase organization), the email
 * rate limit, how long email links stay valid, whether the invitation template uses the
 * server-verified link, whether the admin app's /auth/confirm is an allowed redirect, and
 * whether Confirm email and TOTP two-factor are on.
 *
 * --apply changes ONLY these, and only what you pass:
 *   * Redirect URLs: adds <ADMIN_URL>/auth/** (always; nothing is removed).
 *   * The "Invite user" email (subject + body): a link to <redirect>&token_hash=…&type=invite,
 *     verified by the admin app's server (apps/admin/src/app/auth/confirm). Nothing else in this
 *     project sends invitation emails. The password-reset template is left alone (the mobile app uses it).
 *   * Custom SMTP, when SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_SENDER_EMAIL are all
 *     set (SMTP_SENDER_NAME optional, default "CampConnect Admin").
 *   * INVITE_LINK_HOURS (1-24): how long email links stay valid. Note: Supabase uses one value for
 *     every email link of the project (sign-up confirmations too).
 * The access token and the SMTP password are never printed; the SMTP user is not printed either.
 *
 * The invitation flow itself is step-admin's migration 18 (20261103100200_staff_invite_email.sql), which is
 * on production but in no folder of this repo yet (docs/branches/step-admin.md).
 */
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = (process.env.SUPABASE_PROJECT_REF || "").trim();
const adminUrl = (process.env.ADMIN_URL || "").trim().replace(/\/$/, "");
const apply = process.argv.includes("--apply");

const INVITE_SUBJECT = "You're invited to CampConnect Admin";
const INVITE_BODY = `<h2>You're invited to CampConnect Admin</h2>
<p>You have been added to the team that runs UniBuzz as <strong>{{ .Data.invited_as }}</strong>.</p>
<p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite">Accept the invitation</a></p>
<p>Opening the link confirms this address ({{ .Email }}). You will then choose a password and set up two-factor authentication with an authenticator app. The link works once and expires; if it has, ask the person who invited you to send it again.</p>
<p>If you did not expect this email, ignore it.</p>`;

const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
function die(m) {
  console.error(`\n  ✗ ${m}\n`);
  process.exit(1);
}

async function api(method, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} config/auth → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function report(c) {
  const custom = Boolean(c.smtp_host);
  if (custom) ok(`custom SMTP: ${c.smtp_host}:${c.smtp_port ?? "?"} as ${c.smtp_sender_name ? `"${c.smtp_sender_name}" ` : ""}<${c.smtp_admin_email ?? "?"}>`);
  else warn("built-in email service: a few emails per hour, delivered only to members of your Supabase organization. Invitations to anyone else need custom SMTP.");
  ok(`email rate limit: ${c.rate_limit_email_sent ?? "?"} per hour`);
  const hours = Number(c.mailer_otp_exp ?? 0) / 3600;
  ok(`email links valid for ${hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "?"} (one value for every email link of the project)`);
  const template = String(c.mailer_templates_invite_content ?? "");
  if (/TokenHash/.test(template) && /RedirectTo/.test(template)) ok("invitation template: server-verified link (token_hash)");
  else warn("invitation template: Supabase's default. It still works (the admin app reads the session from the link), but the server-verified link is recommended.");
  const allow = String(c.uri_allow_list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = allow.some((u) => u === `${adminUrl}/auth/**` || u === `${adminUrl}/**` || u.startsWith(`${adminUrl}/auth/confirm`));
  if (allowed) ok(`redirect allowed: ${adminUrl}/auth/…`);
  else warn(`${adminUrl}/auth/** is not an allowed redirect: invitation links would land on the Site URL (the website) instead of the admin app.`);
  if (c.mailer_autoconfirm) warn("Confirm email is OFF: sign-ups are confirmed without opening an email. Keep it ON for staff invitations to mean anything.");
  else ok("Confirm email: on");
  if (c.mfa_totp_enroll_enabled && c.mfa_totp_verify_enabled) ok("TOTP two-factor: enabled");
  else warn("TOTP two-factor is not fully enabled (Authentication → Multi-Factor): staff cannot pass the mandatory second factor.");
  return { custom, allow, allowed };
}

async function main() {
  if (!token) die("Set SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens). This script only reads unless --apply is given.");
  if (!/^[a-z]{20}$/.test(ref)) die("Set SUPABASE_PROJECT_REF to the project's ref (20 lowercase letters). There is no default: name the project every time.");
  if (!/^https?:\/\/[^/\s]+$/.test(adminUrl)) die("Set ADMIN_URL to the admin app's public origin, e.g. https://admin.example.com (no path). There is no default.");
  console.log(`Supabase Auth email settings for ${ref} (${apply ? "APPLY" : "report only: nothing will be changed"})\n`);
  const current = await api("GET");
  const state = report(current);
  if (!apply) {
    console.log("\nNothing was changed. Run with --apply (and SMTP_* to set custom SMTP) to fix what is marked with !.");
    return;
  }

  const patch = {};
  if (!state.allowed) patch.uri_allow_list = [...state.allow, `${adminUrl}/auth/**`].join(",");
  if (current.mailer_templates_invite_content !== INVITE_BODY) {
    patch.mailer_subjects_invite = INVITE_SUBJECT;
    patch.mailer_templates_invite_content = INVITE_BODY;
  }
  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_SENDER_EMAIL"];
  const given = smtpKeys.filter((k) => process.env[k]);
  if (given.length && given.length < smtpKeys.length) die(`custom SMTP needs all of ${smtpKeys.join(", ")}; missing ${smtpKeys.filter((k) => !process.env[k]).join(", ")}`);
  if (given.length === smtpKeys.length) {
    Object.assign(patch, {
      smtp_host: process.env.SMTP_HOST,
      smtp_port: String(process.env.SMTP_PORT),
      smtp_user: process.env.SMTP_USER,
      smtp_pass: process.env.SMTP_PASS,
      smtp_admin_email: process.env.SMTP_SENDER_EMAIL,
      smtp_sender_name: process.env.SMTP_SENDER_NAME || "CampConnect Admin",
    });
  }
  if (process.env.INVITE_LINK_HOURS) {
    const h = Number(process.env.INVITE_LINK_HOURS);
    if (!Number.isInteger(h) || h < 1 || h > 24) die("INVITE_LINK_HOURS must be a whole number from 1 to 24");
    patch.mailer_otp_exp = h * 3600;
  }
  if (Object.keys(patch).length === 0) {
    console.log("\nNothing to change.");
    return;
  }
  // Only the names of the settings are printed: never a value (the SMTP password and user stay hidden).
  console.log(`\nApplying: ${Object.keys(patch).map((k) => (k === "smtp_pass" || k === "smtp_user" ? `${k} (hidden)` : k)).join(", ")}`);
  await api("PATCH", patch);
  console.log("\nAfter:");
  report(await api("GET"));
}

main().catch((error) => die(error.message));
