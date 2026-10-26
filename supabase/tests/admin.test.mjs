// Migration 14 (staff access for /admin): bootstrap, invites, the two-factor gate,
// role rules, the last-owner guard and the audit log. Usage: node supabase/tests/admin.test.mjs
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const MFA = { aal: "aal2" };
const fails = async (fn, re) => { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`wrong error: ${e.message}`); } throw new Error("no error"); };
const logRows = () => rows(db.query("select * from public.staff_audit_log order by id"));
const lastLog = async () => (await logRows()).at(-1);
// A session with arbitrary claims and NO automatic factor (to test the gate itself).
const asRaw = async (uid, claims, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, ...claims })}', false);`); try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claims', '', false);"); } };
const asService = async (fn) => { await db.exec("set role service_role;"); try { return await fn(); } finally { await db.exec("reset role;"); } };

// Re-running migration 14 by hand: harmless up to migration 17. Migration 18 replaced four of its invitation functions with
// new return types, so from then on a re-run is refused outright (it would revert 18's invitation rules); refused inside a
// transaction, as the setup script and the SQL editor run it, it changes nothing.
const rerun14 = async (dbx, readx) => {
  const has18 = (await dbx.query("select to_regprocedure('public.admin_invite_resend(text)') is not null as x")).rows[0].x;
  if (!has18) return dbx.exec(readx("migrations/20261023000000_admin.sql"));
  await dbx.exec("begin");
  try { await dbx.exec(readx("migrations/20261023000000_admin.sql")); throw new Error("re-running 14 after 18 was not refused"); }
  catch (e) { if (!/cannot change return type/.test(e.message)) throw e; }
  finally { await dbx.exec("rollback"); }
};
await expectOk("migration 14 re-runs cleanly (after migration 18: refused, and nothing changes)", () => rerun14(db, read));

// ---- first owner ------------------------------------------------------------------
let OWNER;
await expectOk("an outside (non-university) address cannot sign up on its own", async () => {
  await fails(() => mk("stranger@gmail.com", "Stranger"), /university email/);
  await fails(() => mk("owner@gmail.com", "Olivia Owner"), /university email/);
});
await expectOk("bootstrap: a mistyped first attempt is forgotten when the right address is bootstrapped; the owner need not be a student", async () => {
  if ((await one(db.query("select public.admin_bootstrap_owner('typo@txstate.edu') as r"))).r !== "invited") throw new Error("typo");
  const r = await one(db.query("select public.admin_bootstrap_owner('  Owner@GMAIL.com ') as r")); if (r.r !== "invited") throw new Error(r.r);
  const inv = await rows(db.query("select * from public.staff_invites")); if (inv.length !== 1 || inv[0].email !== "owner@gmail.com" || inv[0].role !== "owner") throw new Error(JSON.stringify(inv));
  const l = await logRows(); if (!l.some((x) => x.action === "invite.revoke" && x.target_id === "typo@txstate.edu" && x.details.reason === "bootstrap superseded")) throw new Error(JSON.stringify(l));
  if ((await one(db.query("select count(*)::int n from public.staff"))).n !== 0) throw new Error("staff row created");
});
await expectOk("bootstrap refuses a malformed address", async () => {
  await fails(() => db.query("select public.admin_bootstrap_owner('not-an-email')"), /valid email/);
});
await expectOk("an unconfirmed sign-up with the invited address gets nothing, and bootstrap says so", async () => {
  OWNER = await mk("owner@gmail.com", "Olivia Owner", { confirmed: false }); // the invitation lets the outside address in
  if ((await one(db.query("select count(*)::int n from public.staff"))).n !== 0) throw new Error("staff row for an unconfirmed account");
  if ((await as(OWNER, () => rows(db.query("select * from public.admin_me()")))).length) throw new Error("admin_me returned rows");
  await fails(() => db.query("select public.admin_bootstrap_owner('owner@gmail.com')"), /has not confirmed/);
});
await expectOk("confirming the email claims the invite: first owner, invite gone, audit rows have no actor", async () => {
  await db.query("update auth.users set email_confirmed_at = now() where id=$1", [OWNER]);
  const s = await one(db.query("select * from public.staff where user_id=$1", [OWNER])); if (s?.role !== "owner") throw new Error(JSON.stringify(s));
  if ((await one(db.query("select count(*)::int n from public.staff_invites"))).n !== 0) throw new Error("invite kept");
  const acc = (await logRows()).find((l) => l.action === "invite.accepted");
  if (!acc || acc.actor_id !== null || acc.target_id !== OWNER || acc.details.role !== "owner" || acc.details.email !== "owner@gmail.com") throw new Error(JSON.stringify(acc));
});
await expectOk("bootstrap is idempotent for the owner and refuses to create a second one", async () => {
  const r = await one(db.query("select public.admin_bootstrap_owner('owner@gmail.com') as r")); if (r.r !== "already owner") throw new Error(r.r);
  await fails(() => db.query("select public.admin_bootstrap_owner('someone@txstate.edu')"), /owner already exists/);
});
await expectError("bootstrap cannot be called through the API, not even by the owner", () => as(OWNER, () => db.query("select public.admin_bootstrap_owner('x@txstate.edu')"), MFA), "permission denied");
await expectError("bootstrap cannot be called with the service key either", () => asService(() => db.query("select public.admin_bootstrap_owner('x@txstate.edu')")), "permission denied");

