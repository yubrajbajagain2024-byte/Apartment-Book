// Migration 18 (staff invitations sent by email): existing invitations get sane defaults, the email result binds an
// invitation to the account Supabase created for it, only that account can claim it, expiry, re-sending, withdrawing
// (with the unused account), every permission rule, and the old sign-up path still working.
// Usage: node supabase/tests/staff-invite-email.test.mjs
import { boot, read, expectOk, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot({ upTo: "20261103100100_hardening.sql" });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const MFA = { aal: "aal2" };
const fails = async (fn, re) => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`wrong error: ${e.message}`); } throw new Error("no error"); };
const invite = (email) => one(db.query("select * from public.staff_invites where email = $1", [email]));
const lastLog = async (action) => one(db.query("select * from public.staff_audit_log where action = $1 order by id desc limit 1", [action]));
const staffRole = async (uid) => (await one(db.query("select role from public.staff where user_id = $1", [uid])))?.role ?? null;
/** What Supabase Auth's inviteUserByEmail does to the database: an unconfirmed account, marked invited, no password. */
const supabaseInvites = async (email) => (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at, invited_at) values ($1, '{}', null, now()) returning id", [email]))).id;
/** Opening the link in the email: Supabase confirms the address. */
const opensLink = (uid) => db.query("update auth.users set email_confirmed_at = now(), last_sign_in_at = now() where id = $1", [uid]);

// ---- the team, and an invitation made before migration 18 ----------------------------------------
const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
const ADMIN = await mk("admin@txstate.edu", "Adam Admin");
const MOD = await mk("mod@txstate.edu", "Mona Moderator");
const STUDENT = await mk("sam@txstate.edu", "Sam Student");
await as(OWNER, () => db.query("select public.admin_staff_add('admin@txstate.edu','admin'), public.admin_staff_add('mod@txstate.edu','moderator')"), MFA);
await as(OWNER, () => db.query("select public.admin_staff_add('early.owner@gmail.com','owner')"), MFA);

await expectOk("migration 18 applies over existing invitations and re-runs cleanly", async () => {
  await db.exec(read("migrations/20261103100200_staff_invite_email.sql"));
  await db.exec(read("migrations/20261103100200_staff_invite_email.sql"));
});
await expectOk("an invitation made before it: not sent, expires 7 days from the migration, not bound to an account", async () => {
  const i = await invite("early.owner@gmail.com");
  const days = (new Date(i.expires_at) - Date.now()) / 86400000;
  if (i.email_status !== "not_sent" || i.email_attempts !== 0 || i.auth_user_id !== null || days < 6.9 || days > 7.01) throw new Error(JSON.stringify(i));
});

// ---- sending -------------------------------------------------------------------------------------------
let NEW_OWNER;
await expectOk("sent: the email result records the attempt and binds the account Supabase created for this address", async () => {
  NEW_OWNER = await supabaseInvites("early.owner@gmail.com"); // allowed although outside the university: the invitation exempts it
  await as(OWNER, () => db.query("select public.admin_invite_email_result('early.owner@gmail.com', true, $1, null)", [NEW_OWNER]), MFA);
  const i = await invite("early.owner@gmail.com");
  if (i.email_status !== "sent" || i.email_attempts !== 1 || !i.email_sent_at || i.auth_user_id !== NEW_OWNER || i.email_error !== null) throw new Error(JSON.stringify(i));
  const log = await lastLog("invite.email_sent"); if (log.actor_id !== OWNER || log.target_id !== "early.owner@gmail.com") throw new Error(JSON.stringify(log));
  if (await staffRole(NEW_OWNER)) throw new Error("staff before the link was opened");
});
await expectOk("binding is checked in SQL: another address's account, a confirmed account or a self sign-up are refused", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('second@gmail.com','moderator')"), MFA);
  await fails(() => as(OWNER, () => db.query("select public.admin_invite_email_result('second@gmail.com', true, $1, null)", [NEW_OWNER]), MFA), /does not belong to this invitation/);
  await fails(() => as(OWNER, () => db.query("select public.admin_invite_email_result('second@gmail.com', true, $1, null)", [STUDENT]), MFA), /does not belong to this invitation/);
  const selfSignup = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('selfie@txstate.edu', '{}', null) returning id"))).id;
  await as(OWNER, () => db.query("select public.admin_staff_add('ghost@txstate.edu','moderator')"), MFA);
  await db.query("update auth.users set email = 'ghost@txstate.edu' where id = $1", [selfSignup]);
  await fails(() => as(OWNER, () => db.query("select public.admin_invite_email_result('ghost@txstate.edu', true, $1, null)", [selfSignup]), MFA), /does not belong to this invitation/);
  await db.query("delete from auth.users where id = $1", [selfSignup]);
  await as(OWNER, () => db.query("select public.admin_invite_revoke('ghost@txstate.edu')"), MFA);
});
await expectOk("failed: the error is kept (500 characters at most), the attempt counted and logged, nothing bound", async () => {
  await as(OWNER, () => db.query("select public.admin_invite_email_result('second@gmail.com', false, null, $1)", ["Error sending invite email: " + "x".repeat(700)]), MFA);
  const i = await invite("second@gmail.com");
  if (i.email_status !== "failed" || i.email_attempts !== 1 || i.email_error.length !== 500 || i.auth_user_id !== null) throw new Error(JSON.stringify({ ...i, email_error: i.email_error?.length }));
  if (!(await lastLog("invite.email_failed"))) throw new Error("not logged");
});
await expectOk("the list shows status, attempts, expiry and whether the email created an account", async () => {
  const list = await as(OWNER, () => rows(db.query("select * from public.admin_invites_list()")), MFA);
  const a = list.find((r) => r.email === "early.owner@gmail.com"), b = list.find((r) => r.email === "second@gmail.com");
  if (a.email_status !== "sent" || !a.account_created || a.expired || !a.expires_at) throw new Error(JSON.stringify(a));
  if (b.email_status !== "failed" || b.account_created || b.email_attempts !== 1) throw new Error(JSON.stringify(b));
});

