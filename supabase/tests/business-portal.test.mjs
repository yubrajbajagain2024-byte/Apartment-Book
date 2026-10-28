// Migration 39 (the business portal) against PGlite: roles nobody can give themselves; business sign-up; team invites
// used up only once the address is confirmed; admin review and what each standing (pending, approved, rejected,
// suspended) lets a team do; "Verified Partner" only with recorded verification and "Sponsored" only with a paid
// promotion running; listings, deals, inquiries and the no-cold-messages rules; business sessions kept off the student
// side; and the portal's numbers. The same rules on a real Supabase project: supabase/tests/staging/business-portal.mjs.
// Since migrations 49 and 50 (UniBuzz Business v2) these rules run on every migration, so they also check that v2 kept
// them; v2's own rules are in business-teams.test.mjs and business-ads.test.mjs.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const MIGRATION = "migrations/20261101000000_business_portal.sql";
// Re-run on a database that stops at this migration: re-running it over later ones would bring back the functions they
// replaced (migration 49's team roles among them).
await expectOk("the migration re-runs cleanly, with the confirmation trigger auth.users' email_confirmed_at allows", async () => {
  const { db: first } = await boot({ upTo: "20261101000000_business_portal.sql" });
  await first.exec(read(MIGRATION));
  const t = await first.query("select 1 from pg_trigger where tgname = 'business_invite_claim_on_confirm'");
  if (t.rows.length !== 1) throw new Error("no confirmation trigger");
  await first.close();
});
const { db, mk, as, asAnon } = await boot();
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const signUp = async (email, meta) => (await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify(meta)])).rows[0].id;
const confirm = (id) => db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
const roleOf = (id) => one(db.query("select role, university_id from public.profiles where id = $1", [id]));
const member = (id) => one(db.query("select business_id, role, invited_by from public.business_members where user_id = $1", [id]));
const txstate = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const utsa = (await one(db.query("select id from public.universities where name = 'University of Texas at San Antonio'"))).id;
const review = (admin, business, decision, note = null) => as(admin, () => db.query("select public.admin_review_business($1, $2, $3)", [business, decision, note]));
/** An update or delete that RLS filters out returns no rows instead of failing; this makes that an error to expect. */
const mustChange = async (fn) => {
  const r = await fn();
  if (!r.rows.length) throw new Error("no rows: row-level security");
  throw new Error("changed");
};

// --- Roles -------------------------------------------------------------------------------------------------------
const admin = await mk("ann@txstate.edu", "Ann Avery"), ben = await mk("ben@txstate.edu", "Ben Brooks"), cat = await mk("cat@txstate.edu", "Cat Cruz");
await confirm(admin);
await expectOk("a student's profile starts as role student", async () => {
  if ((await roleOf(ben)).role !== "student") throw new Error("not a student");
});
await expectOk("a student cannot make themselves an admin (the role is kept, the rest of the update goes through)", async () => {
  await as(ben, () => db.query("update public.profiles set role = 'admin', bio = 'hi' where id = $1", [ben]));
  const r = await one(db.query("select role, bio from public.profiles where id = $1", [ben]));
  if (r.role !== "student" || r.bio !== "hi") throw new Error(JSON.stringify(r));
});
await expectError("grant_role() is not callable through the API", () => as(ben, () => db.query("select public.grant_role($1, 'admin')", [ben])), "permission denied");
await expectOk("the database owner makes Ann an admin; my_role() says so", async () => {
  await db.query("select public.grant_role($1, 'admin')", [admin]);
  if ((await as(admin, () => one(db.query("select public.my_role() as role")))).role !== "admin") throw new Error("not admin");
});
await expectError("a university address is still required for a student sign-up", () => signUp("someone@gmail.com", { full_name: "Some One" }), "university email");
await expectError("helpers that name a person's business are not callable through the API", () => asAnon(() => db.query("select public.business_of($1)", [ben])), "permission denied");

