// Migration 49 (UniBuzz Business v2: team roles and the business audit log) against PGlite: v1 staff become editors;
// what an owner, an admin, an editor and an analyst may each do, in the database whatever the client sends; who sits
// in the inquiry chats (never an analyst); inviting, changing roles and removing people; the audit log and who reads
// it; the notifications a review sends; the invite rate limit; and the rollback.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261107000000_business_teams.sql";
const ADS = "migrations/20261107000100_business_ads.sql";
const ROLLBACK = "rollbacks/20261107000000_business_teams.down.sql";
const ADS_ROLLBACK = "rollbacks/20261107000100_business_ads.down.sql";
const HARDENING = "migrations/20261109000100_business_hardening.sql";
const HARDENING_ROLLBACK = "rollbacks/20261109000100_business_hardening.down.sql";

/** Helpers bound to one database. */
function helpers(db, as) {
  const one = async (p) => (await p).rows[0];
  const rows = async (p) => (await p).rows;
  const signUp = async (email, meta) => (await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify(meta)])).rows[0].id;
  const confirm = (id) => db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
  const review = (admin, business, decision, note = null) => as(admin, () => db.query("select public.admin_review_business($1, $2, $3)", [business, decision, note]));
  const memberRole = async (id) => (await one(db.query("select role from public.business_members where user_id = $1", [id])))?.role ?? null;
  return { one, rows, signUp, confirm, review, memberRole };
}