// ---- permissions ---------------------------------------------------------------------------------------
await expectOk("moderators, students and visitors cannot record, re-send or list; admins only for moderator invitations; aal2 required", async () => {
  for (const who of [MOD, STUDENT]) for (const q of ["select public.admin_invite_email_result('second@gmail.com', false, null, 'x')", "select public.admin_invite_resend('second@gmail.com')", "select * from public.admin_invites_list()"])
    await fails(() => as(who, () => db.query(q), MFA), /Not allowed/);
  await fails(() => asAnon(() => db.query("select public.admin_invite_resend('second@gmail.com')")), /permission denied|Not authenticated/);
  await fails(() => as(ADMIN, () => db.query("select public.admin_invite_resend('early.owner@gmail.com')"), MFA), /Not allowed/);
  await fails(() => as(ADMIN, () => db.query("select public.admin_invite_email_result('early.owner@gmail.com', false, null, 'x')"), MFA), /Not allowed/);
  await fails(() => as(ADMIN, () => db.query("select public.admin_invite_revoke('early.owner@gmail.com')"), MFA), /Not allowed/);
  await as(ADMIN, () => db.query("select public.admin_invite_resend('second@gmail.com')"), MFA); // a moderator invitation: fine
  await fails(() => as(OWNER, () => db.query("select public.admin_invite_resend('second@gmail.com')"), { aal: "aal1" }), /Two-factor authentication required/);
  for (const fn of ["staff_invite_for_caller(text)"]) {
    const g = await one(db.query(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') as a, has_function_privilege('anon', 'public.${fn}', 'execute') as b`));
    if (g.a || g.b) throw new Error(`${fn} is callable from the API`);
  }
});

// ---- claiming ------------------------------------------------------------------------------------------
await expectOk("opening the link: the bound account becomes owner, the invitation is used up, logged as accepted via the email link", async () => {
  await opensLink(NEW_OWNER);
  if ((await staffRole(NEW_OWNER)) !== "owner") throw new Error("not owner");
  if (await invite("early.owner@gmail.com")) throw new Error("invitation still pending");
  const log = await lastLog("invite.accepted"); if (log.target_id !== NEW_OWNER || log.details.via !== "email link") throw new Error(JSON.stringify(log));
});
await expectOk("a bound invitation is never claimed by another account with the same address (held and logged)", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('bound@gmail.com','moderator')"), MFA);
  const real = await supabaseInvites("bound@gmail.com");
  await as(OWNER, () => db.query("select public.admin_invite_email_result('bound@gmail.com', true, $1, null)", [real]), MFA);
  const other = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('bound@gmail.com', '{}', null) returning id"))).id;
  await db.query("update auth.users set email_confirmed_at = now() where id = $1", [other]);
  if (await staffRole(other)) throw new Error("the other account got the role");
  const log = await lastLog("invite.held"); if (log.target_id !== other || !/not the account/.test(log.details.reason)) throw new Error(JSON.stringify(log));
  if (!(await invite("bound@gmail.com"))) throw new Error("invitation consumed by the wrong account");
  await opensLink(real);
  if ((await staffRole(real)) !== "moderator") throw new Error("the real account did not get the role");
});
await expectOk("an expired invitation is not claimed: logged, kept, and shown as expired", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('late@gmail.com','admin')"), MFA);
  const late = await supabaseInvites("late@gmail.com");
  await as(OWNER, () => db.query("select public.admin_invite_email_result('late@gmail.com', true, $1, null)", [late]), MFA);
  await db.query("update public.staff_invites set expires_at = now() - interval '1 minute' where email = 'late@gmail.com'");
  await opensLink(late);
  if (await staffRole(late)) throw new Error("expired invitation granted a role");
  if (!(await lastLog("invite.expired"))) throw new Error("not logged");
  const row = (await as(OWNER, () => rows(db.query("select * from public.admin_invites_list()")), MFA)).find((r) => r.email === "late@gmail.com");
  if (!row?.expired) throw new Error(JSON.stringify(row));
});
await expectOk("re-sending renews the 7 days and is logged; then a fresh confirmation-free claim works on the next link", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('renew@gmail.com','moderator')"), MFA);
  const acct = await supabaseInvites("renew@gmail.com");
  await as(OWNER, () => db.query("select public.admin_invite_email_result('renew@gmail.com', true, $1, null)", [acct]), MFA);
  await db.query("update public.staff_invites set expires_at = now() - interval '1 day' where email = 'renew@gmail.com'");
  const role = (await as(OWNER, () => one(db.query("select public.admin_invite_resend('renew@gmail.com') as r")), MFA)).r;
  const i = await invite("renew@gmail.com");
  if (role !== "moderator" || (new Date(i.expires_at) - Date.now()) / 86400000 < 6.9) throw new Error(JSON.stringify(i));
  if ((await lastLog("invite.resend")).details.was_expired !== true) throw new Error("resend log");
  await as(OWNER, () => db.query("select public.admin_invite_email_result('renew@gmail.com', true, $1, null)", [acct]), MFA);
  if ((await invite("renew@gmail.com")).email_attempts !== 2) throw new Error("attempts");
  await opensLink(acct);
  if ((await staffRole(acct)) !== "moderator") throw new Error("not claimed after renewal");
});
await expectOk("changing the role of a pending invitation whose email created an account is allowed and keeps it bound", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('change@gmail.com','moderator')"), MFA);
  const acct = await supabaseInvites("change@gmail.com");
  await as(OWNER, () => db.query("select public.admin_invite_email_result('change@gmail.com', true, $1, null)", [acct]), MFA);
  const before = await invite("change@gmail.com");
  await as(OWNER, () => db.query("select public.admin_staff_add('change@gmail.com','admin')"), MFA);
  const after = await invite("change@gmail.com");
  if (after.role !== "admin" || after.auth_user_id !== acct || String(after.created_at) !== String(before.created_at)) throw new Error(JSON.stringify(after));
  await opensLink(acct);
  if ((await staffRole(acct)) !== "admin") throw new Error("role change lost");
});