// --- Business sign-up and review ---------------------------------------------------------------------------------
let owner, business;
await expectOk("a business signs up with any address: business_owner, no university, a pending business", async () => {
  owner = await signUp("hello@riverrock.example", { account_type: "business", full_name: "Rita Rock", business_name: "River Rock Apartments", business_category: "housing", business_university_id: txstate, business_phone: "512-555-0100", business_website: "https://riverrock.example" });
  const r = await roleOf(owner);
  const b = await one(db.query("select id, name, status, verified_partner, university_ids, contact_email from public.businesses where owner_id = $1", [owner]));
  if (r.role !== "business_owner" || r.university_id !== null || b.status !== "pending" || b.verified_partner || b.university_ids[0] !== txstate || b.contact_email !== "hello@riverrock.example") throw new Error(JSON.stringify({ r, b }));
  if ((await member(owner)).role !== "owner") throw new Error("not the owner");
  business = b.id;
});
await expectError("an admin cannot approve a business whose owner has not confirmed their email", () => review(admin, business, "approved"), "not confirmed");
await expectError("a student cannot review businesses", () => review(ben, business, "approved"), "admins");
await expectError("a student cannot list them either", () => as(ben, () => db.query("select * from public.admin_list_businesses(null)")), "admins");
await expectOk("the admin's queue shows the business with its owner's email and whether it is confirmed", async () => {
  const q = await as(admin, () => rows(db.query("select name, owner_email, owner_confirmed from public.admin_list_businesses('pending')")));
  const row = q.find((b) => b.name === "River Rock Apartments");
  if (!row || row.owner_email !== "hello@riverrock.example" || row.owner_confirmed !== false) throw new Error(JSON.stringify(q));
});
const listing = (biz, by = owner) => as(by, () => db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id) values ($1, $2, 'Two-bed by the river', 'Pool, gym, shuttle to campus.', 1200, '1 River Rd', $3) returning id", [owner, biz, txstate]));
await expectError("a pending business cannot post a listing", () => listing(business), "row-level security");
await expectError("a business account cannot post a listing as a plain student either", () => listing(null), "row-level security");
await expectOk("a pending business is invisible to students; its own team sees it", async () => {
  const anon = await asAnon(() => rows(db.query("select id from public.businesses where id = $1", [business])));
  const mine = await as(owner, () => rows(db.query("select id, status from public.businesses where id = $1", [business])));
  if (anon.length !== 0 || mine.length !== 1) throw new Error(`${anon.length} / ${mine.length}`);
});
await expectOk("a pending business drafts a deal, which no student sees", async () => {
  await as(owner, () => db.query("insert into public.deals (business_id, created_by, title, university_ids) values ($1, $2, 'Opening week', array[$3::uuid])", [business, owner, txstate]));
  const seen = await as(ben, () => rows(db.query("select id from public.deals where business_id = $1", [business])));
  if (seen.length !== 0) throw new Error("a student saw a pending business's deal");
});
await expectOk("once the owner confirms, the admin approves; approval alone verifies nothing", async () => {
  await confirm(owner);
  await review(admin, business, "approved", "Lease office called back");
  const b = await one(db.query("select status, verified_partner, verified_at, reviewed_by from public.businesses where id = $1", [business]));
  if (b.status !== "approved" || b.verified_partner || b.verified_at !== null || b.reviewed_by !== admin) throw new Error(JSON.stringify(b));
});

// --- Verified Partner --------------------------------------------------------------------------------------------
await expectError("Verified Partner needs a note of what was checked", () => as(admin, () => db.query("select public.admin_set_verified($1, true, 'ok')", [business])), "what was checked");
await expectError("a student cannot verify a business", () => as(ben, () => db.query("select public.admin_set_verified($1, true, 'Business licence 12345 checked')", [business])), "admins");
await expectError("the mark cannot be set without verification, even by the database owner", () => db.query("update public.businesses set verified_partner = true, verified_at = null where id = $1", [business]).then(() => db.query("select set_config('app.business_review', 'on', false)")).then(() => db.query("update public.businesses set verified_partner = true where id = $1", [business])), "businesses_verified_check");
await db.query("select set_config('app.business_review', '', false)");
await expectOk("the admin verifies it with evidence: Verified Partner with when, by whom and what", async () => {
  await as(admin, () => db.query("select public.admin_set_verified($1, true, 'Texas business licence 12345 checked with the state')", [business]));
  const b = await one(db.query("select verified_partner, verified_at, verified_by, verification_note from public.businesses where id = $1", [business]));
  if (!b.verified_partner || !b.verified_at || b.verified_by !== admin || !b.verification_note.includes("12345")) throw new Error(JSON.stringify(b));
});
await expectOk("the owner edits the profile but cannot touch the standing, the mark or the owner", async () => {
  await as(owner, () => db.query("update public.businesses set description = 'Student housing two blocks from campus.', status = 'suspended', verified_partner = false, verification_note = 'self', owner_id = $2 where id = $1", [business, ben]));
  const b = await one(db.query("select description, status, verified_partner, verification_note, owner_id from public.businesses where id = $1", [business]));
  if (b.description !== "Student housing two blocks from campus." || b.status !== "approved" || !b.verified_partner || b.verification_note.includes("self") || b.owner_id !== owner) throw new Error(JSON.stringify(b));
});
await expectOk("students read the mark, never the contact address, the review or the verification evidence", async () => {
  const pub = await asAnon(() => one(db.query("select name, verified_partner from public.businesses where id = $1", [business])));
  if (!pub.verified_partner) throw new Error("no mark");
  for (const col of ["contact_email", "review_note", "verification_note", "verified_by", "reviewed_by"]) {
    try {
      await as(ben, () => db.query(`select ${col} from public.businesses where id = $1`, [business]));
    } catch (e) {
      if (/permission denied/.test(e.message)) continue;
      throw e;
    }
    throw new Error(`a student read ${col}`);
  }
});
await expectOk("the team reads every column through my_business()", async () => {
  const mine = (await as(owner, () => one(db.query("select public.my_business() as m")))).m;
  if (mine.role !== "owner" || mine.business.contact_email !== "hello@riverrock.example" || mine.business.review_note !== "Lease office called back") throw new Error(JSON.stringify(mine));
});

