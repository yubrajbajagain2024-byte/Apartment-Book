// The Business v2 release (migrations 44, 46, 47 and 49 to 56, with Buzz's 51 to 54 in the same run) rehearsed on the
// staging project, the way production will take it, through the real Supabase stack: Auth sessions, the REST API,
// Storage, pg_cron. Never runs against production: it refuses production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/release-rehearsal.mjs <step>
//
// The steps, in order (what they made and saw is kept in supabase/tests/staging/.rehearsal.json, git-ignored):
//   baseline  staging must be in production's state: the release's migrations, and only they, pending. Keeps its
//             catalog and row counts, for restore and cleanup to compare with.
//   seed      v1-shaped data through the API: an approved housing business, its promoted listing (a v1 payment), a
//             staffer, a deal, a student's inquiry chat, a chat between two students, a post, a buzz with replies, a
//             student's ready video.
//   check     the checks for the state staging is in: before the release (v1), after it (Business v2), or after the
//             release's rollback (v1 again, with Buzz's 51 to 54 still applied).
//   apply     what `npm run db:setup` does (every pending migration in file order as one query, recorded in
//             public._migrations, then the seed) while two students and the staffer keep using the API; reports
//             every request that failed, and when.
//   rollback  the release's own rollback: 56, 55, 50 and 49, each in one transaction with the removal of its
//             _migrations row. Buzz's 51 to 54 are not touched; every Buzz object and row is compared before and after.
//   restore   every release migration rolled back (production's state again); the catalog is compared with baseline's.
//   cleanup   deletes every account, file and row the rehearsal made; row counts are compared with baseline's.
// `apply` after `rollback` re-applies the business migrations only.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { catalog, diffCatalogs, isBuzz, BUZZ_DATA_SQL, DATA_HELPER_SQL, DROP_DATA_HELPER_SQL } from "../catalog.mjs";
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
  "20261105000000_anonymous_listings.sql",
  "20261107000000_business_teams.sql",
  "20261107000100_business_ads.sql",
  "20261108000000_buzz_reply_tree.sql",
  "20261108000100_buzz_top_reply.sql",
  "20261108000200_buzz_prompt_threads.sql",
  "20261108000300_buzz_categories.sql",
  "20261109000000_media_server_fields.sql",
  "20261109000100_business_hardening.sql",
];
const BUSINESS = ["20261107000000_business_teams.sql", "20261107000100_business_ads.sql", "20261109000000_media_server_fields.sql", "20261109000100_business_hardening.sql"];
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
async function session(u) {
  const c = createClient(URL_, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`${u.email}: ${error.message}`);
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
    await check("a new inquiry: the business sees neither the chat nor the student until the student writes", async () => {
      // A student who has never written to this business (a new one each run, so the check can run again).
      const key = `inq${Date.now().toString(36)}`;
      const dee = await account(key, `rh-${key}-${run}@txstate.edu`, { full_name: "Rh Dee" });
      await sql(`update public.profiles set university_id = ${lit(I.txstate)} where id = ${lit(dee.id)}`);
      const deeS = await session(dee);
      const chat = await must(deeS.rpc("start_business_inquiry", { p_target_type: "deal", p_target_id: I.deal }));
      expect((await must(staff.from("conversations").select("id").eq("id", chat))).length === 0, "the business sees the empty chat");
      expect((await must(owner.from("profiles").select("id").eq("id", dee.id))).length === 0, "the business sees the student");
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

// --- apply (what db:setup does, with traffic) ----------------------------------------------------------------------------
if (STEP === "apply") {
  const A = state.accounts, I = state.ids;
  const done = await applied();
  const pending = MIGRATIONS.filter((f) => !done.has(f));
  console.log(`  pending, in file order: ${pending.join(", ") || "none"}`);
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
  }
  for (const id of ids) { const { error } = await admin.auth.admin.deleteUser(id); if (error) fail(`delete account ${id}`, error); }
  const s = state.baseline?.buzzSecrets;
  if (s) await sql(`update public.buzz_secrets set thread_jitter_seconds = ${s.thread_jitter_seconds}, reply_jitter_seconds = ${s.reply_jitter_seconds}, min_campus_size = ${s.min_campus_size} where id = 1`);
  await check("every table has baseline's row count again (nothing the rehearsal made is left)", async () => {
    const now = await counts();
    const off = Object.keys({ ...state.baseline.counts, ...now }).filter((t) => state.baseline.counts[t] !== now[t]).map((t) => `${t} ${state.baseline.counts[t]} -> ${now[t]}`);
    expect(off.length === 0, off.join(", "));
  });
}

console.log(`${failures ? "✗" : "✓"} ${STEP}: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