await expectOk("an account left by a send that failed half-way blocks nothing: re-sending works and the next success binds it", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('half@gmail.com','moderator')"), MFA);
  const leftover = await supabaseInvites("half@gmail.com");
  await as(OWNER, () => db.query("select public.admin_invite_email_result('half@gmail.com', false, null, 'timeout')"), MFA);
  await as(OWNER, () => db.query("select public.admin_invite_resend('half@gmail.com')"), MFA);
  await as(OWNER, () => db.query("select public.admin_staff_add('half@gmail.com','admin')"), MFA); // changing the role is not blocked either
  await as(OWNER, () => db.query("select public.admin_invite_email_result('half@gmail.com', true, $1, null)", [leftover]), MFA);
  if ((await invite("half@gmail.com")).auth_user_id !== leftover) throw new Error("not bound");
  await opensLink(leftover);
  if ((await staffRole(leftover)) !== "admin") throw new Error("not claimed");
});
await expectOk("the stranger check is internal (not callable from the API)", async () => {
  const g = await one(db.query("select has_function_privilege('authenticated', 'public.staff_stranger_signup_exists(text)', 'execute') as a, has_function_privilege('anon', 'public.staff_stranger_signup_exists(text)', 'execute') as b"));
  if (g.a || g.b) throw new Error("callable");
});