// --- Listings and paid promotions ----------------------------------------------------------------------------------
let apt, studentApt, promo;
// The label itself, whoever may see the row (a suspended business's listing is hidden from everyone but admins).
const sponsored = async (id) => (await one(db.query("select public.listing_sponsored(a) as s from public.apartments a where a.id = $1", [id]))).s;
await expectOk("the approved business posts a listing; a signed-out visitor sees it with the business, not sponsored", async () => {
  apt = (await one(listing(business))).id;
  const seen = await asAnon(() => one(db.query("select b.name, b.verified_partner from public.apartments a join public.businesses b on b.id = a.business_id where a.id = $1", [apt])));
  if (seen.name !== "River Rock Apartments" || !seen.verified_partner || (await sponsored(apt)) !== false) throw new Error(JSON.stringify(seen));
});
await expectOk("a student's own listing still works (no business)", async () => {
  studentApt = (await as(ben, () => one(db.query("insert into public.apartments (owner_id, title, description, price_per_month, address) values ($1, 'Room in a house', 'Quiet street, bus stop outside.', 600, '2 Oak St') returning id", [ben])))).id;
});
await expectError("a student cannot post a listing in a business's name", () => as(ben, () => db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address) values ($1, $2, 'Fake', 'Not theirs at all.', 1, 'x')", [ben, business])), "row-level security");
await expectError("a student cannot move their listing into a business", () => as(ben, () => db.query("update public.apartments set business_id = $2 where id = $1", [studentApt, business])), "row-level security");
await expectError("a promotion is paid: no amount, no promotion", () => as(admin, () => db.query("select public.admin_record_promotion('apartment', $1, now(), now() + interval '7 days', 0, 'USD', 'INV-1')", [apt])), "amount");
await expectError("a promotion needs its payment reference", () => as(admin, () => db.query("select public.admin_record_promotion('apartment', $1, now(), now() + interval '7 days', 5000, 'USD', '')", [apt])), "payment reference");
await expectError("only a business's listings can be promoted", () => as(admin, () => db.query("select public.admin_record_promotion('apartment', $1, now(), now() + interval '7 days', 5000, 'USD', 'INV-1')", [studentApt])), "business");
await expectError("a business cannot record its own promotion", () => as(owner, () => db.query("select public.admin_record_promotion('apartment', $1, now(), now() + interval '7 days', 5000, 'USD', 'INV-1')", [apt])), "admins");
await expectError("nor write the promotions table directly", () => as(owner, () => db.query("insert into public.listing_promotions (business_id, apartment_id, starts_at, ends_at, amount_cents, payment_reference) values ($1, $2, now(), now() + interval '1 day', 1, 'x-1')", [business, apt])), "permission denied");
await expectOk("a paid promotion running now makes the listing Sponsored; one in the future does not", async () => {
  await as(admin, () => db.query("select public.admin_record_promotion('apartment', $1, now() + interval '3 days', now() + interval '10 days', 5000, 'usd', 'INV-0999')", [apt]));
  if ((await sponsored(apt)) !== false) throw new Error("a future promotion counted");
  promo = (await as(admin, () => one(db.query("select public.admin_record_promotion('apartment', $1, now() - interval '1 hour', now() + interval '7 days', 5000, 'USD', 'INV-1001') as id", [apt])))).id;
  if ((await sponsored(apt)) !== true) throw new Error("not sponsored");
});
await expectOk("students cannot read promotions (amounts, references); the team and the admin can", async () => {
  const s = await as(ben, () => rows(db.query("select * from public.listing_promotions")));
  const t = await as(owner, () => rows(db.query("select amount_cents, payment_reference from public.listing_promotions where apartment_id = $1", [apt])));
  const a = await as(admin, () => rows(db.query("select * from public.admin_list_promotions($1)", [business])));
  if (s.length !== 0 || t.length !== 2 || a.length !== 2) throw new Error(`${s.length} / ${t.length} / ${a.length}`);
});
await expectOk("cancelling the promotion takes the label away at once", async () => {
  await as(admin, () => db.query("select public.admin_cancel_promotion($1)", [promo]));
  if ((await sponsored(apt)) !== false) throw new Error("still sponsored");
  promo = (await as(admin, () => one(db.query("select public.admin_record_promotion('apartment', $1, now() - interval '1 hour', now() + interval '7 days', 5000, 'USD', 'INV-1002') as id", [apt])))).id;
});

// --- Team invites: used up only once the address is confirmed -------------------------------------------------------
let token, staff;
await expectError("a student cannot create business invites", () => as(ben, () => db.query("select public.business_invite_create('x@y.example')")), "owner");
await expectError("an address that already has an account cannot be invited", () => as(owner, () => db.query("select public.business_invite_create('ben@txstate.edu')")), "already has");
await expectOk("the owner invites a colleague; the join page looks the invite up signed out", async () => {
  const inv = await as(owner, () => one(db.query("select token, email from public.business_invite_create('Leasing@RiverRock.example')")));
  token = inv.token;
  const look = await asAnon(() => one(db.query("select * from public.business_invite_lookup($1)", [token])));
  if (inv.email !== "leasing@riverrock.example" || token.length !== 64 || look.business_name !== "River Rock Apartments" || !look.valid) throw new Error(JSON.stringify({ inv, look }));
});
await expectOk("signing up from the link with another address: a staff account on no team, no stray business, the invite untouched", async () => {
  const id = await signUp("stranger@elsewhere.example", { account_type: "business", full_name: "Stray Person", business_invite: token });
  await confirm(id);
  const r = await roleOf(id);
  const b = await rows(db.query("select 1 from public.businesses where owner_id = $1", [id]));
  const inv = await one(db.query("select accepted_at from public.business_invites where token = $1", [token]));
  if (r.role !== "business_staff" || (await member(id)) || b.length || inv.accepted_at) throw new Error(JSON.stringify({ r, b, inv }));
});
await expectOk("the invited address signs up: a staff account, not on the team, the invite unused until it confirms", async () => {
  staff = await signUp("leasing@riverrock.example", { account_type: "business", full_name: "Lee Leasing", business_invite: token });
  const inv = await one(db.query("select accepted_at from public.business_invites where token = $1", [token]));
  if ((await roleOf(staff)).role !== "business_staff" || (await member(staff)) || inv.accepted_at) throw new Error("joined before confirming");
  if (!(await asAnon(() => one(db.query("select valid from public.business_invite_lookup($1)", [token])))).valid) throw new Error("used up early");
});
await expectOk("confirming the address joins the team and uses the invite up", async () => {
  await confirm(staff);
  const m = await member(staff);
  const inv = await one(db.query("select accepted_at, accepted_by from public.business_invites where token = $1", [token]));
  if (!m || m.business_id !== business || m.role !== "editor" || m.invited_by !== owner || !inv.accepted_at || inv.accepted_by !== staff) throw new Error(JSON.stringify({ m, inv }));
});
await expectOk("an invite revoked or expired before the address is confirmed joins nobody", async () => {
  const late = await as(owner, () => one(db.query("select id, token from public.business_invite_create('late@riverrock.example')")));
  const lateId = await signUp("late@riverrock.example", { account_type: "business", full_name: "Lou Late", business_invite: late.token });
  await as(owner, () => db.query("select public.business_invite_revoke($1)", [late.id]));
  await confirm(lateId);
  const old = await as(owner, () => one(db.query("select id, token from public.business_invite_create('old@riverrock.example')")));
  const oldId = await signUp("old@riverrock.example", { account_type: "business", full_name: "Olga Old", business_invite: old.token });
  await db.query("update public.business_invites set expires_at = now() - interval '1 minute' where id = $1", [old.id]);
  await confirm(oldId);
  if ((await member(lateId)) || (await member(oldId))) throw new Error("joined");
});
await expectOk("an account made before the invite cannot claim it, even with the token in its metadata", async () => {
  const inv = await as(owner, () => one(db.query("select token from public.business_invite_create('early@riverrock.example')")));
  const early = (await db.query("insert into auth.users (email, raw_user_meta_data, created_at) values ('early@riverrock.example', $1, now() - interval '1 day') returning id", [JSON.stringify({ account_type: "business", full_name: "Eve Early", business_invite: inv.token })])).rows[0].id;
  await confirm(early);
  if (await member(early)) throw new Error("an older account claimed the invite");
});
await expectOk("the team sees each other; a student sees nobody's team", async () => {
  const team = await as(staff, () => rows(db.query("select user_id from public.business_members where business_id = $1", [business])));
  const none = await as(ben, () => rows(db.query("select user_id from public.business_members where business_id = $1", [business])));
  if (team.length !== 2 || none.length !== 0) throw new Error(`${team.length} / ${none.length}`);
});
await expectOk("staff edit the business's listing and post new ones, owned by the business's owner", async () => {
  await as(staff, () => db.query("update public.apartments set title = 'Two-bed by the river, move-in special' where id = $1", [apt]));
  await expectError("  owned by the staffer", () => as(staff, () => db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address) values ($1, $2, 'Studio', 'Small, bright, all bills in.', 850, '1 River Rd')", [staff, business])), "row-level security");
  await listing(business, staff);
  const n = await one(db.query("select count(*)::int as n from public.apartments where business_id = $1 and owner_id = $2", [business, owner]));
  if (n.n !== 2) throw new Error(String(n.n));
});

// --- Inquiries and the no-cold-messages rules ---------------------------------------------------------------------
let chat;
await expectOk("a student opens a chat from the listing: named after the business, the whole team in it, the same one again", async () => {
  chat = (await as(ben, () => one(db.query("select public.start_business_inquiry('apartment', $1) as id", [apt])))).id;
  const c = await one(db.query("select type, name, business_id from public.conversations where id = $1", [chat]));
  const members = (await rows(db.query("select user_id from public.conversation_members where conversation_id = $1", [chat]))).map((m) => m.user_id).sort();
  if (c.type !== "direct" || c.name !== "River Rock Apartments" || c.business_id !== business) throw new Error(JSON.stringify(c));
  if (JSON.stringify(members) !== JSON.stringify([ben, owner, staff].sort())) throw new Error(JSON.stringify(members));
  if ((await as(ben, () => one(db.query("select public.start_business_inquiry('apartment', $1) as id", [apt])))).id !== chat) throw new Error("a second chat");
});
await expectError("a business cannot start an inquiry", () => as(owner, () => db.query("select public.start_business_inquiry('apartment', $1)", [apt])), "only reply");
await expectError("a student cannot message a business's people directly", () => as(ben, () => db.query("select public.get_or_create_direct_conversation($1)", [staff])), "from one of its listings");
await expectError("a business cannot message anyone directly", () => as(owner, () => db.query("select public.get_or_create_direct_conversation($1)", [ben])), "only reply");
await expectError("a business cannot write first, even in its own inquiry chat", () => as(owner, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Hi there!')", [chat, owner])), "only reply");
await expectError("no calls in an inquiry chat, from the student either", () => as(ben, () => db.query("select public.start_call($1, 'audio')", [chat])), "not available in chats with a business");
await expectOk("the student writes; the owner and the staff reply; the team's unread counts work", async () => {
  await as(ben, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Is the two-bed still available for August?')", [chat, ben]));
  await as(owner, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'It is! Want a tour?')", [chat, owner]));
  await as(staff, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'I can show it Friday.')", [chat, staff]));
  const n = await one(db.query("select count(*)::int as n from public.messages where conversation_id = $1", [chat]));
  const unread = await as(owner, () => rows(db.query("select * from public.get_unread_counts()")));
  if (n.n !== 3 || Number(unread.find((u) => u.conversation_id === chat)?.unread_count ?? 0) !== 1) throw new Error(JSON.stringify({ n, unread }));
});
await expectOk("groups leave business accounts out, and a business cannot make one", async () => {
  const g = (await as(ben, () => one(db.query("select public.create_group_conversation('Study', array[$1::uuid, $2::uuid]) as id", [owner, cat])))).id;
  await as(ben, () => db.query("select public.add_group_members($1, array[$2::uuid])", [g, staff]));
  const members = (await rows(db.query("select user_id from public.conversation_members where conversation_id = $1", [g]))).map((m) => m.user_id).sort();
  if (JSON.stringify(members) !== JSON.stringify([ben, cat].sort())) throw new Error(JSON.stringify(members));
  await expectError("  a business making a group", () => as(owner, () => db.query("select public.create_group_conversation('Sales', array[$1::uuid])", [ben])), "only reply");
});

// --- A business session sees nothing of the student side ----------------------------------------------------------
await expectOk("a business session reads no feed, roommate posts, items, follows or student listings; its own listings yes", async () => {
  await as(ben, () => db.query("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Move-in day!')", [ben]));
  await as(ben, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [ben, cat]));
  for (const who of [owner, staff]) {
    for (const sql of ["select id from public.feed_posts", "select id from public.roommate_posts", "select id from public.items", "select follower_id from public.follows"]) {
      const r = await as(who, () => rows(db.query(sql)));
      if (r.length) throw new Error(`${sql}: ${r.length}`);
    }
    const listings = await as(who, () => rows(db.query("select id, business_id from public.apartments")));
    if (!listings.length || listings.some((a) => a.business_id !== business)) throw new Error(JSON.stringify(listings));
  }
  if (!(await as(cat, () => rows(db.query("select id from public.feed_posts")))).length) throw new Error("a student lost the feed");
});
await expectOk("a business session sees its team and the students in its inquiries, nobody else", async () => {
  const seen = new Set((await as(staff, () => rows(db.query("select id from public.profiles")))).map((p) => p.id));
  if (!seen.has(staff) || !seen.has(owner) || !seen.has(ben) || seen.has(cat) || seen.has(admin)) throw new Error(JSON.stringify([...seen]));
  if ((await as(cat, () => rows(db.query("select id from public.profiles")))).length < 5) throw new Error("a student lost the directory");
});
await expectError("a business cannot post to the feed", () => as(owner, () => db.query("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Great deals!')", [owner])), "business portal");
await expectError("a business cannot follow anyone", () => as(staff, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [staff, ben])), "business portal");
await expectError("a business cannot post a roommate ad", () => as(owner, () => db.query("insert into public.roommate_posts (author_id, post_type, title, description) values ($1, 'has_room', 'Room', 'Room for rent in our building.')", [owner])), "business portal");
await expectOk("business accounts never show (or see) activity status: off at sign-up, and turning it on does nothing", async () => {
  await as(owner, () => db.query("select public.set_show_active_status(true)"));
  if ((await one(db.query("select show_active_status from public.profiles where id = $1", [owner]))).show_active_status !== false) throw new Error("turned on");
  await db.query("insert into public.user_activity (user_id, last_active_at) values ($1, now()) on conflict (user_id) do update set last_active_at = now()", [ben]);
  if ((await as(owner, () => rows(db.query("select * from public.activity_status(array[$1::uuid])", [ben])))).length) throw new Error("the business saw activity");
});
await expectOk("students still post, follow and save as before", async () => {
  await as(cat, () => db.query("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Library open late')", [cat]));
  await as(cat, () => db.query("insert into public.saved_listings (user_id, target_type, target_id) values ($1, 'apartment', $2)", [cat, apt]));
});

// --- Deals --------------------------------------------------------------------------------------------------------
let deal;
const dealSponsored = async (id) => (await asAnon(() => one(db.query("select public.deal_sponsored(d) as s from public.deals d where d.id = $1", [id])))).s;
await expectOk("the team posts a deal for Texas State; students there see it, nobody sees it paused", async () => {
  deal = (await as(staff, () => one(db.query("insert into public.deals (business_id, created_by, title, discount_label, university_ids) values ($1, $2, 'First month free', '1 month free', array[$3::uuid]) returning id", [business, staff, txstate])))).id;
  const here = await asAnon(() => rows(db.query("select 1 from public.deals where id = $1 and (university_ids = '{}' or university_ids @> array[$2::uuid])", [deal, txstate])));
  const there = await asAnon(() => rows(db.query("select 1 from public.deals where id = $1 and (university_ids = '{}' or university_ids @> array[$2::uuid])", [deal, utsa])));
  if (here.length !== 1 || there.length !== 0) throw new Error(`${here.length} / ${there.length}`);
  await as(owner, () => db.query("update public.deals set status = 'paused' where id = $1", [deal]));
  if ((await asAnon(() => rows(db.query("select 1 from public.deals where id = $1", [deal])))).length) throw new Error("paused deal shown");
  await as(owner, () => db.query("update public.deals set status = 'active' where id = $1", [deal]));
});
await expectOk("a deal is Sponsored only while a paid promotion runs", async () => {
  if ((await dealSponsored(deal)) !== false) throw new Error("sponsored unpaid");
  await as(admin, () => db.query("select public.admin_record_promotion('deal', $1, now() - interval '1 hour', now() + interval '3 days', 2500, 'USD', 'INV-2001')", [deal]));
  if ((await dealSponsored(deal)) !== true) throw new Error("not sponsored");
});
await expectError("a student cannot post a deal", () => as(ben, () => db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, 'Fake deal')", [business, ben])), "row-level security");
await expectOk("a student opens a chat from a deal too", async () => {
  const id = (await as(cat, () => one(db.query("select public.start_business_inquiry('deal', $1) as id", [deal])))).id;
  if ((await one(db.query("select inquiry_target_type from public.conversations where id = $1", [id]))).inquiry_target_type !== "deal") throw new Error("not a deal chat");
});

// --- Numbers ------------------------------------------------------------------------------------------------------
await expectOk("views count once per viewer; the team's own do not; the numbers carry the promotion's end", async () => {
  await as(ben, () => db.query("select public.record_view('apartment', $1, null)", [apt]));
  await as(ben, () => db.query("select public.record_view('apartment', $1, null)", [apt]));
  await asAnon(() => db.query("select public.record_view('deal', $1, 'visitor-1')", [deal]));
  await as(staff, () => db.query("select public.record_view('apartment', $1, null)", [apt]));
  await as(ben, () => db.query("select public.record_contact('apartment', $1)", [apt]));
  const l = await as(owner, () => one(db.query("select * from public.business_listing_stats($1) where listing_id = $2", [business, apt])));
  if (Number(l.views) !== 1 || Number(l.saves) !== 1 || Number(l.contacts) !== 1 || Number(l.inquiries) !== 1 || !l.sponsored_until) throw new Error(JSON.stringify(l));
  const d = await as(staff, () => one(db.query("select * from public.business_deal_stats($1) where deal_id = $2", [business, deal])));
  if (Number(d.views) !== 1 || Number(d.inquiries) !== 1 || !d.sponsored_until) throw new Error(JSON.stringify(d));
});
await expectError("a student cannot read a business's numbers", () => as(ben, () => db.query("select * from public.business_listing_stats($1)", [business])), "Only the business");

// --- Uploads --------------------------------------------------------------------------------------------------------
const upload = (who, name) => as(who, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads', $1, $2)", [name, who]));
await expectOk("an approved team uploads listing photos into its own folder", async () => {
  await upload(owner, `apartments/${owner}/a.jpg`);
});

// --- Suspension: everything stops at once ----------------------------------------------------------------------------
await expectOk("suspending the business: listings archived and hidden, deals paused, labels gone, out of students' view", async () => {
  await review(admin, business, "suspended", "Complaints about deposits");
  const a = await one(db.query("select status from public.apartments where id = $1", [apt]));
  const d = await one(db.query("select status from public.deals where id = $1", [deal]));
  const b = await one(db.query("select status, verified_partner, verification_note from public.businesses where id = $1", [business]));
  const seen = await asAnon(() => rows(db.query("select id from public.apartments where business_id = $1", [business])));
  if (a.status !== "archived" || d.status !== "paused" || b.status !== "suspended" || b.verified_partner || b.verification_note || seen.length || (await sponsored(apt))) throw new Error(JSON.stringify({ a, d, b, seen }));
});
for (const [label, who] of [["the owner", () => owner], ["the staff", () => staff]]) {
  await expectOk(`${label} of a suspended business reads no chats, messages, listings, deals, team or students, only its own standing`, async () => {
    const u = who();
    for (const sql of ["select id from public.conversations", "select conversation_id from public.conversation_members", "select id from public.messages", "select id from public.apartments", "select id from public.deals", "select id from public.listing_promotions", "select user_id from public.business_members where user_id <> auth.uid()"]) {
      const r = await as(u, () => rows(db.query(sql)));
      if (r.length) throw new Error(`${sql}: ${r.length}`);
    }
    const students = await as(u, () => rows(db.query("select id from public.profiles where id = $1", [ben])));
    const mine = (await as(u, () => one(db.query("select public.my_business() as m")))).m;
    const unread = await as(u, () => rows(db.query("select * from public.get_unread_counts()")));
    if (students.length || mine.business.status !== "suspended" || mine.business.review_note !== "Complaints about deposits" || unread.length) throw new Error(JSON.stringify({ students, mine, unread }));
  });
  await expectError(`${label} of a suspended business cannot reply`, () => as(who(), () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Still there?')", [chat, who()])), "can't send messages");
}
await expectError("nor resume a deal", () => mustChange(() => as(owner, () => db.query("update public.deals set status = 'active' where id = $1 returning id", [deal]))), "row-level security");
await expectError("nor reactivate a listing", () => mustChange(() => as(staff, () => db.query("update public.apartments set status = 'active' where id = $1 returning id", [apt]))), "row-level security");
await expectError("nor delete a listing", () => mustChange(() => as(owner, () => db.query("delete from public.apartments where id = $1 returning id", [apt]))), "row-level security");
await expectError("nor post a listing", () => listing(business), "row-level security");
await expectError("nor post a deal", () => as(owner, () => db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, 'Flash sale')", [business, owner])), "row-level security");
await expectError("nor edit the business profile", () => mustChange(() => as(owner, () => db.query("update public.businesses set description = 'x' where id = $1 returning id", [business]))), "row-level security");
await expectError("nor read the numbers", () => as(owner, () => db.query("select * from public.business_overview($1)", [business])), "Only the business");
await expectError("nor invite anyone", () => as(owner, () => db.query("select public.business_invite_create('new@riverrock.example')")), "cannot add people");
await expectError("nor upload files", () => upload(staff, `apartments/${staff}/b.jpg`), "row-level security");
await expectOk("the student keeps the chat's history with a suspended business", async () => {
  const m = await as(ben, () => rows(db.query("select id from public.messages where conversation_id = $1", [chat])));
  if (m.length !== 3) throw new Error(String(m.length));
});
await expectError("but cannot write to it", () => as(ben, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Hello?')", [chat, ben])), "isn't taking messages");
await expectError("nor start a new inquiry", () => as(cat, () => db.query("select public.start_business_inquiry('apartment', $1)", [apt])), "isn't taking messages");
await expectOk("an invite pending at the suspension joins nobody while it lasts (and its link says it is not valid)", async () => {
  const inv = await one(db.query("insert into public.business_invites (business_id, email, invited_by) values ($1, 'night@riverrock.example', $2) returning token", [business, owner]));
  if ((await asAnon(() => one(db.query("select valid from public.business_invite_lookup($1)", [inv.token])))).valid) throw new Error("valid while suspended");
  const id = await signUp("night@riverrock.example", { account_type: "business", full_name: "Nia Night", business_invite: inv.token });
  await confirm(id);
  if (await member(id)) throw new Error("joined");
});

// --- Rejected: the owner may fix the profile, nothing else ------------------------------------------------------------
await expectOk("a rejected business: the owner edits the profile; no deals or chats", async () => {
  await review(admin, business, "rejected", "Add your licence number");
  await as(owner, () => db.query("update public.businesses set description = 'Licence 12345' where id = $1", [business]));
  if ((await one(db.query("select description from public.businesses where id = $1", [business]))).description !== "Licence 12345") throw new Error("not edited");
  await expectError("  a deal", () => as(owner, () => db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, 'Sale')", [business, owner])), "row-level security");
  if ((await as(owner, () => rows(db.query("select id from public.messages")))).length) throw new Error("read chats");
});

// --- Approved again: access returns; the old listing waits to be re-activated ------------------------------------------
await expectOk("approved again: chats, deals and listings come back; nothing is verified or live until the team says so", async () => {
  await review(admin, business, "approved");
  const b = await one(db.query("select status, verified_partner from public.businesses where id = $1", [business]));
  const msgs = await as(staff, () => rows(db.query("select id from public.messages where conversation_id = $1", [chat])));
  if (b.status !== "approved" || b.verified_partner || msgs.length !== 3) throw new Error(JSON.stringify({ b, msgs: msgs.length }));
  await as(owner, () => db.query("update public.apartments set status = 'active' where id = $1", [apt]));
  await as(ben, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Back?')", [chat, ben]));
  // Migration 56: the staffer changed the listing after its promotion was approved (above), so its ad waits for the
  // UniBuzz team to look again; once they resume it, the label comes back.
  await as(admin, () => db.query("select public.admin_resume_ad(a.id) from public.ads a where a.promoted_apartment_id = $1 and a.status = 'paused'", [apt]));
  if ((await sponsored(apt)) !== true) throw new Error("the paid promotion did not come back");
});

// --- Removing people and accounts --------------------------------------------------------------------------------------
await expectOk("the owner removes the staffer: out of the team and every inquiry", async () => {
  await expectError("  staff cannot remove", () => as(staff, () => db.query("select public.business_member_remove($1)", [owner])), "owner");
  await as(owner, () => db.query("select public.business_member_remove($1)", [staff]));
  const inChat = await rows(db.query("select 1 from public.conversation_members where conversation_id = $1 and user_id = $2", [chat, staff]));
  const reads = await as(staff, () => rows(db.query("select id from public.messages")));
  if ((await member(staff)) || inChat.length || reads.length) throw new Error("still in");
});
await expectError("the owner cannot remove themselves", () => as(owner, () => db.query("select public.business_member_remove($1)", [owner])), "cannot leave");
await expectOk("deleting the owner's account takes the business, its listings, team rows, invites, deals and promotions with it", async () => {
  await db.query("delete from auth.users where id = $1", [owner]);
  for (const [t, col] of [["businesses", "id"], ["business_members", "business_id"], ["deals", "business_id"], ["apartments", "business_id"], ["listing_promotions", "business_id"], ["business_invites", "business_id"]]) {
    if ((await rows(db.query(`select 1 from public.${t} where ${col} = $1`, [business]))).length) throw new Error(t);
  }
  if ((await rows(db.query("select 1 from public.apartments where id = $1", [apt]))).length) throw new Error("listing left");
});

done("MIGRATION-39 BUSINESS PORTAL");