// ---- closed tables, internal functions -----------------------------------------------
const A = OWNER, B = await mk("bob@txstate.edu", "Bob Admin"), C = await mk("carol@txstate.edu", "Carol Mod"), D = await mk("dave@txstate.edu", "Dave Mod"), E = await mk("erin@txstate.edu", "Erin Student");
await expectOk("the three tables and the log's sequence are closed to every API role (owner with 2FA, students, visitors, service key)", async () => {
  for (const t of ["staff", "staff_invites", "staff_audit_log"]) {
    await fails(() => as(A, () => db.query(`select * from public.${t}`), MFA), /permission denied/);
    await fails(() => as(E, () => db.query(`select * from public.${t}`), MFA), /permission denied/);
    await fails(() => asAnon(() => db.query(`select * from public.${t}`)), /permission denied/);
    await fails(() => asService(() => db.query(`select * from public.${t}`)), /permission denied/);
  }
  await fails(() => as(A, () => db.query("insert into public.staff (user_id, role) values ($1,'owner')", [E]), MFA), /permission denied/);
  await fails(() => as(E, () => db.query("insert into public.staff (user_id, role) values ($1,'owner')", [E]), MFA), /permission denied/);
  await fails(() => as(E, () => db.query("insert into public.staff_invites (email, role) values ('erin@txstate.edu','owner')"), MFA), /permission denied/);
  await fails(() => as(A, () => db.query("delete from public.staff_audit_log"), MFA), /permission denied/);
  await fails(() => as(A, () => db.query("update public.staff_audit_log set details = '{}'"), MFA), /permission denied/);
  await fails(() => as(A, () => db.query("select nextval('public.staff_audit_log_id_seq')"), MFA), /permission denied/);
  await fails(() => asService(() => db.query("select nextval('public.staff_audit_log_id_seq')")), /permission denied/);
});
await expectOk("internal helpers are not executable through the API", async () => {
  for (const q of ["select public.staff_require('owner')", "select public.staff_require('owner', false)", "select public.staff_log('x')", "select public.staff_mfa_verified()", "select public.staff_confirmed_user('erin@txstate.edu')", "select public.staff_unconfirmed_user_exists('erin@txstate.edu')", "select public.staff_role_rank('owner')", "select public.staff_grant_rank('owner')", "select public.staff_assert_invitable('x@txstate.edu')", `select public.staff_revoke_invites_of('${A}', 0, 'x')`]) {
    await fails(() => as(A, () => db.query(q), MFA), /permission denied/);
    await fails(() => asService(() => db.query(q)), /permission denied/);
  }
  await fails(() => asAnon(() => db.query("select * from public.admin_me()")), /permission denied/);
  await fails(() => asAnon(() => db.query("select * from public.admin_staff_list()")), /permission denied/);
  await fails(() => as(A, () => db.query("select public.admin_note_security_event('mfa_enrolled')"), MFA), /does not exist/);
});