// --- v1's staff become editors ------------------------------------------------------------------------------------
await expectOk("on a database with v1's team, the migration makes every staff member an editor and keeps them in the chats", async () => {
  const { db, mk, as } = await boot({ upTo: "20261105000000_anonymous_listings.sql" });
  const h = helpers(db, as);
  const admin = await mk("old.admin@txstate.edu", "Old Admin");
  const student = await mk("old.student@txstate.edu", "Old Student");
  await db.query("select public.grant_role($1, 'admin')", [admin]);
  const owner = await h.signUp("owner@oldbiz.example", { account_type: "business", full_name: "Olive Owner", business_name: "Old Biz", business_category: "food" });
  await h.confirm(owner);
  const business = (await h.one(db.query("select id from public.businesses where owner_id = $1", [owner]))).id;
  await h.review(admin, business, "approved");
  const inv = await as(owner, () => h.one(db.query("select * from public.business_invite_create('staffer@oldbiz.example')")));
  const staff = await h.signUp("staffer@oldbiz.example", { account_type: "business", full_name: "Stan Staff", business_invite: inv.token });
  await h.confirm(staff);
  if ((await h.memberRole(staff)) !== "staff") throw new Error("v1 did not make a staff member");
  const deal = (await as(owner, () => h.one(db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, 'Old deal') returning id", [business, owner])))).id;
  const chat = await as(student, () => h.one(db.query("select public.start_business_inquiry('deal', $1) as id", [deal])));
  await db.exec(read(MIGRATION));
  if ((await h.memberRole(staff)) !== "editor") throw new Error(`staff became ${await h.memberRole(staff)}`);
  const inChat = await h.rows(db.query("select user_id from public.conversation_members where conversation_id = $1", [chat.id]));
  if (!inChat.some((r) => r.user_id === staff)) throw new Error("the editor left the chat");
  const invites = await h.rows(db.query("select role from public.business_invites"));
  if (invites.some((i) => i.role !== "editor")) throw new Error(JSON.stringify(invites));
  await db.exec(read(MIGRATION));
  await db.close();
});

// --- The main database --------------------------------------------------------------------------------------------
const { db, mk, as, asAnon } = await boot();
const { one, rows, signUp, confirm, review, memberRole } = helpers(db, as);

const admin = await mk("ann@txstate.edu", "Ann Avery");
const ben = await mk("ben@txstate.edu", "Ben Brooks");
await db.query("select public.grant_role($1, 'admin')", [admin]);
const txstate = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;

const owner = await signUp("rita@riverrock.example", { account_type: "business", full_name: "Rita Rock", business_name: "River Rock Apartments", business_category: "housing", business_university_id: txstate });
await confirm(owner);
const business = (await one(db.query("select id from public.businesses where owner_id = $1", [owner]))).id;

/** Invite (as `by`), sign up from the link and confirm: the new member's id. */
async function join(by, email, name, role) {
  const inv = await as(by, () => one(db.query("select * from public.business_invite_create($1, $2)", [email, role])));
  const id = await signUp(email, { account_type: "business", full_name: name, business_invite: inv.token });
  await confirm(id);
  return id;
}

let adam, eve, ana;
await expectOk("a pending business's owner invites an admin, an editor and an analyst; each joins as that role", async () => {
  adam = await join(owner, "adam@riverrock.example", "Adam Admin", "admin");
  eve = await join(owner, "eve@riverrock.example", "Eve Editor", "editor");
  ana = await join(owner, "ana@riverrock.example", "Ana Analyst", "analyst");
  const got = [await memberRole(adam), await memberRole(eve), await memberRole(ana)];
  if (got.join() !== "admin,editor,analyst") throw new Error(got.join());
});

await expectOk("the join page says what an invite joins as", async () => {
  const inv = await as(owner, () => one(db.query("select * from public.business_invite_create('later@riverrock.example', 'analyst')")));
  const look = await asAnon(() => one(db.query("select * from public.business_invite_lookup($1)", [inv.token])));
  if (look.role !== "analyst" || !look.valid) throw new Error(JSON.stringify(look));
});
await expectOk("v1's one-argument invite still works and makes an editor", async () => {
  const inv = await as(owner, () => one(db.query("select (public.business_invite_create('oldstyle@riverrock.example')).role")));
  if (inv.role !== "editor") throw new Error(inv.role);
});
await expectError("an admin cannot invite another admin", () => as(adam, () => db.query("select public.business_invite_create('x@riverrock.example', 'admin')")), "Only the owner can make someone an admin");
await expectOk("an admin invites an editor", () => as(adam, () => db.query("select public.business_invite_create('x@riverrock.example', 'editor')")));
await expectError("an editor cannot invite anyone", () => as(eve, () => db.query("select public.business_invite_create('y@riverrock.example', 'analyst')")), "owner or an admin");
await expectError("nor can an analyst", () => as(ana, () => db.query("select public.business_invite_create('y@riverrock.example', 'analyst')")), "owner or an admin");
await expectError("an invite is for an admin, an editor or an analyst", () => as(owner, () => db.query("select public.business_invite_create('y@riverrock.example', 'owner')")), "an admin, an editor or an analyst");
await expectOk("editors and analysts do not see the pending invites; the owner and admins do", async () => {
  const counts = [];
  for (const who of [owner, adam, eve, ana]) counts.push((await as(who, () => rows(db.query("select id from public.business_invites where business_id = $1", [business])))).length);
  if (!(counts[0] > 0 && counts[1] === counts[0] && counts[2] === 0 && counts[3] === 0)) throw new Error(counts.join());
});

// --- What each role may do ----------------------------------------------------------------------------------------
const MATRIX = {
  //            view analytics publish reply manage_team edit_profile manage_ads
  pending: { [owner]: "1110110", [adam]: "1110110", [eve]: "1110000", [ana]: "1100000" },
  approved: { [owner]: "1111111", [adam]: "1111111", [eve]: "1111000", [ana]: "1100000" },
};
const CAPS = ["view", "analytics", "publish", "reply", "manage_team", "edit_profile", "manage_ads"];
async function capabilities(who) {
  let out = "";
  for (const c of CAPS) out += (await as(who, () => one(db.query("select public.business_can($1, $2) as ok", [business, c])))).ok ? "1" : "0";
  return out;
}
await expectOk("while pending: drafting and the team, no replies, no ads", async () => {
  for (const [who, want] of Object.entries(MATRIX.pending)) {
    const got = await capabilities(who);
    if (got !== want) throw new Error(`${who}: ${got}, want ${want}`);
  }
});
await review(admin, business, "approved");
await expectOk("once approved: the table in the migration's header, role by role", async () => {
  for (const [who, want] of Object.entries(MATRIX.approved)) {
    const got = await capabilities(who);
    if (got !== want) throw new Error(`${who}: ${got}, want ${want}`);
  }
});
await expectOk("approval tells every member, analysts included", async () => {
  for (const who of [owner, adam, eve, ana]) {
    const n = await as(who, () => rows(db.query("select title, link, data from public.notifications where type = 'business'")));
    if (!n.some((x) => x.title === "Your business is approved" && x.link === "/" && x.data.portal === true)) throw new Error(`${who}: ${JSON.stringify(n)}`);
  }
});
await expectOk("the owner and an admin edit the profile; an editor and an analyst change nothing", async () => {
  await as(adam, () => db.query("update public.businesses set description = 'By the river' where id = $1", [business]));
  for (const who of [eve, ana]) {
    const r = await as(who, () => rows(db.query("update public.businesses set description = 'Hacked' where id = $1 returning id", [business])));
    if (r.length) throw new Error(`${who} edited the profile`);
  }
  if ((await one(db.query("select description from public.businesses where id = $1", [business]))).description !== "By the river") throw new Error("description");
});
let deal, apt;
await expectOk("an editor publishes a post and a listing (owned by the business's owner)", async () => {
  deal = (await as(eve, () => one(db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, 'Move-in special') returning id", [business, eve])))).id;
  apt = (await as(eve, () => one(db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id) values ($1, $2, 'Two-bed', 'Pool', 1200, '1 River Rd', $3) returning id", [owner, business, txstate])))).id;
});
await expectError("an analyst cannot publish a post", () => as(ana, () => db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, 'Nope')", [business, ana])), "row-level security");
await expectError("nor a listing", () => as(ana, () => db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address) values ($1, $2, 'Studio', 'S', 900, '2 River Rd')", [owner, business])), "row-level security");
await expectOk("an analyst reads the posts, listings and numbers", async () => {
  const d = await as(ana, () => rows(db.query("select id from public.deals where business_id = $1", [business])));
  const a = await as(ana, () => rows(db.query("select id from public.apartments where business_id = $1", [business])));
  const o = await as(ana, () => one(db.query("select * from public.business_overview($1)", [business])));
  if (d.length !== 1 || a.length !== 1 || Number(o.team) !== 4) throw new Error(JSON.stringify({ d, a, o }));
});

// --- Inquiry chats: the owner, admins and editors -------------------------------------------------------------------
let chat;
await expectOk("a student's inquiry holds the owner, the admin and the editor, never the analyst", async () => {
  chat = (await as(ben, () => one(db.query("select public.start_business_inquiry('apartment', $1) as id", [apt])))).id;
  const m = (await rows(db.query("select user_id from public.conversation_members where conversation_id = $1", [chat]))).map((r) => r.user_id).sort();
  const want = [ben, owner, adam, eve].sort();
  if (m.join() !== want.join()) throw new Error(JSON.stringify(m));
});
await expectError("the business still cannot write first", () => as(eve, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Hi!')", [chat, eve])), "only reply");
await expectOk("the student writes; the editor replies", async () => {
  await as(ben, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Is it free?')", [chat, ben]));
  await as(eve, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Yes!')", [chat, eve]));
});
await expectOk("an analyst reads neither the chat nor its messages, nor the student's profile", async () => {
  const c = await as(ana, () => rows(db.query("select id from public.conversations where id = $1", [chat])));
  const msgs = await as(ana, () => rows(db.query("select id from public.messages where conversation_id = $1", [chat])));
  const p = await as(ana, () => rows(db.query("select id from public.profiles where id = $1", [ben])));
  if (c.length || msgs.length || p.length) throw new Error(JSON.stringify({ c, msgs, p }));
});
await expectError("and cannot write in it", () => as(ana, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Hello')", [chat, ana])), "can't send messages");
await expectOk("the editor sees the student who wrote; the analyst does not", async () => {
  const p = await as(eve, () => rows(db.query("select id from public.profiles where id = $1", [ben])));
  if (p.length !== 1) throw new Error("the editor cannot see the student");
});

// --- Changing roles -----------------------------------------------------------------------------------------------
await expectOk("the analyst becomes an editor: in every chat at once, and told so", async () => {
  await as(owner, () => db.query("select public.business_member_set_role($1, 'editor')", [ana]));
  const m = await rows(db.query("select 1 from public.conversation_members where conversation_id = $1 and user_id = $2", [chat, ana]));
  const n = await as(ana, () => rows(db.query("select body from public.notifications where type = 'business' and title = 'Your role changed'")));
  if (m.length !== 1 || !n[0]?.body.includes("editor")) throw new Error(JSON.stringify({ m, n }));
});
await expectOk("and back to analyst: out of every chat", async () => {
  await as(adam, () => db.query("select public.business_member_set_role($1, 'analyst')", [ana]));
  const m = await rows(db.query("select 1 from public.conversation_members where conversation_id = $1 and user_id = $2", [chat, ana]));
  if (m.length !== 0) throw new Error("still in the chat");
});
await expectError("an admin cannot make anyone an admin", () => as(adam, () => db.query("select public.business_member_set_role($1, 'admin')", [eve])), "Only the owner can make or change an admin");
await expectError("nobody changes the owner's role", () => as(owner, () => db.query("select public.business_member_set_role($1, 'editor')", [owner])), "The owner stays the owner");
await expectError("an editor changes nobody's role", () => as(eve, () => db.query("select public.business_member_set_role($1, 'editor')", [ana])), "Only the owner or an admin");
await expectError("a student changes nobody's role either", () => as(ben, () => db.query("select public.business_member_set_role($1, 'editor')", [ana])), "Only the owner or an admin");
let second;
await expectError("an admin cannot remove another admin", async () => {
  second = await join(owner, "second.admin@riverrock.example", "Sam Second", "admin");
  await as(adam, () => db.query("select public.business_member_remove($1)", [second]));
}, "Only the owner can remove an admin");
await expectOk("an admin removes an analyst; the owner removes an admin", async () => {
  await as(adam, () => db.query("select public.business_member_remove($1)", [ana]));
  await as(owner, () => db.query("select public.business_member_remove($1)", [second]));
  if ((await memberRole(ana)) !== null || (await memberRole(second)) !== null) throw new Error("still on the team");
});
await expectError("the owner cannot leave", () => as(owner, () => db.query("select public.business_member_remove($1)", [owner])), "cannot leave");
await expectError("there is one owner per business", () => db.query("update public.business_members set role = 'owner' where user_id = $1", [eve]), "business_members_one_owner");

// --- The audit log ------------------------------------------------------------------------------------------------
await expectOk("the owner reads the business's log: invites, joins, role changes, removals, the review by \"UniBuzz team\"", async () => {
  const log = await as(owner, () => rows(db.query("select action, actor_name, actor_kind from public.business_audit($1)", [business])));
  const actions = new Set(log.map((l) => l.action));
  for (const a of ["invite_created", "member_joined", "role_changed", "member_removed", "business_approved", "profile_updated"]) if (!actions.has(a)) throw new Error(`no ${a}: ${[...actions]}`);
  const reviewed = log.find((l) => l.action === "business_approved");
  if (reviewed.actor_name !== "UniBuzz team" || reviewed.actor_kind !== "admin") throw new Error(JSON.stringify(reviewed));
});
await expectOk("the UniBuzz team's admin reads every business's log, with the reviewer's name", async () => {
  const log = await as(admin, () => rows(db.query("select action, actor_name from public.business_audit(null)")));
  if (log.find((l) => l.action === "business_approved")?.actor_name !== "Ann Avery") throw new Error(JSON.stringify(log.slice(0, 3)));
});
await expectError("an editor cannot read the log", () => as(eve, () => db.query("select * from public.business_audit($1)", [business])), "owner and admins");
await expectError("a student cannot either", () => as(ben, () => db.query("select * from public.business_audit($1)", [business])), "owner and admins");
await expectError("nobody reads the table directly", () => as(owner, () => db.query("select * from public.business_audit_log")), "permission denied");
await expectError("and nobody changes it, the database owner included", () => db.query("update public.business_audit_log set action = 'x'"), "append-only");
await expectError("or empties it", () => db.query("delete from public.business_audit_log"), "append-only");

// --- Invites: 30 a day --------------------------------------------------------------------------------------------
await expectError("a business sends 30 invites a day at most (revoked ones count)", async () => {
  for (let i = 0; i < 40; i++) {
    const inv = await as(owner, () => one(db.query("select * from public.business_invite_create($1, 'editor')", [`spam${i}@riverrock.example`])));
    await as(owner, () => db.query("select public.business_invite_revoke($1)", [inv.id]));
  }
}, "30 invites today");

// --- Suspension: every role is out ----------------------------------------------------------------------------------
await expectOk("suspending the business closes every role out of everything but the standing", async () => {
  await review(admin, business, "suspended", "Unpaid invoices");
  for (const who of [owner, adam, eve]) {
    const caps = await capabilities(who);
    if (caps !== "0000000") throw new Error(`${who}: ${caps}`);
  }
  const n = await as(eve, () => rows(db.query("select body from public.notifications where title = 'Your business is suspended'")));
  if (n[0]?.body !== "Unpaid invoices") throw new Error(JSON.stringify(n));
});

// --- Rollback -----------------------------------------------------------------------------------------------------
await expectOk("the rollback (after 56's and part 2's) puts v1 back: editors and admins are staff again, v1's invite function, no log", async () => {
  await db.exec(read(HARDENING_ROLLBACK));
  await db.exec(read(ADS_ROLLBACK));
  await db.exec(read(ROLLBACK));
  const roles = (await rows(db.query("select distinct role from public.business_members where business_id = $1", [business]))).map((r) => r.role).sort();
  if (roles.join() !== "owner,staff") throw new Error(roles.join());
  const fns = await rows(db.query("select p.oid::regprocedure::text as f from pg_proc p where p.proname in ('business_invite_create', 'business_can', 'business_audit') and p.pronamespace = 'public'::regnamespace"));
  if (fns.map((f) => f.f).join() !== "business_invite_create(text)") throw new Error(JSON.stringify(fns));
  if (await one(db.query("select to_regclass('public.business_audit_log') as t")).then((r) => r.t)) throw new Error("log still there");
  const types = await one(db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notifications_type_check'"));
  if (types.d.includes("'business'")) throw new Error("type left");
});
await expectOk("v1's rules hold after the rollback: staff reply, the owner removes staff", async () => {
  await review(admin, business, "approved");
  await as(eve, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Back again')", [chat, eve]));
  await as(owner, () => db.query("select public.business_member_remove($1)", [eve]));
});
await expectOk("and both migrations apply again on top", async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read(ADS));
  await db.exec(read(HARDENING));
  if ((await memberRole(adam)) !== "editor") throw new Error(`adam is ${await memberRole(adam)}`);
});

done("BUSINESS TEAMS");
