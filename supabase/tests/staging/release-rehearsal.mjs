// The Business v2 release (migrations 44, 46 and 49 to 57, with Buzz's 51 to 54 in the same run, and 62, CampConnect
// Admin's Analytics and Business; production already has 47 and, since 2026-10-30, 58 to 60, which went live on their
// own: see supabase/tests/staging/stories.mjs) rehearsed on the staging project, the way production will take it, through
// the real Supabase stack: Auth sessions (two-factor sign-in included), the REST API, Storage, pg_cron. Never runs
// against production: it refuses production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/release-rehearsal.mjs <step>
//
// The steps, in order (what they made and saw is kept in supabase/tests/staging/.rehearsal.json, git-ignored):
//   baseline  staging must be in production's state: the release's migrations, and only they, pending. Keeps its
//             catalog and row counts, for restore and cleanup to compare with.
//   seed      v1-shaped data through the API: an approved housing business, its promoted listing (a v1 payment), a
//             staffer, a deal, a student's inquiry chat, a chat between two students, a post, a buzz with replies, a
//             student's ready video. The UniBuzz admin and a moderator are on the staff with an authenticator, as the
//             staff console and CampConnect Admin require; their sessions pass the second factor.
//   check     the checks for the state staging is in: before the release (v1), after it (Business v2, and 62's console
//             when it is applied), or after the release's rollback (v1 again, with Buzz's 51 to 54 still applied).
//   probe     after `apply`: the ad approval and payment rules attacked through the API (self-approval on fresh
//             connections, edits after approval, forged payments, team-only and internal functions, other roles).
//   apply     what `npm run db:setup` does (every pending migration in file order as one query, recorded in
//             public._migrations, then the seed) while two students and the staffer keep using the API; reports
//             every request that failed, and when. `apply <file> …` applies only those pending files, for a migration
//             that goes live alone, ahead of the release (supabase/CLAUDE.md, "to apply one migration alone").
//   rollback  the release's own rollback: 62, 57, 56, 55, 50 and 49, each in one transaction with the removal of its
//             _migrations row. Buzz's 51 to 54 are not touched; every Buzz object and row is compared before and after.
//   restore   every release migration rolled back (production's state again); the catalog is compared with baseline's.
//   cleanup   deletes every account, file and row the rehearsal made; row counts are compared with baseline's.
// `apply` after `rollback` re-applies the business migrations only.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { catalog, diffCatalogs, isBuzz, BUZZ_DATA_SQL, DATA_HELPER_SQL, DROP_DATA_HELPER_SQL } from "../catalog.mjs";
import { enrolAuthenticator, passSecondFactor } from "./mfa.mjs";
import { BUZZ_GUIDELINES_VERSION } from "../../../packages/shared/src/buzz/constants.ts";

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const STEP = process.argv[2];
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This rehearsal writes, rolls back and deletes: it never runs against production.");