// ---- admin_me and the two-factor gate ------------------------------------------------
await expectOk("admin_me: nothing for students; role, 2FA state and last-owner flag for staff", async () => {
  if ((await as(E, () => rows(db.query("select * from public.admin_me()")))).length) throw new Error("student at aal1");
  if ((await as(E, () => rows(db.query("select * from public.admin_me()")), MFA)).length) throw new Error("student at aal2");
  await db.query("delete from auth.mfa_factors where user_id = $1", [A]);
  let me = await as(A, () => one(db.query("select * from public.admin_me()")));
  if (me.role !== "owner" || me.mfa_verified !== false || me.mfa_enrolled !== false || me.user_id !== A || me.last_owner !== true) throw new Error(JSON.stringify(me));
  await db.query("insert into auth.mfa_factors (user_id, status) values ($1,'unverified')", [A]);
  me = await as(A, () => one(db.query("select * from public.admin_me()"))); if (me.mfa_enrolled !== false) throw new Error("unverified factor counted");
  me = await asRaw(A, MFA, () => one(db.query("select * from public.admin_me()"))); if (me.mfa_verified !== false) throw new Error("aal2 claim without a verified factor must not count");
  me = await as(A, () => one(db.query("select * from public.admin_me()")), MFA); if (me.mfa_verified !== true || me.mfa_enrolled !== true) throw new Error("aal2 with factor not seen");
  me = await as(A, () => one(db.query("select * from public.admin_me()"))); if (me.mfa_verified !== false || me.mfa_enrolled !== true) throw new Error("aal1 with factor");
});
await expectOk("every administrative function requires a verified second factor, even for the owner; an aal2 claim alone is not enough", async () => {
  for (const q of ["select * from public.admin_staff_list()", "select public.admin_staff_add('bob@txstate.edu','admin')", `select public.admin_staff_set_role('${B}','admin')`, `select public.admin_staff_remove('${B}')`, "select public.admin_invite_revoke('x@txstate.edu')", "select * from public.admin_invites_list()", "select * from public.admin_audit_list()"]) {
    await fails(() => as(A, () => db.query(q)), /Two-factor authentication required/);
    await fails(() => as(A, () => db.query(q), { aal: "aal1" }), /Two-factor authentication required/);
    await fails(() => as(A, () => db.query(q), { aal: "AAL2" }), /Two-factor authentication required/);
    await fails(() => as(A, () => db.query(q), { aal: "aal3" }), /Two-factor authentication required/);
  }
  await db.query("delete from auth.mfa_factors where user_id = $1", [A]);
  await fails(() => asRaw(A, MFA, () => db.query("select * from public.admin_staff_list()")), /Two-factor authentication required/); // claim without factor
  if ((await one(db.query("select count(*)::int n from public.staff"))).n !== 1) throw new Error("something was added without 2FA");
});
await expectOk("students are told 'Not allowed' with or without 2FA; nothing is revealed", async () => {
  for (const q of ["select * from public.admin_staff_list()", "select * from public.admin_invites_list()", "select * from public.admin_audit_list()", "select public.admin_staff_add('x@txstate.edu','moderator')", `select public.admin_staff_set_role('${A}','moderator')`, `select public.admin_staff_remove('${A}')`, "select public.admin_invite_revoke('x@txstate.edu')"]) {
    await fails(() => as(E, () => db.query(q), MFA), /^Not allowed$/);
    await fails(() => as(E, () => db.query(q)), /^Not allowed$/);
  }
});