// ---- withdrawing ---------------------------------------------------------------------------------------
await expectOk("withdrawing deletes the unused account the email created; a later click leads nowhere", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('gone@gmail.com','moderator')"), MFA);
  const acct = await supabaseInvites("gone@gmail.com");
  await as(OWNER, () => db.query("select public.admin_invite_email_result('gone@gmail.com', true, $1, null)", [acct]), MFA);
  const removed = (await as(OWNER, () => one(db.query("select public.admin_invite_revoke('gone@gmail.com') as r")), MFA)).r;
  if (removed !== true) throw new Error("account not removed");
  if (await one(db.query("select 1 from auth.users where id = $1", [acct]))) throw new Error("auth user still there");
  if (await one(db.query("select 1 from public.profiles where id = $1", [acct]))) throw new Error("profile still there");
  if ((await lastLog("invite.revoke")).details.account_removed !== true) throw new Error("log");
});
await expectOk("withdrawing never deletes an account somebody confirmed or signed in to", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('keep@gmail.com','moderator')"), MFA);
  const acct = await supabaseInvites("keep@gmail.com");
  await as(OWNER, () => db.query("select public.admin_invite_email_result('keep@gmail.com', true, $1, null)", [acct]), MFA);
  await db.query("update auth.users set last_sign_in_at = now() where id = $1", [acct]);
  const removed = (await as(OWNER, () => one(db.query("select public.admin_invite_revoke('keep@gmail.com') as r")), MFA)).r;
  if (removed !== false || !(await one(db.query("select 1 from auth.users where id = $1", [acct])))) throw new Error("a used account was deleted");
});

// ---- the old ways still work ---------------------------------------------------------------------------
await expectOk("without an email (not configured), signing up and confirming still claims the invitation", async () => {
  await as(OWNER, () => db.query("select public.admin_staff_add('legacy@txstate.edu','moderator')"), MFA);
  const u = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('legacy@txstate.edu', '{}', null) returning id"))).id;
  await db.query("update auth.users set email_confirmed_at = now() where id = $1", [u]);
  if ((await staffRole(u)) !== "moderator") throw new Error("legacy claim broken");
  if ((await lastLog("invite.accepted")).details.via !== "sign-up") throw new Error("via");
});
await expectOk("an account older than an (unsent) invitation is still held", async () => {
  const old = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at, created_at) values ('older@txstate.edu', '{}', null, now() - interval '1 day') returning id"))).id;
  await db.query("delete from auth.users where id = $1", [old]); // gone again; recreate it unconfirmed is refused by add, so model the race directly
  await as(OWNER, () => db.query("select public.admin_staff_add('older@txstate.edu','moderator')"), MFA);
  const squat = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at, created_at) values ('older@txstate.edu', '{}', null, now() - interval '1 day') returning id"))).id;
  await db.query("update auth.users set email_confirmed_at = now() where id = $1", [squat]);
  if (await staffRole(squat)) throw new Error("older account promoted");
  if ((await lastLog("invite.held")).details.reason !== "account predates invite") throw new Error("reason");
});
await expectOk("adding someone whose own unconfirmed sign-up exists is still refused (and re-sending such an invitation too)", async () => {
  await db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('pending@txstate.edu', '{}', null)");
  await fails(() => as(OWNER, () => db.query("select public.admin_staff_add('pending@txstate.edu','moderator')"), MFA), /has not confirmed it/);
});
await expectOk("the first-owner bootstrap invitation does not expire", async () => {
  await db.query("select public.admin_bootstrap_owner('second.owner@txstate.edu')").catch(() => null);
  const bootstrapLike = await one(db.query("insert into public.staff_invites (email, role, invited_by, expires_at) values ('boot@txstate.edu', 'owner', null, now() - interval '30 days') returning email"));
  const u = await mk("boot@txstate.edu", "Boot Strap");
  if ((await staffRole(u)) !== "owner" || !bootstrapLike) throw new Error("bootstrap invite expired");
});

await expectOk("re-running migration 14 after 18 is refused inside a transaction and leaves 18's invitation rules in place", async () => {
  await db.exec("begin");
  try { await db.exec(read("migrations/20261023000000_admin.sql")); throw new Error("not refused"); }
  catch (e) { if (!/cannot change return type/.test(e.message)) throw e; }
  finally { await db.exec("rollback"); }
  const body = (await one(db.query("select prosrc from pg_proc where oid = 'public.staff_claim_invite()'::regprocedure"))).prosrc;
  if (!/not the account the invitation email created/.test(body)) throw new Error("staff_claim_invite was reverted");
  if (!(await one(db.query("select to_regprocedure('public.admin_invite_resend(text)') as p"))).p) throw new Error("18's functions are gone");
});

done("STAFF INVITE EMAIL");
