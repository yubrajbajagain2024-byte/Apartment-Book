// Migration 39 (the business portal) on a real Supabase project: every business role and permission through Supabase
// Auth (real sign-ups and email confirmation), the REST API, Realtime (the private presence channel, live message
// events) and Storage, with real sessions. Never run against production: it refuses the production ref.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<staging ref> node supabase/tests/staging/business-portal.mjs
//
// A token from `npx supabase login` works (the CLI keeps it in the macOS keychain). The project needs this repo's
// migrations applied in production's order (with the two in supabase/applied-outside-repo after 36) and the seed.
// Accounts are made with admin-generated confirmation links, so no email is sent; everything made is deleted at the end.
import { createClient } from "@supabase/supabase-js";

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This test writes and deletes data: it never runs against production.");

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const apiKeys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL = `https://${REF}.supabase.co`;
const ANON = apiKeys.find((k) => k.name === "anon")?.api_key;
const SERVICE = apiKeys.find((k) => k.name === "service_role")?.api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const anon = createClient(URL, ANON, opts);

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${e?.message ?? e}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
async function refused(name, fn, pattern) {
  try {
    await fn();
    fail(name, "it was allowed");
  } catch (e) {
    if (!pattern || new RegExp(pattern, "i").test(e.message)) ok(name);
    else fail(name, e.message);
  }
}
/** A PostgREST call that must succeed; its data. */
const must = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code ?? ""} ${error.message}`); return data; };
/** One that must fail (an error, or an update/delete that row-level security filtered to no rows). */
const deny = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code ?? ""} ${error.message}`); if (Array.isArray(data) && data.length === 0) throw new Error("no rows: row-level security"); return data; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const run = Date.now().toString(36);
const made = [];
/** A sign-up as Supabase Auth does it (the triggers run), with its confirmation link generated instead of emailed. */
async function signUp(email, data) {
  const password = `Pw-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "signup", email, password, options: { data } });
  if (error) throw new Error(error.message);
  made.push(link.user.id);
  return { id: link.user.id, email, password, hashed: link.properties.hashed_token };
}
async function confirm(u) {
  const c = createClient(URL, ANON, opts);
  const { error } = await c.auth.verifyOtp({ type: "signup", token_hash: u.hashed });
  if (error) throw new Error(error.message);
}
async function session(u) {
  const c = createClient(URL, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(error.message);
  return c;
}
const rpc = (c, fn, args) => must(c.rpc(fn, args));

try {
  const txstate = (await sql("select id from public.universities where email_domain = 'txstate.edu'"))[0].id;
  const v2 = (await sql("select to_regclass('public.ads') is not null as ok"))[0].ok;
  console.log(`Staging project ${project.name} (${REF}), run ${run}`);

  // --- Accounts -----------------------------------------------------------------------------------------------------
  await refused("a student sign-up without a university address is refused by the database", () => signUp(`someone.${run}@gmail.com`, { full_name: "Some One" }), "database error|university");
  const annU = await signUp(`ann.${run}@txstate.edu`, { full_name: "Ann Admin" }); await confirm(annU);
  const benU = await signUp(`ben.${run}@txstate.edu`, { full_name: "Ben Student" }); await confirm(benU);
  const catU = await signUp(`cat.${run}@txstate.edu`, { full_name: "Cat Student" }); await confirm(catU);
  await sql(`select public.grant_role('${annU.id}', 'admin')`);
  const ann = await session(annU), ben = await session(benU), cat = await session(catU);
  await check("students sign up as students; the admin is an admin", async () => {
    if ((await rpc(ben, "my_role")) !== "student" || (await rpc(ann, "my_role")) !== "admin") throw new Error("roles");
  });
  await check("a student cannot make themselves an admin", async () => {
    await must(ben.from("profiles").update({ role: "admin" }).eq("id", benU.id));
    if ((await rpc(ben, "my_role")) !== "student") throw new Error("became admin");
  });
  await refused("grant_role() is not callable through the API", () => rpc(ben, "grant_role", { p_user: benU.id, p_role: "admin" }), "permission denied|PGRST202|not find");

  const ownerU = await signUp(`owner.${run}@riverrock-staging.example`, { account_type: "business", full_name: "Rita Rock", business_name: `River Rock ${run}`, business_category: "housing", business_university_id: txstate });
  await refused("a business owner cannot sign in before confirming the email", () => session(ownerU), "not confirmed");
  const business = (await sql(`select id, status from public.businesses where owner_id = '${ownerU.id}'`))[0];
  await check("a business sign-up (any address) makes a business_owner with a pending business", async () => {
    const p = (await sql(`select role, university_id from public.profiles where id = '${ownerU.id}'`))[0];
    if (p.role !== "business_owner" || p.university_id !== null || business.status !== "pending") throw new Error(JSON.stringify({ p, business }));
  });
  await refused("an admin cannot approve it before the owner confirms", () => rpc(ann, "admin_review_business", { p_business: business.id, p_decision: "approved" }), "not confirmed");
  await confirm(ownerU);
  const owner = await session(ownerU);
  await check("the pending business is hidden from students and visible to its team", async () => {
    const s = await must(ben.from("businesses").select("id").eq("id", business.id));
    const t = await must(owner.from("businesses").select("id, status").eq("id", business.id));
    if (s.length || t.length !== 1) throw new Error(`${s.length} / ${t.length}`);
  });
  await refused("a pending business cannot post a listing", () => must(owner.from("apartments").insert({ owner_id: ownerU.id, business_id: business.id, title: "Two-bed by the river", description: "Pool, gym, shuttle to campus.", price_per_month: 1200, address: "1 River Rd" })), "row-level security");
  await check("a pending business drafts a deal no student sees", async () => {
    await must(owner.from("deals").insert({ business_id: business.id, created_by: ownerU.id, title: "Opening week" }));
    if ((await must(ben.from("deals").select("id").eq("business_id", business.id))).length) throw new Error("seen");
  });
  await refused("a student cannot review businesses", () => rpc(ben, "admin_review_business", { p_business: business.id, p_decision: "approved" }), "admins");
  await check("the admin approves once the owner confirmed; approval verifies nothing", async () => {
    await rpc(ann, "admin_review_business", { p_business: business.id, p_decision: "approved", p_note: "Called the office" });
    const b = (await must(anon.from("businesses").select("status, verified_partner").eq("id", business.id)))[0];
    if (b.status !== "approved" || b.verified_partner) throw new Error(JSON.stringify(b));
  });
  await refused("signed out, the contact address is not readable", () => must(anon.from("businesses").select("contact_email").eq("id", business.id)), "permission denied|42501");
  await refused("nor the admin's review note", () => must(ben.from("businesses").select("review_note").eq("id", business.id)), "permission denied|42501");
  await check("the team reads every column through my_business()", async () => {
    const m = await rpc(owner, "my_business");
    if (m.role !== "owner" || m.business.review_note !== "Called the office" || !m.business.contact_email) throw new Error(JSON.stringify(m));
  });

  // --- Labels -------------------------------------------------------------------------------------------------------
  const SELECT = "id, title, business:businesses!apartments_business_id_fkey(id, name, verified_partner), sponsored:listing_sponsored";
  const apt = (await must(owner.from("apartments").insert({ owner_id: ownerU.id, business_id: business.id, title: "Two-bed by the river", description: "Pool, gym, shuttle to campus.", price_per_month: 1200, address: "1 River Rd", university_id: txstate }).select("id").single())).id;
  const label = async (c = anon) => (await must(c.from("apartments").select(SELECT).eq("id", apt)))[0];
  await check("the listing reaches students with its business, not Verified Partner, not Sponsored (REST, computed field)", async () => {
    const a = await label();
    if (!a || a.business?.verified_partner !== false || a.sponsored !== false) throw new Error(JSON.stringify(a));
  });
  await refused("Verified Partner needs what was checked", () => rpc(ann, "admin_set_verified", { p_business: business.id, p_verified: true, p_evidence: "ok" }), "what was checked");
  await refused("a business cannot verify itself", () => rpc(owner, "admin_set_verified", { p_business: business.id, p_verified: true, p_evidence: "We are very trustworthy" }), "admins");
  await check("verified by the admin with evidence: Verified Partner", async () => {
    await rpc(ann, "admin_set_verified", { p_business: business.id, p_verified: true, p_evidence: "Texas licence 12345 checked with the state" });
    if (!(await label()).business.verified_partner) throw new Error("not verified");
  });
  await refused("a business cannot record its own promotion", () => rpc(owner, "admin_record_promotion", { p_target_type: "apartment", p_target_id: apt, p_starts_at: new Date().toISOString(), p_ends_at: new Date(Date.now() + 864e5).toISOString(), p_amount_cents: 5000, p_currency: "USD", p_payment_reference: "INV-1" }), "admins");
  await refused("nor write the promotions table", () => must(owner.from("listing_promotions").insert({ business_id: business.id, apartment_id: apt, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 864e5).toISOString(), amount_cents: 1, payment_reference: "x-1" })), "permission denied|42501");
  await refused("an unpaid promotion is refused", () => rpc(ann, "admin_record_promotion", { p_target_type: "apartment", p_target_id: apt, p_starts_at: new Date().toISOString(), p_ends_at: new Date(Date.now() + 864e5).toISOString(), p_amount_cents: 0, p_currency: "USD", p_payment_reference: "INV-1" }), "amount");
  let promo;
  await check("a paid promotion recorded by the admin makes it Sponsored; cancelling takes that away", async () => {
    promo = await rpc(ann, "admin_record_promotion", { p_target_type: "apartment", p_target_id: apt, p_starts_at: new Date(Date.now() - 36e5).toISOString(), p_ends_at: new Date(Date.now() + 7 * 864e5).toISOString(), p_amount_cents: 5000, p_currency: "USD", p_payment_reference: `INV-${run}` });
    if ((await label()).sponsored !== true) throw new Error("not sponsored");
    await rpc(ann, "admin_cancel_promotion", { p_id: promo });
    if ((await label()).sponsored !== false) throw new Error("still sponsored");
    promo = await rpc(ann, "admin_record_promotion", { p_target_type: "apartment", p_target_id: apt, p_starts_at: new Date(Date.now() - 36e5).toISOString(), p_ends_at: new Date(Date.now() + 7 * 864e5).toISOString(), p_amount_cents: 5000, p_currency: "USD", p_payment_reference: `INV-${run}-2` });
  });
  await check("students cannot read promotions; the team can", async () => {
    const s = await must(ben.from("listing_promotions").select("id"));
    const t = await must(owner.from("listing_promotions").select("amount_cents, payment_reference").eq("apartment_id", apt));
    if (s.length || t.length !== 2) throw new Error(`${s.length} / ${t.length}`);
  });
  await refused("a student cannot post a listing in a business's name", () => must(ben.from("apartments").insert({ owner_id: benU.id, business_id: business.id, title: "Fake listing", description: "Not theirs at all.", price_per_month: 1, address: "x" })), "row-level security");

  // --- Invites: used up only once the address is confirmed ------------------------------------------------------------
  const inv = await rpc(owner, "business_invite_create", { p_email: `leasing.${run}@riverrock-staging.example` });
  const staffU = await signUp(`leasing.${run}@riverrock-staging.example`, { account_type: "business", full_name: "Lee Leasing", business_invite: inv.token });
  await check("an invited sign-up is a staff account, not on the team, the invite unused, before it confirms", async () => {
    const m = await sql(`select 1 from public.business_members where user_id = '${staffU.id}'`);
    const i = (await sql(`select accepted_at from public.business_invites where id = '${inv.id}'`))[0];
    const p = (await sql(`select role from public.profiles where id = '${staffU.id}'`))[0];
    const look = (await rpc(anon, "business_invite_lookup", { p_token: inv.token }))[0];
    if (m.length || i.accepted_at || p.role !== "business_staff" || !look.valid) throw new Error(JSON.stringify({ m, i, p, look }));
  });
  await refused("the invited person cannot sign in before confirming", () => session(staffU), "not confirmed");
  await check("confirming the email (Supabase's own verification) joins the team and uses the invite up", async () => {
    await confirm(staffU);
    const m = (await sql(`select business_id, role from public.business_members where user_id = '${staffU.id}'`))[0];
    const i = (await sql(`select accepted_at, accepted_by from public.business_invites where id = '${inv.id}'`))[0];
    // Business v2 (migration 49) names v1's staff "editor", with the same rights.
    if (!m || m.business_id !== business.id || m.role !== (v2 ? "editor" : "staff") || !i.accepted_at || i.accepted_by !== staffU.id) throw new Error(JSON.stringify({ m, i }));
  });
  const strangerU = await signUp(`stranger.${run}@elsewhere-staging.example`, { account_type: "business", full_name: "Stray", business_invite: inv.token });
  await confirm(strangerU);
  await check("the same link with another address joins nothing and makes no business", async () => {
    const m = await sql(`select 1 from public.business_members where user_id = '${strangerU.id}'`);
    const b = await sql(`select 1 from public.businesses where owner_id = '${strangerU.id}'`);
    if (m.length || b.length) throw new Error("joined");
  });
  const staff = await session(staffU);
  await check("staff work on the business's listings (owned by the business's owner)", async () => {
    await must(staff.from("apartments").update({ title: "Two-bed by the river, move-in special" }).eq("id", apt).select("id"));
    await refused("  a listing owned by the staffer", () => must(staff.from("apartments").insert({ owner_id: staffU.id, business_id: business.id, title: "Studio", description: "Small, bright, all bills in.", price_per_month: 850, address: "1 River Rd" })), "row-level security");
  });

  // --- Inquiries ----------------------------------------------------------------------------------------------------
  const chat = await rpc(ben, "start_business_inquiry", { p_target_type: "apartment", p_target_id: apt });
  await check("a student's inquiry puts the whole team in one chat named after the business", async () => {
    const members = (await sql(`select user_id from public.conversation_members where conversation_id = '${chat}'`)).map((r) => r.user_id).sort();
    if (JSON.stringify(members) !== JSON.stringify([benU.id, ownerU.id, staffU.id].sort())) throw new Error(JSON.stringify(members));
  });
  await refused("a business cannot start a chat with a student", () => rpc(owner, "get_or_create_direct_conversation", { p_other_user_id: benU.id }), "only reply");
  await refused("a student cannot message a business's people directly", () => rpc(ben, "get_or_create_direct_conversation", { p_other_user_id: staffU.id }), "from one of its listings");
  await refused("a business cannot write first", () => must(owner.from("messages").insert({ conversation_id: chat, sender_id: ownerU.id, content: "Hi!" })), "only reply");
  await refused("no calls in an inquiry chat", () => rpc(ben, "start_call", { p_conversation_id: chat, p_kind: "audio" }), "not available");

  // Live events: the staffer listens to the chat, as the portal's inbox does.
  const heard = { staff: [], ben: [] };
  await staff.realtime.setAuth((await staff.auth.getSession()).data.session.access_token);
  await ben.realtime.setAuth((await ben.auth.getSession()).data.session.access_token);
  const listen = (c, who) =>
    new Promise((resolve) => {
      c.channel(`chat-${who}-${run}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${chat}` }, (p) => heard[who].push(p.new.content))
        .subscribe((status) => status === "SUBSCRIBED" && resolve());
    });
  await Promise.all([listen(staff, "staff"), listen(ben, "ben")]);
  await wait(1500);
  await check("the student writes; the team replies; the staffer hears the student live", async () => {
    await must(ben.from("messages").insert({ conversation_id: chat, sender_id: benU.id, content: "Is it available for August?" }));
    await must(owner.from("messages").insert({ conversation_id: chat, sender_id: ownerU.id, content: "It is! Want a tour?" }));
    await must(staff.from("messages").insert({ conversation_id: chat, sender_id: staffU.id, content: "I can show it Friday." }));
    await wait(4000);
    if (!heard.staff.includes("Is it available for August?")) throw new Error(`staff heard ${JSON.stringify(heard.staff)}`);
  });

  // --- The student side stays closed to business sessions ---------------------------------------------------------------
  await must(ben.from("feed_posts").insert({ author_id: benU.id, kind: "post", body: `Move-in day ${run}` }));
  await check("a business session reads no feed, no roommate posts, no items, no follows, no student listings", async () => {
    for (const c of [owner, staff]) {
      for (const t of ["feed_posts", "roommate_posts", "items", "follows"]) if ((await must(c.from(t).select("*").limit(5))).length) throw new Error(t);
      const listings = await must(c.from("apartments").select("id, business_id"));
      if (listings.some((a) => a.business_id !== business.id)) throw new Error("a student listing");
    }
    if (!(await must(cat.from("feed_posts").select("id").limit(1))).length) throw new Error("a student lost the feed");
  });
  await check("a business session sees its team and the students who wrote to it, nobody else", async () => {
    const ids = new Set((await must(staff.from("profiles").select("id"))).map((p) => p.id));
    if (!ids.has(benU.id) || !ids.has(ownerU.id) || ids.has(catU.id) || ids.has(annU.id)) throw new Error(JSON.stringify([...ids]));
  });
  await refused("a business cannot post to the feed", () => must(owner.from("feed_posts").insert({ author_id: ownerU.id, kind: "post", body: "Deals!" })), "business portal");
  await refused("nor follow a student", () => must(staff.from("follows").insert({ follower_id: staffU.id, followee_id: benU.id })), "business portal");
  await check("a business never sees who is online: the private presence channel refuses it; a student joins", async () => {
    const join = (c) =>
      new Promise((resolve) => {
        const ch = c.channel("presence:active", { config: { private: true, presence: { key: "x" } } });
        const t = setTimeout(() => resolve("TIMED_OUT"), 8000);
        ch.subscribe((status) => { if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR") { clearTimeout(t); resolve(status); c.removeChannel(ch); } });
      });
    await owner.realtime.setAuth((await owner.auth.getSession()).data.session.access_token);
    await cat.realtime.setAuth((await cat.auth.getSession()).data.session.access_token);
    const [biz, student] = [await join(owner), await join(cat)];
    if (biz === "SUBSCRIBED" || student !== "SUBSCRIBED") throw new Error(`business ${biz}, student ${student}`);
    if ((await rpc(owner, "activity_status", { p_user_ids: [benU.id] })).length) throw new Error("activity status");
  });
  await check("an approved team uploads listing photos", async () => {
    const { error } = await owner.storage.from("uploads").upload(`apartments/${ownerU.id}/${run}.jpg`, new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    if (error) throw new Error(error.message);
  });
  await check("students keep everything as before: a direct chat, a group, a follow", async () => {
    const dm = await rpc(ben, "get_or_create_direct_conversation", { p_other_user_id: catU.id });
    await must(ben.from("messages").insert({ conversation_id: dm, sender_id: benU.id, content: "Hi Cat" }));
    await rpc(ben, "create_group_conversation", { p_name: `Study ${run}`, p_member_ids: [catU.id] });
    await must(ben.from("follows").insert({ follower_id: benU.id, followee_id: catU.id }));
  });

  // --- Suspension: everything stops at once -------------------------------------------------------------------------------
  const deal = (await must(staff.from("deals").insert({ business_id: business.id, created_by: staffU.id, title: "First month free" }).select("id").single())).id;
  await rpc(ann, "admin_review_business", { p_business: business.id, p_decision: "suspended", p_note: "Complaints" });
  await check("suspended: the listing is archived and gone for students, the labels too", async () => {
    if ((await must(anon.from("apartments").select("id").eq("id", apt))).length) throw new Error("still listed");
    const a = (await sql(`select a.status, public.listing_sponsored(a) as s, b.verified_partner from public.apartments a join public.businesses b on b.id = a.business_id where a.id = '${apt}'`))[0];
    if (a.status !== "archived" || a.s || a.verified_partner) throw new Error(JSON.stringify(a));
  });
  for (const [who, c, u] of [["owner", owner, ownerU], ["staff", staff, staffU]]) {
    await check(`the ${who}'s existing session reads no chats, messages, listings, deals, team or students at once`, async () => {
      // Another approved business's live deals are public by design (other runs, other tests on staging): only its own must go.
      for (const t of ["conversations", "conversation_members", "messages", "apartments", "deals", "listing_promotions"]) {
        const q = c.from(t).select("*").limit(5);
        if ((await must(t === "deals" ? q.eq("business_id", business.id) : q)).length) throw new Error(t);
      }
      if ((await must(c.from("profiles").select("id").eq("id", benU.id))).length) throw new Error("a student");
      const m = await rpc(c, "my_business");
      if (m.business.status !== "suspended") throw new Error("standing");
    });
    await refused(`the ${who} cannot reply`, () => must(c.from("messages").insert({ conversation_id: chat, sender_id: u.id, content: "Still here?" })), "can't send messages");
  }
  await refused("nor resume a deal", () => deny(owner.from("deals").update({ status: "active" }).eq("id", deal).select("id")), "row-level security");
  await refused("nor reactivate the listing", () => deny(staff.from("apartments").update({ status: "active" }).eq("id", apt).select("id")), "row-level security");
  await refused("nor edit the business profile", () => deny(owner.from("businesses").update({ description: "x" }).eq("id", business.id).select("id")), "row-level security");
  await refused("nor read the numbers", () => rpc(owner, "business_overview", { p_business: business.id }), "Only the business");
  await refused("nor upload files", async () => {
    const { error } = await staff.storage.from("uploads").upload(`apartments/${staffU.id}/${run}.jpg`, new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    if (error) throw new Error(error.message);
  }, "row-level security|unauthorized|403");
  await check("the student keeps the history but cannot write to a suspended business", async () => {
    if ((await must(ben.from("messages").select("id").eq("conversation_id", chat))).length !== 3) throw new Error("history");
    const { error } = await ben.from("messages").insert({ conversation_id: chat, sender_id: benU.id, content: "Hello?" });
    if (!error || !/isn't taking messages/.test(error.message)) throw new Error(error?.message ?? "allowed");
  });
  await check("live events stop for the suspended team at once and keep coming for the student", async () => {
    // A message the student could not send (the rules forbid it now), written past them by the database owner.
    await sql(`alter table public.messages disable trigger messages_business_rules; insert into public.messages (conversation_id, sender_id, content) values ('${chat}', '${benU.id}', 'after the suspension ${run}'); alter table public.messages enable trigger messages_business_rules;`);
    await wait(5000);
    if (heard.staff.some((m) => m.startsWith("after the suspension"))) throw new Error("the suspended staffer heard it");
    if (!heard.ben.some((m) => m.startsWith("after the suspension"))) throw new Error(`the student did not: ${JSON.stringify(heard.ben)}`);
  });

  // --- Rejected, then approved again -----------------------------------------------------------------------------------------
  await check("rejected: the owner fixes the profile; no deals, no chats", async () => {
    await rpc(ann, "admin_review_business", { p_business: business.id, p_decision: "rejected", p_note: "Add the licence" });
    await must(owner.from("businesses").update({ description: "Licence 12345" }).eq("id", business.id).select("id"));
    const { error } = await owner.from("deals").insert({ business_id: business.id, created_by: ownerU.id, title: "Sale" });
    if (!error) throw new Error("posted a deal");
    if ((await must(owner.from("messages").select("id"))).length) throw new Error("read chats");
  });
  await check("approved again: the team's sessions read the chats and post again; the paid promotion is back", async () => {
    await rpc(ann, "admin_review_business", { p_business: business.id, p_decision: "approved" });
    if ((await must(staff.from("messages").select("id").eq("conversation_id", chat))).length !== 4) throw new Error("chats");
    await must(owner.from("apartments").update({ status: "active" }).eq("id", apt).select("id"));
    // Business v2 (migration 56): the listing changed after its promotion was approved, so its ad waits for the UniBuzz
    // team to look again; once they resume it, the label comes back.
    if (v2) for (const { id } of await sql(`select id from public.ads where promoted_apartment_id = '${apt}' and status = 'paused'`)) await rpc(ann, "admin_resume_ad", { p_ad: id });
    if ((await label()).sponsored !== true) throw new Error("promotion");
    await must(ben.from("messages").insert({ conversation_id: chat, sender_id: benU.id, content: "Back?" }));
  });
  for (const c of [ben, staff]) await c.removeAllChannels();
} finally {
  // Everything this run made: the accounts (their profiles, businesses, listings, chats and the rest cascade) and the upload.
  await sql(`delete from storage.objects where bucket_id = 'uploads' and name like 'apartments/%/${run}.jpg'`).catch(() => {});
  for (const id of made) await admin.auth.admin.deleteUser(id).catch((e) => console.log(`  ! could not delete ${id}: ${e.message}`));
  const left = await sql(`select count(*)::int as n from public.profiles where id in (${made.map((id) => `'${id}'`).join(",") || "null"})`).catch(() => [{ n: "?" }]);
  console.log(`  cleaned up ${made.length} accounts (${left[0].n} left)`);
}
console.log(failures ? `${failures} FAILED, ${passes} passed` : `ALL ${passes} STAGING CHECKS PASSED`);
process.exit(failures ? 1 : 0);