// ---- the owner builds the team -------------------------------------------------------
const add = (uid, email, role) => as(uid, () => one(db.query("select public.admin_staff_add($1,$2) as r", [email, role])), MFA).then((r) => r.r);
const setRole = (uid, target, role) => as(uid, () => db.query("select public.admin_staff_set_role($1,$2)", [target, role]), MFA);
const remove = (uid, target) => as(uid, () => db.query("select public.admin_staff_remove($1)", [target]), MFA);
const revoke = (uid, email) => as(uid, () => db.query("select public.admin_invite_revoke($1)", [email]), MFA);
const staffList = (uid) => as(uid, () => rows(db.query("select * from public.admin_staff_list()")), MFA);
const invitesList = (uid) => as(uid, () => rows(db.query("select * from public.admin_invites_list()")), MFA);
const auditList = (uid, ...args) => as(uid, () => rows(db.query(`select * from public.admin_audit_list(${args.join(",")})`)), MFA);
await expectOk("owner adds an admin and a moderator (confirmed accounts) and invites an address that has no account", async () => {
  if ((await add(A, "Bob@txstate.edu", "admin")) !== "added") throw new Error("bob");
  if ((await add(A, "carol@txstate.edu", "moderator")) !== "added") throw new Error("carol");
  if ((await add(A, "future@txstate.edu", "moderator")) !== "invited") throw new Error("future");
  const list = await staffList(A);
  if (list.map((s) => `${s.email}:${s.role}`).join() !== "owner@gmail.com:owner,bob@txstate.edu:admin,carol@txstate.edu:moderator") throw new Error(JSON.stringify(list));
  if (list[0].mfa_enrolled !== true || list[1].mfa_enrolled !== false || list[1].granted_by !== A || list[1].granted_by_name !== "Olivia Owner" || list[1].full_name !== "Bob Admin") throw new Error(JSON.stringify(list[1]));
  const inv = await invitesList(B); if (inv.length !== 1 || inv[0].email !== "future@txstate.edu" || inv[0].role !== "moderator" || inv[0].invited_by_name !== "Olivia Owner") throw new Error(JSON.stringify(inv));
  if ((await as(A, () => one(db.query("select * from public.admin_me()")), MFA)).last_owner !== true) throw new Error("still the only owner");
});
await expectOk("adding: own address, people already on the team, bad addresses, bad roles and non-university addresses are rejected", async () => {
  await fails(() => add(A, "owner@gmail.com", "admin"), /cannot change your own role/);
  await fails(() => add(A, "bob@txstate.edu", "moderator"), /already on the team/);
  await fails(() => add(A, "nope", "moderator"), /valid email/);
  await fails(() => add(A, "", "moderator"), /valid email/);
  await fails(() => add(A, "a@b.c", "superuser"), /Invalid role/);
  await fails(() => add(A, "a@b.c", null), /Invalid role/);
  // An outside address can be invited; the invitation lets it sign up (Google sign-in, or the dashboard's invite).
  if ((await add(A, "friend@gmail.com", "moderator")) !== "invited") throw new Error("friend");
  const FR = await mk("friend@gmail.com", "Friend Mod"); // confirmed at insert, like a Google account
  if ((await one(db.query("select role from public.staff where user_id=$1", [FR]))).role !== "moderator") throw new Error("friend not staff");
  await remove(A, FR);
  if ((await invitesList(A)).length !== 1) throw new Error("stray invite");
});