const ROOT = new URL("../../../", import.meta.url);
const STATE_FILE = new URL("./.rehearsal.json", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), "utf8");
const RELEASE = [
  "20261103000300_discover.sql",
  "20261104000100_discover_audience.sql",
  "20261107000000_business_teams.sql",
  "20261107000100_business_ads.sql",
  "20261108000000_buzz_reply_tree.sql",
  "20261108000100_buzz_top_reply.sql",
  "20261108000200_buzz_prompt_threads.sql",
  "20261108000300_buzz_categories.sql",
  "20261109000000_media_server_fields.sql",
  "20261109000100_business_hardening.sql",
  "20261110000000_business_hours.sql",
  "20261114000000_console_business.sql",
];
// The release's own rollback: the business migrations and the console's 62, newest first.
const BUSINESS = ["20261107000000_business_teams.sql", "20261107000100_business_ads.sql", "20261109000000_media_server_fields.sql", "20261109000100_business_hardening.sql", "20261110000000_business_hours.sql", "20261114000000_console_business.sql"];
const MIGRATIONS = fs.readdirSync(new URL("supabase/migrations/", ROOT)).filter((f) => f.endsWith(".sql")).sort();

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const anon = createClient(URL_, ANON, opts);

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const one = async (q) => (await sql(q))[0];
const val = async (q) => { const row = await one(q); return row ? row[Object.keys(row)[0]] : undefined; };
/** SQL run as a signed-in person (role authenticated, their JWT claims), in one transaction. */
const asUser = (uid, query) => sql(`select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: "authenticated", aal: "aal1" }))}, true); set local role authenticated; ${query}`);
const applied = async () => new Set((await sql("select name from public._migrations")).map((r) => r.name));
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1), { mode: 0o600 });

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 500)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
async function refused(name, fn, pattern) {
  try { await fn(); fail(name, "it was allowed"); } catch (e) { if (!pattern || new RegExp(pattern, "i").test(e.message)) ok(name); else fail(name, e.message); }
}
const must = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code ?? ""} ${error.message}`); return data; };
const expect = (cond, message) => { if (!cond) throw new Error(message); };
/** A signed-in client. An account with an authenticator passes the second factor too (aal2), unless { firstFactorOnly: true }. */
async function session(u, { firstFactorOnly = false } = {}) {
  const c = createClient(URL_, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`${u.email}: ${error.message}`);
  if (u.totp && !firstFactorOnly) await passSecondFactor(c, u.totp);
  return c;
}
async function account(key, email, meta) {
  const password = `Rh-${state.run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (error) throw new Error(`${email}: ${error.message}`);
  state.accounts[key] = { id: data.user.id, email, password };
  save();
  return state.accounts[key];
}
/** Puts the account on the staff: CampConnect Admin's public.staff where it exists, Trust & Safety's staff_members otherwise. */
const staffRole = (uid, role) => sql(`do $$ begin
  if to_regclass('public.staff') is not null then
    insert into public.staff (user_id, role) values (${lit(uid)}, ${lit(role)}) on conflict (user_id) do update set role = excluded.role;
  else
    insert into public.staff_members (user_id, role) values (${lit(uid)}, ${lit(role)}) on conflict (user_id) do update set role = excluded.role;
  end if;
end $$`);
/** Enrols an authenticator on the account, as the person would at /two-factor or /security, and keeps its key with the account. */
async function withAuthenticator(key) {
  state.accounts[key].totp = await enrolAuthenticator(await session(state.accounts[key]), "Rehearsal");
  save();
}
async function buzzState() {
  await sql(DATA_HELPER_SQL);
  const data = await val(BUZZ_DATA_SQL);
  await sql(DROP_DATA_HELPER_SQL);
  return { catalog: await catalog(sql), data };
}
async function counts() {
  const tables = (await sql("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).map((r) => r.relname);
  return Object.fromEntries((await sql(`select ${tables.map((t) => `(select count(*)::int from public."${t}") as "${t}"`).join(", ")}`)).map((r) => Object.entries(r))[0]);
}

console.log(`Staging project ${project.name} (${REF}): ${STEP}`);

// --- baseline ---------------------------------------------------------------------------------------------------------
if (STEP === "baseline") {
  const done = await applied();
  const pending = MIGRATIONS.filter((f) => !done.has(f));
  await check("staging is in production's state: exactly the release's migrations are pending", () => expect(JSON.stringify(pending) === JSON.stringify(RELEASE), `pending: ${pending.join(", ")}`));
  state.run = Date.now().toString(36);
  state.accounts = {};
  state.ids = {};
  state.baseline = { catalog: await catalog(sql), counts: await counts(), buzzSecrets: await one("select thread_jitter_seconds, reply_jitter_seconds, min_campus_size from public.buzz_secrets where id = 1") };
  save();
  ok(`baseline kept (run ${state.run}): ${Object.values(state.baseline.catalog.function).length} functions, ${Object.keys(state.baseline.counts).length} tables`);
}

// --- seed (v1, production's state) --------------------------------------------------------------------------------------
if (STEP === "seed") {
  const run = state.run;
  const txstate = await val("select id from public.universities where email_domain = 'txstate.edu'");
  state.ids.txstate = txstate;
  const ops = await account("ops", `rh-ops-${run}@txstate.edu`, { full_name: "Rh Ops" });
  await sql(`select public.grant_role(${lit(ops.id)}, 'admin')`);
  // The admin is an admin of the staff with an authenticator (the staff console's rule, which 62's console asks too); a
  // moderator of the staff, for what a moderator must not see.
  await staffRole(ops.id, "admin");
  await withAuthenticator("ops");
  const mod = await account("mod", `rh-mod-${run}@txstate.edu`, { full_name: "Rh Mo" });
  await staffRole(mod.id, "moderator");
  await withAuthenticator("mod");
  const ben = await account("ben", `rh-ben-${run}@txstate.edu`, { full_name: "Rh Ben" });
  const cam = await account("cam", `rh-cam-${run}@txstate.edu`, { full_name: "Rh Cam" });
  const owner = await account("owner", `rh-owner-${run}@riverrock-staging.example`, { account_type: "business", full_name: "Rh Rita", business_name: `River Rock ${run}`, business_category: "housing", business_university_id: txstate });
  await sql(`update public.profiles set university_id = ${lit(txstate)}, created_at = now() - interval '30 days' where id in (${[ben, cam].map((u) => lit(u.id)).join(", ")})`);
  const business = await val(`select id from public.businesses where owner_id = ${lit(owner.id)}`);
  state.ids.business = business;
  const opsS = await session(ops), ownerS = await session(owner), benS = await session(ben), camS = await session(cam);
  await must(opsS.rpc("admin_review_business", { p_business: business, p_decision: "approved", p_note: null }));
  const apt = (await must(ownerS.from("apartments").insert({ owner_id: owner.id, business_id: business, title: "Rh two-bed", description: "Pool and gym", price_per_month: 1200, address: "1 River Rd", university_id: txstate }).select("id").single())).id;
  state.ids.apartment = apt;
  await must(opsS.rpc("admin_record_promotion", { p_target_type: "apartment", p_target_id: apt, p_starts_at: new Date(Date.now() - 864e5).toISOString(), p_ends_at: new Date(Date.now() + 6 * 864e5).toISOString(), p_amount_cents: 5000, p_currency: "USD", p_payment_reference: `RH-${run}` }));
  const invite = (await asUser(owner.id, `select token from public.business_invite_create(${lit(`rh-staff-${run}@riverrock-staging.example`)})`)).at(-1);
  const staff = await account("staff", `rh-staff-${run}@riverrock-staging.example`, { account_type: "business", full_name: "Rh Lee", business_invite: invite.token });
  state.ids.deal = (await must(ownerS.from("deals").insert({ business_id: business, created_by: owner.id, title: "Rh move-in special", description: "First month half off", discount_label: "50% off", code: "RH50", university_ids: [txstate] }).select("id").single())).id;
  const chat = await must(benS.rpc("start_business_inquiry", { p_target_type: "apartment", p_target_id: apt }));
  state.ids.inquiry = chat;
  await must(benS.from("messages").insert({ conversation_id: chat, sender_id: ben.id, content: "Is the two-bed still free?" }));
  const direct = await must(benS.rpc("get_or_create_direct_conversation", { p_other_user_id: cam.id }));
  state.ids.direct = direct;
  await must(camS.from("messages").insert({ conversation_id: direct, sender_id: cam.id, content: "Library at 6?" }));
  state.ids.post = (await must(benS.from("feed_posts").insert({ author_id: ben.id, kind: "post", body: "Move-in day #txst (rehearsal)", university_id: txstate }).select("id").single())).id;
  const version = BUZZ_GUIDELINES_VERSION;
  await sql("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, min_campus_size = 1 where id = 1");
  for (const u of [ben, cam]) await asUser(u.id, `select public.buzz_v2_accept_gate(${lit(version)})`);
  const thread = await val(`select (public.buzz_v2_create(${lit(ben.id)}, ${lit(JSON.stringify({ text: "Best study spot on campus? (rehearsal)" }))}::jsonb, 'active', false, null))->>'id'`);
  const reply = await val(`select (public.buzz_v2_reply(${lit(cam.id)}, ${lit(thread)}, ${lit(JSON.stringify({ text: "Third floor of the library" }))}::jsonb, 'active', false, null))->>'id'`);
  await val(`select (public.buzz_v2_reply(${lit(ben.id)}, ${lit(thread)}, ${lit(JSON.stringify({ text: "Which side?", parentId: reply }))}::jsonb, 'active', false, null))->>'id'`);
  Object.assign(state.ids, { thread, reply, buzzVersion: version });
  state.ids.video = await val(`insert into public.media (owner_id, provider, provider_upload_id, provider_asset_id, status, playback_id, duration_seconds, width, height) values (${lit(ben.id)}, 'mux', 'rh-up-${run}', 'rh-asset-${run}', 'ready', 'rhplayback${run}', 42, 720, 1280) returning id`);
  save();
  ok(`seeded run ${run}: business ${business}, listing ${apt} (promoted), inquiry ${chat}, buzz ${thread}`);
}

// --- check ---------------------------------------------------------------------------------------------------------------
if (STEP === "check") {
  const A = state.accounts, I = state.ids;
  const release = await val("select to_regclass('public.ads') is not null");
  const buzzTree = await val("select exists (select 1 from public._migrations where name = '20261108000000_buzz_reply_tree.sql')");
  console.log(`  state: ${release ? "after the release (Business v2)" : buzzTree ? "after the release's rollback (v1, Buzz 51 to 54 kept)" : "before the release (production's state)"}`);
  const ben = await session(A.ben), cam = await session(A.cam), owner = await session(A.owner), staff = await session(A.staff), ops = await session(A.ops);

  // What every state must keep: students' core paths, the business's reply-only messaging.
  await check("a student reads the feed and their own post", async () => expect((await must(ben.from("feed_posts").select("id").eq("id", I.post))).length === 1, "post missing"));
  await check("a student reads the Buzz feed (as the apps call it) with the seeded thread", async () => {
    const page = await must(ben.rpc("buzz_v2_feed", { p_scope: "campus", p_sort: "new", p_window: "day", p_q: null, p_limit: 50, p_offset: 0, p_rank_at: null }));
    expect(page.items.some((b) => b.id === I.thread), "thread missing from the feed");
  });
  await check("the student writes in their inquiry chat; the staffer reads it and replies", async () => {
    await must(ben.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.ben.id, content: `check ${Date.now()}` }));
    expect((await must(staff.from("messages").select("id").eq("conversation_id", I.inquiry))).length > 0, "the staffer cannot read the chat");
    await must(staff.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.staff.id, content: "Yes, still free" }));
  });
  await refused("the business cannot start a chat with a student", () => must(owner.rpc("get_or_create_direct_conversation", { p_other_user_id: A.cam.id })), "only reply|business");
  await check("two students chat", async () => { await must(ben.from("messages").insert({ conversation_id: I.direct, sender_id: A.ben.id, content: "See you there" })); });
  await check("signed out, no chat is readable", async () => expect((await must(anon.from("conversations").select("id").limit(5))).length === 0, "anon read chats"));
  await check("the promoted listing is Sponsored", async () => expect(await val(`select public.listing_sponsored(a) from public.apartments a where id = ${lit(I.apartment)}`), "not Sponsored"));
  await check("a student's ready video is untouched", async () => {
    const m = await one(`select status, playback_id, duration_seconds from public.media where id = ${lit(I.video)}`);
    expect(m.status === "ready" && m.playback_id === `rhplayback${state.run}` && Number(m.duration_seconds) === 42, JSON.stringify(m));
  });
  await check(release ? "the staffer is an editor now" : "the staffer is staff (v1)", async () => {
    const role = await val(`select role from public.business_members where user_id = ${lit(A.staff.id)}`);
    expect(role === (release ? "editor" : "staff"), role);
  });

  if (!release) {
    await check("no Business v2 objects", async () => expect(!(await val("select to_regprocedure('public.business_can(uuid, text)') is not null or exists (select 1 from pg_trigger where tgname = 'media_server_fields')")), "v2 left behind"));
  } else {
    const run = state.run;
    await check("the v1 promotion is a running housing ad, served in Housing (and not in For You) with the reviewed copy", async () => {
      const ad = await one(`select id, status, vertical, placements, promoted_snapshot is not null as snap from public.ads where promoted_apartment_id = ${lit(I.apartment)}`);
      expect(ad?.status === "active" && ad.vertical === "housing" && JSON.stringify(ad.placements) === '["housing"]' && ad.snap, JSON.stringify(ad));
      I.housingAd = ad.id;
      const housing = await must(ben.rpc("ads_for_feed", { p_placement: "housing", p_limit: 20, p_offset: 0 }));
      expect(housing.some((a) => a.id === ad.id || a.ad_id === ad.id), "not served in Housing");
      const forYou = await must(ben.rpc("ads_for_feed", { p_placement: "for_you", p_limit: 20, p_offset: 0 }));
      expect(!forYou.some((a) => a.id === ad.id || a.ad_id === ad.id), "a housing ad in For You");
    });
    await check("a link that is not http(s) is dropped, and the post's date is the server's", async () => {
      const d = await must(staff.from("deals").insert({ business_id: I.business, created_by: A.staff.id, title: "Rh link test", description: "x", link_url: "javascript:alert(1)", created_at: "2001-01-01T00:00:00Z", university_ids: [I.txstate] }).select("id, link_url, created_at").single());
      expect(d.link_url === null && d.created_at > "2026", JSON.stringify(d));
      await must(staff.from("deals").delete().eq("id", d.id));
    });
    let adId;
    await check("on the API, a business cannot make its own ad live: it is stored as an unreviewed draft", async () => {
      const row = await must(staff.from("ads").insert({ business_id: I.business, created_by: A.staff.id, name: `Rh self-approved ${run}`, objective: "traffic", placements: ["housing"], university_ids: [I.txstate], caption: "x", media: [], cta: "visit_profile", budget_cents: 0, status: "active", reviewed_by: A.ops.id, reviewed_at: new Date().toISOString(), starts_at: new Date(Date.now() - 6e4).toISOString(), ends_at: new Date(Date.now() + 864e5).toISOString() }).select("id, status, reviewed_by").single());
      await must(staff.from("ads").delete().eq("id", row.id));
      expect(row.status === "draft" && row.reviewed_by === null, JSON.stringify(row));
    });
    await check("the editor uploads a photo and drafts an ad (Housing, the business is a housing one); the owner submits it; the UniBuzz team approves it with its Fair Housing check and payment", async () => {
      const path = `business/${A.staff.id}/rh-${run}.png`;
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      const up = await staff.storage.from("uploads").upload(path, png, { contentType: "image/png", upsert: true });
      if (up.error) throw new Error(up.error.message);
      state.ids.upload = path; save();
      const url = staff.storage.from("uploads").getPublicUrl(path).data.publicUrl;
      const ad = await must(staff.from("ads").insert({ business_id: I.business, created_by: A.staff.id, name: `Rh ad ${run}`, objective: "traffic", placements: ["for_you"], university_ids: [I.txstate], caption: "Tour our pool this week", media: [{ type: "image", url }], cta: "learn_more", cta_url: "https://riverrock.example/tour", budget_cents: 2500, starts_at: new Date(Date.now() - 6e4).toISOString(), ends_at: new Date(Date.now() + 7 * 864e5).toISOString() }).select("id, status, placements").single());
      adId = ad.id; state.ids.ad = ad.id; save();
      expect(ad.status === "draft" && JSON.stringify(ad.placements) === '["housing"]', JSON.stringify(ad));
      await refused("…the editor cannot submit it (spend is the owner's or an admin's)", () => must(staff.rpc("ad_submit", { p_ad: ad.id })), "owner or an admin");
      await must(owner.rpc("ad_submit", { p_ad: ad.id }));
      const approved = await must(ops.rpc("admin_approve_ad", { p_ad: ad.id, p_amount_cents: 2500, p_currency: "USD", p_payment_reference: `RH-AD-${run}`, p_note: "Fair Housing words reviewed", p_fair_housing_checked: true }));
      expect(["active", "scheduled"].includes(approved.status), approved.status);
    });
    await refused("an ad photo on another host is refused", () => must(staff.from("ads").insert({ business_id: I.business, created_by: A.staff.id, name: "Rh bad photo", objective: "traffic", placements: ["housing"], university_ids: [I.txstate], caption: "x", media: [{ type: "image", url: "https://tracker.example/storage/v1/object/public/uploads/x.png" }], cta: "visit_profile", budget_cents: 0 })), "Upload photos");
    await check("students on the campus get the ad in Housing; one who hides it no longer does", async () => {
      const served = async (c) => (await must(c.rpc("ads_for_feed", { p_placement: "housing", p_limit: 20, p_offset: 0 }))).some((a) => (a.id ?? a.ad_id) === adId);
      expect(await served(cam), "Cam does not get it");
      await must(ben.rpc("hide_ad", { p_ad: adId }));
      expect(!(await served(ben)), "still shown after hiding");
    });
    await check("an impression and a click count, and the business sees them in its numbers", async () => {
      await must(cam.rpc("record_business_event", { p_event: "impression", p_ad: adId, p_placement: "housing" }));
      await must(cam.rpc("record_business_event", { p_event: "click", p_ad: adId, p_placement: "housing" }));
      const stats = await must(owner.rpc("business_ad_stats", { p_business: I.business }));
      const row = stats.find((s) => s.ad_id === adId);
      expect(row && row.impressions >= 1 && row.clicks >= 1, JSON.stringify(row));
    });
    await check("a saved ad leaves the student's saved ads when the UniBuzz team pauses it", async () => {
      await must(cam.rpc("save_ad", { p_ad: adId, p_saved: true }));
      expect((await must(cam.rpc("my_saved_ads"))).some((a) => (a.id ?? a.ad_id) === adId), "not saved");
      await must(ops.rpc("admin_pause_ad", { p_ad: adId, p_reason: "rehearsal" }));
      expect(!(await must(cam.rpc("my_saved_ads"))).some((a) => (a.id ?? a.ad_id) === adId), "a paused ad is still in saved ads");
      await must(ops.rpc("admin_resume_ad", { p_ad: adId }));
    });
    await check("a new inquiry: the business sees neither the chat nor the student, nor can it write first, until the student writes", async () => {
      // A student who has never written to this business (a new one each run, so the check can run again).
      const key = `inq${Date.now().toString(36)}`;
      const dee = await account(key, `rh-${key}-${run}@txstate.edu`, { full_name: "Rh Dee" });
      await sql(`update public.profiles set university_id = ${lit(I.txstate)} where id = ${lit(dee.id)}`);
      const deeS = await session(dee);
      const chat = await must(deeS.rpc("start_business_inquiry", { p_target_type: "deal", p_target_id: I.deal }));
      expect((await must(staff.from("conversations").select("id").eq("id", chat))).length === 0, "the business sees the empty chat");
      expect((await must(owner.from("profiles").select("id").eq("id", dee.id))).length === 0, "the business sees the student");
      let first = false;
      try { await must(staff.from("messages").insert({ conversation_id: chat, sender_id: A.staff.id, content: "Hi! Can we help?" })); } catch (e) { first = /only reply|row-level/i.test(e.message); }
      expect(first, "the business wrote first in the student's empty inquiry");
      await must(deeS.from("messages").insert({ conversation_id: chat, sender_id: dee.id, content: "Does the code work online?" }));
      expect((await must(staff.from("conversations").select("id").eq("id", chat))).length === 1, "the business cannot see the chat after the student wrote");
      await must(staff.from("messages").insert({ conversation_id: chat, sender_id: A.staff.id, content: "It does" }));
    });
    await check("a student who blocks the business: neither side can write until unblocked", async () => {
      await must(ben.rpc("set_business_blocked", { p_business: I.business, p_blocked: true }));
      let refusedReply = false;
      try { await must(staff.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.staff.id, content: "Hello?" })); } catch (e) { refusedReply = /not taking messages|can't write|cannot write|violates/i.test(e.message); }
      let refusedOwn = false;
      try { await must(ben.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.ben.id, content: "Hi" })); } catch (e) { refusedOwn = /blocked|can't write|violates/i.test(e.message); }
      await must(ben.rpc("set_business_blocked", { p_business: I.business, p_blocked: false }));
      expect(refusedReply && refusedOwn, `reply refused ${refusedReply}, own write refused ${refusedOwn}`);
      await must(ben.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.ben.id, content: "Unblocked" }));
    });
    await check("a video row a student writes starts as an upload: the processing details stay the server's", async () => {
      const m = await must(cam.from("media").insert({ owner_id: A.cam.id, provider: "mux", status: "ready", playback_id: "rhforged", duration_seconds: 5 }).select("id, status, playback_id, duration_seconds").single());
      state.ids.camMedia = m.id; save();
      expect(m.status === "uploading" && m.playback_id === null && m.duration_seconds === null, JSON.stringify(m));
      await must(cam.from("media").update({ status: "ready", playback_id: "rhforged" }).eq("id", m.id));
      const after = await one(`select status, playback_id from public.media where id = ${lit(m.id)}`);
      expect(after.status === "uploading" && after.playback_id === null, JSON.stringify(after));
    });
    await check("the business reads the UniBuzz team's actions without the reviewer's id", async () => {
      const rows = await must(owner.rpc("business_audit", { p_business: I.business, p_limit: 50, p_before: null }));
      const team = rows.filter((r) => r.actor_kind === "admin");
      expect(team.length > 0 && team.every((r) => !r.actor_id && r.actor_name === "UniBuzz team"), JSON.stringify(team[0] ?? rows.length));
    });
    await check("editing the promoted listing pauses its ad for the UniBuzz team", async () => {
      await must(owner.from("apartments").update({ title: `Rh two-bed, renovated ${Date.now().toString(36)}` }).eq("id", I.apartment));
      const ad = await one(`select status, paused_by from public.ads where promoted_apartment_id = ${lit(I.apartment)}`);
      expect(ad.status === "paused" && ad.paused_by === "admin", JSON.stringify(ad));
      await must(ops.rpc("admin_resume_ad", { p_ad: I.housingAd }));
      expect((await val(`select status from public.ads where id = ${lit(I.housingAd)}`)) === "active", "not resumed");
    });
    await check("the ads sweep is scheduled with pg_cron", async () => expect(await val("select exists (select 1 from cron.job where jobname = 'ads-sweep')"), "no ads-sweep job"));
    // 62: CampConnect Admin's Analytics and Business, as the admin app calls them.
    if (await val("select to_regclass('public.ad_rates') is not null")) {
      await check("62: Analytics (overview, ads, revenue), the businesses, the campaigns with the approved ad and its payment, the payments and the rate card answer an admin signed in with a second factor", async () => {
        const overview = await must(ops.rpc("console_analytics_overview", { p_days: 30, p_university: null }));
        expect(overview && typeof overview === "object", "no overview");
        await must(ops.rpc("console_analytics_ads", { p_days: 30, p_university: null }));
        await must(ops.rpc("console_analytics_revenue", { p_days: 30 }));
        expect(JSON.stringify(await must(ops.rpc("console_businesses", { p_q: null, p_status: null, p_limit: 30, p_offset: 0 }))).includes(I.business), "the rehearsal's business is not listed");
        expect(JSON.stringify(await must(ops.rpc("console_ads", { p_status: "all", p_q: null, p_business: I.business, p_limit: 30, p_offset: 0 }))).includes(adId), "the approved ad is not listed");
        expect(JSON.stringify(await must(ops.rpc("console_ad", { p_id: adId }))).includes(`RH-AD-${run}`), "the ad's payment is not on its page");
        expect(JSON.stringify(await must(ops.rpc("console_payments", { p_days: null, p_status: null, p_q: `RH-AD-${run}`, p_limit: 50, p_offset: 0 }))).includes(`RH-AD-${run}`), "the payment is not listed");
        await must(ops.rpc("console_ad_rates"));
        await must(ops.rpc("console_business_overview"));
        expect(await val("select exists (select 1 from cron.job where jobname = 'platform-activity')"), "no platform-activity job");
      });
      await check("62: a student, a moderator and an admin without the second factor are refused", async () => {
        for (const [who, c] of [["a student", ben], ["a moderator", await session(A.mod)], ["an admin without the second factor", await session(A.ops, { firstFactorOnly: true })]]) {
          let why = "";
          try { await must(c.rpc("console_businesses", { p_q: null, p_status: null, p_limit: 5, p_offset: 0 })); } catch (e) { why = e.message; }
          expect(/ts:|permission denied|two-factor|authenticator/i.test(why), `${who}: ${why || "allowed"}`);
        }
      });
      await check("62: a note on the business is kept on its page and lands in the staff audit log", async () => {
        await must(ops.rpc("console_add_business_note", { p_business: I.business, p_body: `Rehearsal note ${run}` }));
        expect(JSON.stringify(await must(ops.rpc("console_business", { p_id: I.business }))).includes(`Rehearsal note ${run}`), "note missing from the business page");
        expect(await val(`select exists (select 1 from public.staff_audit_log where actor_id = ${lit(A.ops.id)} and action = 'business.note')`), "no audit row");
      });
    }
    await check("Buzz: a buzz takes a category, a nested reply keeps its parent, today's prompt has a thread", async () => {
      const cat = await val("select (regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)'''))[1] from pg_constraint where conname = 'buzz_posts_category_check'");
      const b = await val(`select (public.buzz_v2_create(${lit(A.cam.id)}, ${lit(JSON.stringify({ text: "Category check (rehearsal)", category: cat }))}::jsonb, 'active', false, null))->>'category'`);
      expect(b === cat, `category ${b}`);
      state.ids.categoryBuzz = await val(`select id from public.buzz_posts where author_id = ${lit(A.cam.id)} and body like 'Category check%' order by created_at desc limit 1`); save();
      const replies = await must(cam.rpc("buzz_v2_replies", { p_thread: I.thread, p_offset: 0, p_limit: 50 }));
      expect(JSON.stringify(replies).includes(`"treeParentId":"${I.reply}"`), "no treeParentId");
      const prompt = await one("select * from public.buzz_v2_today_prompt()");
      const threadId = await must(cam.rpc("buzz_v2_prompt_thread", { p_prompt: prompt.prompt_id, p_scope: "campus" }));
      state.ids.promptThread = threadId; save();
      const meta = await must(cam.rpc("buzz_v2_meta", { p_scope: "campus" }));
      expect(meta.prompt.threadId === threadId, JSON.stringify(meta.prompt));
    });
  }
  save();
}