// ---- what an admin may and may not do ----------------------------------------------------
await expectOk("admin: may add and remove moderators, may not touch owners, admins or their invites", async () => {
  if ((await add(B, "dave@txstate.edu", "moderator")) !== "added") throw new Error("dave");
  await fails(() => add(B, "erin@txstate.edu", "admin"), /^Not allowed$/);
  await fails(() => add(B, "erin@txstate.edu", "owner"), /^Not allowed$/);
  await fails(() => setRole(B, C, "admin"), /^Not allowed$/);
  await fails(() => setRole(B, A, "admin"), /^Not allowed$/);
  await fails(() => setRole(B, A, "moderator"), /^Not allowed$/);
  await fails(() => remove(B, A), /^Not allowed$/);
  await fails(() => remove(B, B), /cannot remove yourself/);
  await fails(() => setRole(B, B, "owner"), /cannot change your own role/);
  await remove(B, D); // a moderator
  const rem = await lastLog(); if (rem.action !== "staff.remove" || rem.actor_id !== B || rem.actor_email !== "bob@txstate.edu" || rem.details.email !== "dave@txstate.edu" || rem.details.role !== "moderator" || rem.details.cause !== "admin") throw new Error(JSON.stringify(rem));
  await revoke(B, "future@txstate.edu"); // a moderator invite
  if ((await add(A, "boss@txstate.edu", "owner")) !== "invited") throw new Error("boss");
  await fails(() => revoke(B, "boss@txstate.edu"), /^Not allowed$/);
  await fails(() => add(B, "boss@txstate.edu", "moderator"), /^Not allowed$/); // may not downgrade an owner-level invite
  await fails(() => revoke(B, "nobody@txstate.edu"), /No invitation/);
  await revoke(A, "boss@txstate.edu");
  if ((await invitesList(A)).length !== 0) throw new Error("invites left");
  if ((await staffList(A)).map((s) => s.email).join() !== "owner@gmail.com,bob@txstate.edu,carol@txstate.edu") throw new Error("list");
});
await expectOk("moderator: sees the team (not others' 2FA state), no invites, only moderation and own rows in the log, changes nothing", async () => {
  const list = await staffList(C);
  if (list.length !== 3) throw new Error("list");
  if (list.find((s) => s.user_id === C).mfa_enrolled !== true || list.find((s) => s.user_id === A).mfa_enrolled !== null || list.find((s) => s.user_id === B).mfa_enrolled !== null) throw new Error("2FA state leaked to a moderator: " + JSON.stringify(list.map((s) => [s.email, s.mfa_enrolled])));
  await fails(() => invitesList(C), /^Not allowed$/);
  const log = await auditList(C);
  if (log.some((l) => l.actor_id !== C && !/^(content|report|user|media)\./.test(l.action))) throw new Error("team history leaked to a moderator: " + JSON.stringify(log.map((l) => l.action)));
  await fails(() => add(C, "erin@txstate.edu", "moderator"), /^Not allowed$/);
  await fails(() => setRole(C, B, "moderator"), /^Not allowed$/);
  await fails(() => remove(C, B), /^Not allowed$/);
  await fails(() => revoke(C, "x@txstate.edu"), /^Not allowed$/);
});
await expectOk("set_role: unknown people, same role (no-op, no audit row), owners changing themselves", async () => {
  await fails(() => setRole(A, E, "moderator"), /Not a staff member/);
  await fails(() => remove(A, E), /Not a staff member/);
  await fails(() => setRole(A, A, "admin"), /cannot change your own role/);
  await fails(() => setRole(A, B, "boss"), /Invalid role/);
  const before = (await logRows()).length; await setRole(A, B, "admin"); if ((await logRows()).length !== before) throw new Error("no-op logged");
});

// ---- invites die with the authority of the person who issued them ---------------------------
await expectOk("removing or demoting someone withdraws the invites they issued; a deleted inviter takes theirs along", async () => {
  if ((await add(B, "mod1@txstate.edu", "moderator")) !== "invited") throw new Error("mod1");
  await setRole(A, B, "moderator"); // demoted: may grant nothing
  if ((await invitesList(A)).some((i) => i.email === "mod1@txstate.edu")) throw new Error("demoted admin's invite survived");
  const l1 = (await logRows()).at(-1); if (l1.action !== "invite.revoke" || l1.details.reason !== "inviter demoted" || l1.target_id !== "mod1@txstate.edu") throw new Error(JSON.stringify(l1));
  await setRole(A, B, "admin");
  if ((await add(B, "mod2@txstate.edu", "moderator")) !== "invited") throw new Error("mod2");
  await setRole(A, B, "owner"); // promotion keeps invites
  if (!(await invitesList(A)).some((i) => i.email === "mod2@txstate.edu")) throw new Error("promotion dropped an invite");
  if ((await add(B, "boss2@txstate.edu", "owner")) !== "invited") throw new Error("boss2");
  await setRole(A, B, "admin"); // owner -> admin: the owner-level invite goes, the moderator one stays
  const inv = (await invitesList(A)).map((i) => i.email); if (inv.includes("boss2@txstate.edu") || !inv.includes("mod2@txstate.edu")) throw new Error(inv.join());
  await remove(A, B); // removed: everything goes
  if ((await invitesList(A)).some((i) => i.invited_by === B)) throw new Error("removed admin's invites survived");
  const l2 = (await logRows()).filter((l) => l.action === "invite.revoke" && l.details.reason === "inviter removed"); if (l2.length !== 1 || l2[0].target_id !== "mod2@txstate.edu") throw new Error(JSON.stringify(l2));
  if ((await add(A, "bob@txstate.edu", "admin")) !== "added") throw new Error("re-add bob");
  // deleting an inviter's account removes their pending invites through the foreign key
  const F = await mk("frank@txstate.edu", "Frank Admin"); if ((await add(A, "frank@txstate.edu", "admin")) !== "added") throw new Error("frank");
  if ((await add(F, "mod3@txstate.edu", "moderator")) !== "invited") throw new Error("mod3");
  await as(F, () => db.query("select public.delete_my_account()"), MFA);
  if ((await invitesList(A)).some((i) => i.email === "mod3@txstate.edu")) throw new Error("deleted inviter's invite survived");
});
await expectOk("claim time re-checks the inviter: an invite whose inviter can no longer grant that role is withdrawn, not granted", async () => {
  await db.query("insert into public.staff_invites (email, role, invited_by) values ('sneaky@txstate.edu', 'admin', $1)", [C]); // as if a moderator had issued an admin invite
  const S = await mk("sneaky@txstate.edu", "Sneaky");
  if ((await one(db.query("select count(*)::int n from public.staff where user_id=$1", [S]))).n !== 0) throw new Error("granted");
  if ((await one(db.query("select count(*)::int n from public.staff_invites where email='sneaky@txstate.edu'"))).n !== 0) throw new Error("invite kept");
  const l = await lastLog(); if (l.action !== "invite.revoke" || !/inviter no longer/.test(l.details.reason)) throw new Error(JSON.stringify(l));
});

// ---- an account that existed before the invite is never auto-promoted -------------------------
await expectOk("squatting: an address registered (unconfirmed) BEFORE the invite cannot be invited, and if it was, confirming holds the invite instead of granting it", async () => {
  const M = await mk("newhire@txstate.edu", "Mallory", { confirmed: false }); // someone grabbed the address first
  await db.query("update auth.users set created_at = now() - interval '2 days' where id = $1", [M]); // (PGlite's clock is coarse; real sign-ups are seconds or days apart)
  await fails(() => add(A, "newhire@txstate.edu", "admin"), /already signed up with this address but has not confirmed/);
  // Even if an invite slipped in (written after the account existed), confirmation does not grant it.
  await db.query("insert into public.staff_invites (email, role, invited_by) values ('newhire@txstate.edu', 'admin', $1)", [A]);
  await db.query("update auth.users set email_confirmed_at = now() where id=$1", [M]);
  if ((await one(db.query("select count(*)::int n from public.staff where user_id=$1", [M]))).n !== 0) throw new Error("squatter became staff");
  const held = await lastLog(); if (held.action !== "invite.held" || held.target_id !== M || held.details.reason !== "account predates invite") throw new Error(JSON.stringify(held));
  if ((await invitesList(A)).find((i) => i.email === "newhire@txstate.edu")?.role !== "admin") throw new Error("held invite should stay visible to owners");
  // Once an owner has checked with the real person, the confirmed account is added directly and the held invite goes.
  if ((await add(A, "newhire@txstate.edu", "admin")) !== "added") throw new Error("direct add");
  if ((await invitesList(A)).some((i) => i.email === "newhire@txstate.edu")) throw new Error("stale invite");
  await remove(A, M);
});