// --- probe (the release's ad approval and payment rules, attacked through the API) --------------------------------------
if (STEP === "probe") {
  const A = state.accounts, I = state.ids, run = state.run;
  if (!(await val("select to_regclass('public.ads') is not null"))) throw new Error("Run `apply` first: the probe needs Business v2.");
  const owner = await session(A.owner), staff = await session(A.staff), ops = await session(A.ops), cam = await session(A.cam);
  const fresh = async (u) => session(u); // a new client: PostgREST may hand it any pooled connection
  const soon = (d) => new Date(Date.now() + d * 864e5).toISOString();
  if (!I.upload) throw new Error("Run `check` first: it uploads the photo the probe's ads use.");
  const photo = { type: "image", url: staff.storage.from("uploads").getPublicUrl(I.upload).data.publicUrl };
  const base = (extra = {}) => ({ business_id: I.business, created_by: A.staff.id, name: `Rh probe ${run}`, objective: "traffic", placements: ["housing"], university_ids: [I.txstate], caption: "Probe", media: [photo], cta: "visit_profile", budget_cents: 2500, starts_at: soon(-0.01), ends_at: soon(3), ...extra });
  const adRow = (id) => one(`select status, reviewed_by, reviewed_at, submitted_at, started_at, promoted_snapshot, paused_by, caption, ends_at, university_ids, budget_cents from public.ads where id = ${lit(id)}`);
  const rejects = (name, fn, pattern) => refused(name, fn, pattern);
  const made = [];

  // A second approved business, a food one, for the cross-business attempts; an analyst on River Rock's team.
  const other = A.other ?? (await account("other", `rh-other-${run}@cafe-staging.example`, { account_type: "business", full_name: "Rh Otto", business_name: `Rh Cafe ${run}`, business_category: "food", business_university_id: I.txstate }));
  I.otherBusiness = I.otherBusiness ?? (await val(`select id from public.businesses where owner_id = ${lit(other.id)}`));
  await must(ops.rpc("admin_review_business", { p_business: I.otherBusiness, p_decision: "approved", p_note: null })).catch(() => {});
  if (!A.analyst) {
    const inv = (await asUser(A.owner.id, `select token from public.business_invite_create(${lit(`rh-analyst-${run}@riverrock-staging.example`)}, 'analyst')`)).at(-1);
    await account("analyst", `rh-analyst-${run}@riverrock-staging.example`, { account_type: "business", full_name: "Rh Ana", business_invite: inv.token });
  }
  save();
  const otherS = await session(A.other), analyst = await session(A.analyst);

  await check("1. a business's ad written as live (status, review, payment, start, copy) is stored as an unreviewed draft, on 6 fresh connections", async () => {
    for (let i = 0; i < 6; i++) {
      const c = await fresh(A.staff);
      const row = await must(c.from("ads").insert(base({ status: i % 2 ? "scheduled" : "active", reviewed_by: A.ops.id, reviewed_at: soon(0), submitted_at: soon(0), started_at: soon(0), fair_housing_checked_by: A.ops.id, promoted_snapshot: { title: "forged" }, paused_by: null })).select("id").single());
      made.push(row.id);
      const r = await adRow(row.id);
      expect(r.status === "draft" && !r.reviewed_by && !r.reviewed_at && !r.submitted_at && !r.started_at && !r.promoted_snapshot, JSON.stringify(r));
    }
  });
  const draftId = made[0];
  await check("2. a business cannot move its draft to scheduled, active or pending review by an update", async () => {
    for (const status of ["active", "scheduled", "pending_review", "completed"]) {
      await (await fresh(A.owner)).from("ads").update({ status, reviewed_by: A.ops.id }).eq("id", draftId);
      const r = await adRow(draftId);
      expect(r.status === "draft" && !r.reviewed_by, `${status}: ${JSON.stringify(r)}`);
    }
  });
  await must(owner.rpc("ad_submit", { p_ad: draftId }));
  await rejects("3. an ad waiting for review cannot be edited", () => must(staff.from("ads").update({ caption: "Changed while pending" }).eq("id", draftId).select("id")), "Only a draft");
  await must(ops.rpc("admin_approve_ad", { p_ad: draftId, p_amount_cents: 1000, p_currency: "USD", p_payment_reference: `RH-PROBE-${run}`, p_note: "probe", p_fair_housing_checked: true }));
  for (const [what, patch] of [["its caption", { caption: "Bait and switch" }], ["its photos", { media: [] }], ["its campuses", { university_ids: [] }], ["its end date (running longer than paid)", { ends_at: soon(60) }], ["its budget", { budget_cents: 1 }], ["the reviewed copy", { promoted_snapshot: { title: "forged" } }], ["its status", { status: "completed" }]]) {
    await rejects(`4. an approved ad's ${what} cannot be changed by the business`, () => must(owner.from("ads").update(patch).eq("id", draftId).select("id")), "Only a draft|violates|row-level");
  }
  await check("4b. after those attempts the approved ad is exactly as approved", async () => {
    const r = await adRow(draftId);
    expect(["active", "scheduled"].includes(r.status) && r.caption === "Probe" && Number(r.budget_cents) === 2500 && r.reviewed_by, JSON.stringify(r));
  });
  await rejects("5. a business cannot record a payment", () => must(owner.from("listing_promotions").insert({ ad_id: made[1], business_id: I.business, amount_cents: 1, currency: "USD", payment_reference: "FORGED", starts_at: soon(-1), ends_at: soon(30), status: "active" })), "permission denied|row-level|violates");
  await check("5b. nor change or delete one (nothing changes)", async () => {
    const before = await val(`select count(*)::int from public.listing_promotions where payment_reference = ${lit(`RH-PROBE-${run}`)} and status = 'active'`);
    await owner.from("listing_promotions").update({ ends_at: soon(365) }).eq("payment_reference", `RH-PROBE-${run}`);
    await owner.from("listing_promotions").delete().eq("payment_reference", `RH-PROBE-${run}`);
    const after = await one(`select count(*)::int as n, max(ends_at) < now() + interval '30 days' as same_end from public.listing_promotions where payment_reference = ${lit(`RH-PROBE-${run}`)} and status = 'active'`);
    expect(before === 1 && after.n === 1 && after.same_end, JSON.stringify({ before, after }));
  });
  for (const [fn, args] of [["admin_approve_ad", { p_ad: made[1], p_amount_cents: 1, p_currency: "USD", p_payment_reference: "SELF", p_note: null, p_fair_housing_checked: true }], ["admin_record_promotion", { p_target_type: "apartment", p_target_id: I.apartment, p_starts_at: soon(-1), p_ends_at: soon(30), p_amount_cents: 1, p_currency: "USD", p_payment_reference: "SELF" }], ["admin_resume_ad", { p_ad: draftId }], ["admin_pause_ad", { p_ad: I.housingAd ?? draftId, p_reason: "x" }], ["admin_reject_ad", { p_ad: made[1], p_reason: "x" }], ["admin_set_verified", { p_business: I.business, p_verified: true, p_evidence: null }], ["admin_review_business", { p_business: I.otherBusiness, p_decision: "suspended", p_note: null }]]) {
    await rejects(`6. the business cannot call ${fn}`, () => must(owner.rpc(fn, args)), "admin|team|permission|not allowed|Only");
  }
  for (const [fn, args] of [["ad_transition", { p_ad: made[1], p_actor_kind: "admin", p_action: "approve" }], ["ads_pause_for_review", { p_ids: [draftId], p_reason: "x" }], ["storage_upload_url_ok", { p_url: "x", p_owners: [] }], ["business_media_problem", { p_media: [], p_business: I.business, p_any_host: true, p_require_ready: false }], ["ads_sweep", {}], ["business_audit_write", { p_business: I.business, p_actor_kind: "admin", p_action: "x", p_target_type: "ad", p_target_id: draftId }], ["business_notify_team", { p_business: I.business, p_title: "x", p_body: "x", p_link: "/" }]]) {
    await rejects(`7. internal helper ${fn} is not callable through the API`, () => must(owner.rpc(fn, args)), "PGRST202|permission denied|Could not find|not find");
  }
  await check("7b. no internal ad, payment or audit helper is executable by a signed-in or signed-out session", async () => {
    const open = await sql(`select p.oid::regprocedure::text as fn from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('ad_transition', 'ads_pause_for_review', 'ad_promoted_snapshot', 'ad_screen_text', 'storage_upload_url_ok', 'business_media_problem',
        'business_media_snapshot', 'ads_sweep', 'business_audit_write', 'business_notify_team', 'ads_before_write', 'deals_before_write', 'business_claim_invite',
        'deals_rereview_ads', 'apartments_rereview_ads', 'businesses_rereview_ads', 'businesses_clean_website', 'media_server_fields')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
    expect(open.length === 0, open.map((r) => r.fn).join(", "));
  });
  await must(ops.rpc("admin_pause_ad", { p_ad: draftId, p_reason: "probe takedown" }));
  await rejects("8. an ad the UniBuzz team paused cannot be resumed by the business", () => must(owner.rpc("ad_resume", { p_ad: draftId })), "UniBuzz|team|paused");
  await rejects("9. an analyst cannot draft an ad", () => must(analyst.from("ads").insert(base({ created_by: A.analyst.id }))), "row-level|violates");
  await rejects("9b. nor submit one", () => must(analyst.rpc("ad_submit", { p_ad: made[1] })), "owner or an admin|No such ad|permission");
  await check("9c. nor read the students' messages", async () => expect((await must(analyst.from("messages").select("id").eq("conversation_id", I.inquiry))).length === 0, "the analyst reads the inquiry"));
  await check("10. another business reads none of this business's ads or payments", async () => {
    expect((await must(otherS.from("ads").select("id").eq("business_id", I.business))).length === 0, "ads visible");
    expect((await must(otherS.from("listing_promotions").select("id").eq("business_id", I.business))).length === 0, "payments visible");
  });
  await rejects("10b. nor its numbers", () => must(otherS.rpc("business_ad_stats", { p_business: I.business })), "Only|permission|team|business");
  await rejects("10c. nor can it draft an ad promoting another business's listing", () => must(otherS.from("ads").insert({ ...base({ business_id: I.otherBusiness, created_by: A.other.id, placements: ["for_you"] }), promoted_apartment_id: I.apartment })), "only your own|row-level");
  await rejects("11. a student cannot write an ad", () => must(cam.from("ads").insert(base({ created_by: A.cam.id }))), "row-level|violates");
  await check("11b. nor read the ads table or any payment directly", async () => {
    expect((await must(cam.from("ads").select("id").limit(5))).length === 0, "a student reads ads");
    expect((await must(cam.from("listing_promotions").select("id").limit(5))).length === 0, "a student reads payments");
  });
  await check("12. copying an approved ad makes an unpaid, unreviewed draft", async () => {
    const copy = await must(owner.rpc("ad_duplicate", { p_ad: draftId }));
    const id = typeof copy === "string" ? copy : copy?.id;
    made.push(id);
    const r = await adRow(id);
    expect(r.status === "draft" && !r.reviewed_by && !r.promoted_snapshot, JSON.stringify(r));
    expect((await val(`select count(*)::int from public.listing_promotions where ad_id = ${lit(id)}`)) === 0, "the copy has a payment");
  });
  await check("13. a business cannot delete an ad that ran (the payment record and history stay)", async () => {
    await owner.from("ads").delete().eq("id", draftId);
    expect((await val(`select count(*)::int from public.ads where id = ${lit(draftId)}`)) === 1, "deleted");
  });
  await check("14. a new listing is not Sponsored, and the business cannot make it so", async () => {
    const apt = (await must(owner.from("apartments").insert({ owner_id: A.owner.id, business_id: I.business, title: "Rh unpaid listing", description: "x", price_per_month: 900, address: "2 River Rd", university_id: I.txstate }).select("id").single())).id;
    state.ids.unpaidApartment = apt; save();
    expect(!(await val(`select public.listing_sponsored(a) from public.apartments a where id = ${lit(apt)}`)), "Sponsored without payment");
  });
  await check("15. editing the promoted post of an approved ad pauses the ad for the UniBuzz team", async () => {
    const ad = await must(staff.from("ads").insert({ ...base({ placements: ["for_you"] }), promoted_deal_id: I.deal }).select("id").single());
    made.push(ad.id);
    await must(owner.rpc("ad_submit", { p_ad: ad.id }));
    await must(ops.rpc("admin_approve_ad", { p_ad: ad.id, p_amount_cents: 500, p_currency: "USD", p_payment_reference: `RH-PROBE2-${run}`, p_note: "probe", p_fair_housing_checked: true }));
    await must(owner.from("deals").update({ title: `Rh move-in special ${Date.now().toString(36)}` }).eq("id", I.deal));
    const r = await adRow(ad.id);
    expect(r.status === "paused" && r.paused_by === "admin", JSON.stringify(r));
  });
  await check("16. changing the business's category pauses its running ads for the UniBuzz team", async () => {
    await must(ops.rpc("admin_resume_ad", { p_ad: I.housingAd })).catch(() => {});
    const runningBefore = await val(`select count(*)::int from public.ads where business_id = ${lit(I.business)} and status in ('active', 'scheduled')`);
    await must(owner.from("businesses").update({ category: "food" }).eq("id", I.business));
    const runningAfter = await val(`select count(*)::int from public.ads where business_id = ${lit(I.business)} and status in ('active', 'scheduled')`);
    await must(owner.from("businesses").update({ category: "housing" }).eq("id", I.business));
    expect(runningBefore > 0 && runningAfter === 0, `${runningBefore} running before, ${runningAfter} after`);
  });
  await check("17. through Storage itself, the photo of a live ad cannot be overwritten or deleted by its uploader", async () => {
    const path = state.ids.upload;
    expect(path, "run `check` first: it uploads the ad photo");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const over = await staff.storage.from("uploads").upload(path, png, { contentType: "image/png", upsert: true });
    const del = await staff.storage.from("uploads").remove([path]);
    const still = await val(`select count(*)::int from storage.objects where bucket_id = 'uploads' and name = ${lit(path)}`);
    expect(over.error && still === 1 && (del.error || (del.data ?? []).length === 0), JSON.stringify({ over: over.error?.message ?? "overwritten", del: del.error?.message ?? del.data, still }));
  });
  await check("18. pausing first does not skip the review: an edit while the business has it paused hands it to the UniBuzz team", async () => {
    const deal = (await must(owner.from("deals").insert({ business_id: I.business, created_by: A.owner.id, title: `Rh pause probe ${run}`, description: "x", university_ids: [I.txstate] }).select("id").single())).id;
    const ad = await must(staff.from("ads").insert({ ...base({ placements: ["for_you"] }), promoted_deal_id: deal }).select("id").single());
    made.push(ad.id);
    await must(owner.rpc("ad_submit", { p_ad: ad.id }));
    await must(ops.rpc("admin_approve_ad", { p_ad: ad.id, p_amount_cents: 500, p_currency: "USD", p_payment_reference: `RH-PROBE3-${run}`, p_note: "probe", p_fair_housing_checked: true }));
    await must(owner.rpc("ad_pause", { p_ad: ad.id }));
    await must(owner.from("deals").update({ title: "Verify your student login", link_url: "https://phish.example" }).eq("id", deal));
    const r = await adRow(ad.id);
    expect(r.status === "paused" && r.paused_by === "admin", JSON.stringify(r));
    let refusedResume = false;
    try { await must(owner.rpc("ad_resume", { p_ad: ad.id })); } catch (e) { refusedResume = /UniBuzz team paused/.test(e.message); }
    expect(refusedResume, "the business resumed it");
    state.ids.probeDeal = deal; save();
  });
  await check("19. when its promoted post is deleted, the ad stops, is not served, and the team cannot resume it", async () => {
    const ad = made.at(-1);
    await must(owner.from("deals").delete().eq("id", state.ids.probeDeal));
    const r = await adRow(ad);
    expect(r.status === "paused" && r.paused_by === "admin", JSON.stringify(r));
    let refused = false;
    try { await must(ops.rpc("admin_resume_ad", { p_ad: ad })); } catch (e) { refused = /removed/.test(e.message); }
    expect(refused, "resumed");
  });
  await check("20. an ad shows the business's logo only when it is the team's own upload", async () => {
    await sql(`update public.businesses set logo_url = 'http://tracker.example/px.gif' where id = ${lit(I.business)}`);
    for (const { id } of await sql(`select id from public.ads where business_id = ${lit(I.business)} and status = 'paused' and paused_by = 'admin' and promoted_apartment_id is not null`)) await must(ops.rpc("admin_resume_ad", { p_ad: id })).catch(() => {});
    const served = await must(cam.rpc("ads_for_feed", { p_placement: "housing", p_limit: 10, p_offset: 0 }));
    await sql(`update public.businesses set logo_url = null where id = ${lit(I.business)}`);
    expect(served.length > 0 && served.every((a) => a.business_logo_url === null), JSON.stringify(served.map((a) => a.business_logo_url)));
  });
  state.ids.probeAds = made; save();
}

// --- apply (what db:setup does, with traffic) ----------------------------------------------------------------------------
if (STEP === "apply") {
  const A = state.accounts, I = state.ids;
  const done = await applied();
  // `apply <file> …` applies only those of the pending files (a migration that goes live alone, ahead of the release).
  const only = process.argv.slice(3);
  for (const f of only) if (!MIGRATIONS.includes(f)) throw new Error(`${f} is not a migration file`);
  const pending = MIGRATIONS.filter((f) => !done.has(f) && (only.length === 0 || only.includes(f)));
  console.log(`  pending, in file order: ${pending.join(", ") || "none"}${only.length ? " (only the files asked for)" : ""}`);
  const sessions = { ben: await session(A.ben), cam: await session(A.cam), staff: await session(A.staff) };
  let current = "before";
  const log = [];
  let stop = false;
  const probe = async (who, op, fn) => {
    const t0 = Date.now();
    try { const { error } = await fn(); log.push({ who, op, ms: Date.now() - t0, during: current, error: error ? `${error.code ?? ""} ${error.message}` : null }); }
    catch (e) { log.push({ who, op, ms: Date.now() - t0, during: current, error: String(e.message ?? e) }); }
  };
  const loop = async (who, ops) => { let i = 0; while (!stop) { const [op, fn] = ops[i++ % ops.length]; await probe(who, op, fn); await new Promise((r) => setTimeout(r, 150)); } };
  const loops = [
    loop("student", [
      ["read feed", () => sessions.ben.from("feed_posts").select("id").limit(10)],
      ["Buzz feed", () => sessions.ben.rpc("buzz_v2_feed", { p_scope: "campus", p_sort: "new", p_window: "day", p_q: null, p_limit: 20, p_offset: 0, p_rank_at: null })],
      ["read chats", () => sessions.ben.from("conversations").select("id").limit(10)],
      ["write in the inquiry chat", () => sessions.ben.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.ben.id, content: "probe" })],
      ["read notifications", () => sessions.ben.from("notifications").select("id").limit(10)],
      ["read listings", () => sessions.ben.from("apartments").select("id, title").limit(10)],
    ]),
    loop("student 2", [
      ["write to a student", () => sessions.cam.from("messages").insert({ conversation_id: I.direct, sender_id: A.cam.id, content: "probe" })],
      ["read the business's deals", () => sessions.cam.from("deals").select("id").eq("business_id", I.business)],
      ["read a profile", () => sessions.cam.from("profiles").select("id, full_name").eq("id", A.ben.id)],
    ]),
    loop("staffer", [
      ["read the inquiry chat", () => sessions.staff.from("messages").select("id").eq("conversation_id", I.inquiry).limit(5)],
      ["reply in the inquiry chat", () => sessions.staff.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.staff.id, content: "probe reply" })],
      ["read the team's business", () => sessions.staff.from("businesses").select("id, status").eq("id", I.business)],
    ]),
  ];
  await new Promise((r) => setTimeout(r, 3000));
  const timings = [];
  for (const f of pending) {
    current = f;
    const t0 = Date.now();
    try {
      await sql(read(`supabase/migrations/${f}`));
      await sql(`insert into public._migrations (name) values (${lit(f)}) on conflict do nothing`);
      timings.push(`${f} ${Date.now() - t0} ms`);
    } catch (e) {
      fail(`${f} applies`, e);
      break;
    }
  }
  current = "seed";
  await sql(read("supabase/seed.sql"));
  current = "after";
  await new Promise((r) => setTimeout(r, 4000));
  await sql("notify pgrst, 'reload schema'");
  await new Promise((r) => setTimeout(r, 3000));
  stop = true;
  await Promise.all(loops);
  for (const t of timings) ok(`applied: ${t}`);
  const failed = log.filter((l) => l.error);
  const ms = log.map((l) => l.ms).sort((a, b) => a - b);
  console.log(`  traffic while applying: ${log.length} requests, ${failed.length} failed; latency p50 ${ms[Math.floor(ms.length / 2)]} ms, p95 ${ms[Math.floor(ms.length * 0.95)]} ms, max ${ms.at(-1)} ms`);
  const groups = {};
  for (const l of failed) { const k = `${l.who} · ${l.op} · during ${l.during} · ${l.error.slice(0, 160)}`; groups[k] = (groups[k] ?? 0) + 1; }
  for (const [k, n] of Object.entries(groups)) console.log(`    ✗ ${n}× ${k}`);
  if (failed.length) failures++; else passes++;
  state.lastApply = { at: new Date().toISOString(), pending, requests: log.length, failed: failed.length, groups };
  save();
}

// --- rollback (the release's own: business migrations only) --------------------------------------------------------------
if (STEP === "rollback") {
  const done = await applied();
  const order = [...BUSINESS].reverse().filter((f) => done.has(f));
  const before = await buzzState();
  for (const f of order) {
    const t0 = Date.now();
    try {
      await sql(`${read(`supabase/rollbacks/${f.replace(/\.sql$/, ".down.sql")}`)}\n;\ndelete from public._migrations where name = ${lit(f)};`);
      ok(`rolled back ${f} (${Date.now() - t0} ms)`);
    } catch (e) { fail(`roll back ${f}`, e); break; }
  }
  await sql("notify pgrst, 'reload schema'");
  const after = await buzzState();
  await check("Buzz's 51 to 54 are still recorded as applied", async () => {
    const now = await applied();
    expect(RELEASE.filter((f) => f.includes("_buzz_")).every((f) => now.has(f)), "a Buzz migration is no longer recorded");
  });
  await check("every Buzz table, column, constraint, index, trigger, policy, grant and function is as it was", () => {
    const changed = diffCatalogs(before.catalog, after.catalog, isBuzz);
    expect(changed.length === 0, changed.join("; "));
  });
  await check("every Buzz row is as it was", () => {
    const tables = Object.keys({ ...before.data, ...after.data }).filter((t) => before.data[t] !== after.data[t]);
    expect(tables.length === 0, `changed: ${tables.join(", ")}`);
  });
}

// --- restore (production's state again) --------------------------------------------------------------------------------
if (STEP === "restore") {
  const done = await applied();
  for (const f of [...RELEASE].reverse().filter((x) => done.has(x))) {
    try {
      await sql(`${read(`supabase/rollbacks/${f.replace(/\.sql$/, ".down.sql")}`)}\n;\ndelete from public._migrations where name = ${lit(f)};`);
      ok(`rolled back ${f}`);
    } catch (e) { fail(`roll back ${f}`, e); break; }
  }
  await sql("notify pgrst, 'reload schema'");
  await check("the schema is baseline's again (production's state)", async () => {
    const changed = diffCatalogs(state.baseline.catalog, await catalog(sql));
    expect(changed.length === 0, changed.join("; "));
  });
}

// --- cleanup -------------------------------------------------------------------------------------------------------------
if (STEP === "cleanup") {
  const A = state.accounts ?? {}, I = state.ids ?? {};
  const ids = Object.values(A).map((u) => u.id);
  if (I.upload) await admin.storage.from("uploads").remove([I.upload]);
  const buzz = [I.thread, I.categoryBuzz, I.promptThread].filter(Boolean);
  if (buzz.length) await sql(`delete from public.buzz_posts where id in (${buzz.map(lit).join(", ")})`);
  if (I.business) await sql(`delete from public.businesses where id = ${lit(I.business)}`);
  if (ids.length) {
    await sql(`delete from public.conversations c where exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id in (${ids.map(lit).join(", ")}))`);
    await sql(`delete from public.listing_promotions where payment_reference like ${lit(`RH-%${state.run}`)}`).catch(() => {});
    if (I.otherBusiness) await sql(`delete from public.businesses where id = ${lit(I.otherBusiness)}`).catch(() => {});
  }
  for (const id of ids) { const { error } = await admin.auth.admin.deleteUser(id); if (error) fail(`delete account ${id}`, error); }
  // The staff audit log kept what the rehearsal's staff did, and their removal (staff_log_delete): not the rehearsal's to leave behind.
  if (ids.length) await sql(`delete from public.staff_audit_log where actor_id in (${ids.map(lit).join(", ")}) or target_id in (${ids.map(lit).join(", ")})`).catch(() => {});
  const s = state.baseline?.buzzSecrets;
  if (s) await sql(`update public.buzz_secrets set thread_jitter_seconds = ${s.thread_jitter_seconds}, reply_jitter_seconds = ${s.reply_jitter_seconds}, min_campus_size = ${s.min_campus_size} where id = 1`);
  await check("every table has baseline's row count again (nothing the rehearsal made is left)", async () => {
    const now = await counts();
    const off = Object.keys(state.baseline.counts).filter((t) => state.baseline.counts[t] !== now[t]).map((t) => `${t} ${state.baseline.counts[t]} -> ${now[t]}`);
    // Tables the release added are not baseline's: their rows go with `restore` (its own seed rows, like 62's rate card).
    const extra = Object.keys(now).filter((t) => !(t in state.baseline.counts) && now[t] > 0).map((t) => `${t} ${now[t]}`);
    if (extra.length) console.log(`  - the release's own tables still here, with rows (restore drops them): ${extra.join(", ")}`);
    expect(off.length === 0, off.join(", "));
  });
}

console.log(`${failures ? "✗" : "✓"} ${STEP}: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