// ---- the last owner can never disappear ------------------------------------------------
await expectOk("owners: promote, hand over, and the last owner is protected everywhere", async () => {
  await setRole(A, B, "owner"); // two owners
  if ((await as(A, () => one(db.query("select * from public.admin_me()")), MFA)).last_owner !== false) throw new Error("last_owner with two owners");
  await setRole(B, A, "admin"); // Bob is now the only owner
  if ((await staffList(B)).map((s) => `${s.email}:${s.role}`).join() !== "bob@txstate.edu:owner,owner@gmail.com:admin,carol@txstate.edu:moderator") throw new Error("roles");
  await fails(() => setRole(A, B, "admin"), /^Not allowed$/); // an admin cannot demote the owner
  await fails(() => remove(B, B), /cannot remove yourself/);
  await fails(() => setRole(B, B, "admin"), /cannot change your own role/);
  // Straight SQL as the database owner hits the guards too.
  await fails(() => db.query("update public.staff set role = 'admin' where user_id = $1", [B]), /last owner/);
  await fails(() => db.query("delete from public.staff where user_id = $1", [B]), /last owner/);
  await fails(() => db.query("delete from auth.users where id = $1", [B]), /last owner/); // cascading account deletion
  await fails(() => db.query("truncate public.staff"), /cannot be truncated/);
  await fails(() => db.query("truncate public.profiles cascade"), /cannot be truncated/);
  await fails(() => db.query("truncate auth.users cascade"), /cannot be truncated/);
  await fails(() => as(B, () => db.query("select public.delete_my_account()"), MFA), /only owner of Apartment Book/); // from the app, with the reason spelled out
  if ((await one(db.query("select role from public.staff where user_id=$1", [B]))).role !== "owner") throw new Error("Bob lost owner");
  await setRole(B, A, "owner"); // two owners again
  await setRole(A, B, "admin"); // Bob steps down
  await db.query("delete from auth.users where id = $1", [D]); // an ex-staff account can go
});
await expectOk("staff accounts need a second factor to be deleted; a non-owner staff account then goes, and the removal is logged", async () => {
  await fails(() => as(B, () => db.query("select public.delete_my_account()")), /Two-factor authentication required/);
  await as(B, () => db.query("select public.delete_my_account()"), MFA);
  if ((await one(db.query("select count(*)::int n from public.staff where user_id=$1", [B]))).n !== 0) throw new Error("cascade did not remove Bob's staff row");
  const l = (await logRows()).filter((x) => x.action === "staff.remove" && x.details.cause === "account_deleted"); const bob = l.find((x) => x.target_id === B);
  if (!bob || bob.actor_id !== B || bob.actor_email !== "bob@txstate.edu" || bob.details.email !== "bob@txstate.edu" || bob.details.role !== "admin") throw new Error(JSON.stringify(l));
  const T = await mk("temp@txstate.edu", "Temp Student"); // students are unaffected by the staff rule (no 2FA needed)
  await as(T, () => db.query("select public.delete_my_account()"));
  if ((await one(db.query("select count(*)::int n from auth.users where id=$1", [T]))).n !== 0) throw new Error("student could not delete their account");
});

// ---- audit log ------------------------------------------------------------------------------
await expectOk("audit log: every action recorded with the actor's email and name, newest first, paginated", async () => {
  const log = await auditList(A);
  const actions = new Set(log.map((l) => l.action));
  for (const want of ["owner.bootstrap", "invite.accepted", "invite.held", "staff.add", "staff.role", "staff.remove", "invite.create", "invite.revoke", "security.mfa_enrolled"]) if (!actions.has(want)) throw new Error(`missing ${want} in ${[...actions]}`);
  for (let i = 1; i < log.length; i++) if (Number(log[i - 1].id) <= Number(log[i].id)) throw new Error("not newest first");
  const add = log.find((l) => l.action === "staff.add" && l.details.email === "bob@txstate.edu" && l.details.role === "admin");
  if (add.actor_id !== A || add.actor_email !== "owner@gmail.com" || add.actor_name !== "Olivia Owner") throw new Error(JSON.stringify(add));
  const removed = log.find((l) => l.action === "staff.remove" && l.details.email === "dave@txstate.edu"); if (removed.actor_email !== "bob@txstate.edu" || removed.details.role !== "moderator") throw new Error(JSON.stringify(removed));
  if (removed.actor_name !== null) throw new Error("deleted actor should have no current name"); // Bob's account is gone, his email stays on the row
  const page = await auditList(A, 2); if (page.length !== 2) throw new Error("limit");
  const older = await auditList(A, 50, page[1].id);
  if (!older.length || older.some((l) => Number(l.id) >= Number(page[1].id))) throw new Error("pagination");
  await auditList(A, 100000); await auditList(A, -5);
});
await expectOk("two-factor enrolment and removal are recorded from Supabase Auth's table for staff, never for students", async () => {
  const before = (await logRows()).length;
  const f = await one(db.query("insert into auth.mfa_factors (user_id, status, friendly_name, factor_type) values ($1,'unverified','Phone','totp') returning id", [C]));
  if ((await logRows()).length !== before) throw new Error("unverified factor logged");
  await db.query("update auth.mfa_factors set status = 'verified' where id = $1", [f.id]);
  let l = await lastLog(); if (l.action !== "security.mfa_enrolled" || l.target_id !== C || l.actor_id !== C || l.details.friendly_name !== "Phone") throw new Error(JSON.stringify(l));
  await db.query("delete from auth.mfa_factors where id = $1", [f.id]);
  l = await lastLog(); if (l.action !== "security.mfa_removed" || l.target_id !== C) throw new Error(JSON.stringify(l));
  const n = (await logRows()).length;
  await db.query("insert into auth.mfa_factors (user_id, status) values ($1,'verified')", [E]); await db.query("delete from auth.mfa_factors where user_id = $1", [E]);
  if ((await logRows()).length !== n) throw new Error("student factor logged");
});

// ---- invites are claimed only by confirmed addresses, case-insensitively ---------------------
await expectOk("invite claim: unconfirmed sign-up gets nothing, confirming claims the role; mixed case matches", async () => {
  if ((await add(A, "Mixed.Case@TXSTATE.edu", "moderator")) !== "invited") throw new Error("invite");
  if (!(await invitesList(A)).some((i) => i.email === "mixed.case@txstate.edu")) throw new Error("not lower-cased");
  const F = await mk("mixed.case@txstate.edu", "Frank", { confirmed: false });
  if ((await one(db.query("select count(*)::int n from public.staff where user_id=$1", [F]))).n !== 0) throw new Error("claimed before confirmation");
  await fails(() => add(A, "mixed.case@txstate.edu", "admin"), /has not confirmed/); // an unconfirmed account is neither added nor re-invited
  await db.query("update auth.users set email_confirmed_at = now() where id=$1", [F]);
  const s = await one(db.query("select role, granted_by from public.staff where user_id=$1", [F])); if (s?.role !== "moderator" || s.granted_by !== A) throw new Error(JSON.stringify(s));
  if ((await invitesList(A)).some((i) => i.email === "mixed.case@txstate.edu")) throw new Error("invite kept");
  const accepted = await lastLog(); if (accepted.action !== "invite.accepted" || accepted.details.invited_by !== A || accepted.target_id !== F) throw new Error(JSON.stringify(accepted));
  await db.query("update auth.users set email_confirmed_at = now() where id=$1", [F]); // a later update does not re-fire
  if ((await lastLog()).id !== accepted.id) throw new Error("re-fired");
});
await expectOk("invite claim: an account created already confirmed (Google sign-in, admin-created) is staff at once", async () => {
  if ((await add(A, "direct@txstate.edu", "moderator")) !== "invited") throw new Error("invite");
  const G = await mk("Direct@txstate.edu", "Gina");
  const s = await one(db.query("select role from public.staff where user_id=$1", [G])); if (s?.role !== "moderator") throw new Error(JSON.stringify(s));
  if ((await staffList(A)).some((x) => x.user_id === G && x.email !== "direct@txstate.edu")) throw new Error("email not lower-cased in list");
});
await expectOk("invite claim: a confirmed user who changes their address to an invited one is added when the new address is written", async () => {
  if ((await add(A, "renamed@txstate.edu", "moderator")) !== "invited") throw new Error("invite");
  await db.query("update auth.users set email = 'renamed@txstate.edu' where id = $1", [E]);
  const s = await one(db.query("select role from public.staff where user_id=$1", [E])); if (s?.role !== "moderator") throw new Error(JSON.stringify(s));
  await remove(A, E);
});
await expectOk("a confirmed account whose email is re-invited is added directly and the stale invite disappears", async () => {
  await db.query("insert into public.staff_invites (email, role) values ('renamed@txstate.edu', 'moderator')"); // e.g. invited, then confirmed before the trigger existed
  if ((await add(A, "renamed@txstate.edu", "moderator")) !== "added") throw new Error("not added");
  if ((await one(db.query("select count(*)::int n from public.staff_invites where email='renamed@txstate.edu'"))).n !== 0) throw new Error("stale invite kept");
});
done("MIGRATION-14");
