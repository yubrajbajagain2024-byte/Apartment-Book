// Migration 52 (UniBuzz Business v2 hardening) against PGlite, one check per finding of the independent review of
// migrations 49 and 50: an approved ad shows what was reviewed, and pauses when what it promotes (or the business's
// category) changes; every ad's words are screened; video ads wait for migration 51; ad photos are this project's
// uploads; a business sees a chat and the student in it only once the student wrote, and a block stops the chat both
// ways; dates are the database's; the foreign-key exception and the payment ledger hold; events count once and only
// for the targeted campus; saved ads respect takedowns; the reviewer stays unnamed; repeated edits fold in the log;
// non-http links are dropped; and the rollback.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261107000300_business_hardening.sql";
const ROLLBACK = "rollbacks/20261107000300_business_hardening.down.sql";
const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

const { db, mk, as } = await boot();
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const signUp = async (email, meta) => (await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify(meta)])).rows[0].id;
const confirm = (id) => db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
const admin = await mk("ann@txstate.edu", "Ann Avery");
await db.query("select public.grant_role($1, 'admin')", [admin]);
const ben = await mk("ben@txstate.edu", "Ben Brooks");
const uma = await mk("uma@txstate.edu", "Uma Utsa");
const txstate = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const utsa = (await one(db.query("select id from public.universities where name = 'University of Texas at San Antonio'"))).id;
await db.query("update public.profiles set university_id = $2 where id = $1", [uma, utsa]);
const business = async (email, name, category) => {
  const owner = await signUp(email, { account_type: "business", full_name: `${name} Owner`, business_name: name, business_category: category, business_university_id: txstate });
  await confirm(owner);
  const id = (await one(db.query("select id from public.businesses where owner_id = $1", [owner]))).id;
  await as(admin, () => db.query("select public.admin_review_business($1, 'approved', null)", [id]));
  return [owner, id];
};
const [cafeOwner, cafe] = await business("hi@cafe.example", "Bean There", "food");
const [rentOwner, rent] = await business("hi@rent.example", "River Rock", "housing");
const upload = async (owner, name) => {
  await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2, $3)", [`posts/${owner}/${name}.jpg`, owner, owner]);
  return { type: "image", url: `https://proj.supabase.co/storage/v1/object/public/uploads/posts/${owner}/${name}.jpg` };
};
const LATTE = await upload(cafeOwner, "latte");
const AD = `insert into public.ads (business_id, created_by, name, placements, university_ids, caption, media, cta, cta_url, promoted_deal_id, promoted_apartment_id, budget_cents, starts_at, ends_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 5000, $12, $13) returning *`;
const draft = (owner, biz, f) => as(owner, () => one(db.query(AD, [biz, owner, f.name ?? "Ad", f.placements ?? ["for_you"], [txstate], f.caption ?? "Come by.", JSON.stringify(f.media ?? []), f.cta ?? "visit_profile", f.ctaUrl ?? null, f.deal ?? null, f.apt ?? null, f.starts ?? hours(-1), f.ends ?? hours(48)])));
const submit = (owner, id) => as(owner, () => db.query("select public.ad_submit($1)", [id]));
const approve = (id, o = {}) => as(admin, () => one(db.query("select (public.admin_approve_ad($1, 5000, 'USD', 'INV-1', $2, $3)).status", [id, o.note ?? null, o.fh ?? false])));
const feed = (who, placement) => as(who, () => rows(db.query("select * from public.ads_for_feed($1, 10, 0)", [placement])));
const ad = (id) => one(db.query("select * from public.ads where id = $1", [id]));

// --- What students see is what was reviewed ---------------------------------------------------------------------------
let postAd, post;
await expectOk("an approved ad shows the reviewed copy of its post", async () => {
  post = (await as(cafeOwner, () => one(db.query("insert into public.deals (business_id, created_by, title, media) values ($1, $2, 'Latte week', $3) returning id", [cafe, cafeOwner, JSON.stringify([LATTE])])))).id;
  postAd = await draft(cafeOwner, cafe, { name: "Promo", deal: post, cta: "get_offer" });
  await submit(cafeOwner, postAd.id);
  await approve(postAd.id);
  const f = await feed(ben, "for_you");
  if (f[0]?.promoted?.title !== "Latte week") throw new Error(JSON.stringify(f[0]?.promoted));
});
await expectOk("the business rewrites the post after approval: the ad pauses for the UniBuzz team, and is gone from the feed", async () => {
  await as(cafeOwner, () => db.query("update public.deals set title = 'Verify your student login to win', link_url = 'https://phish.example' where id = $1", [post]));
  const a = await ad(postAd.id);
  if (a.status !== "paused" || a.paused_by !== "admin" || !a.status_reason.includes("changed")) throw new Error(JSON.stringify(a));
  if ((await feed(ben, "for_you")).length !== 0) throw new Error("still served");
  const resume = await as(cafeOwner, () => db.query("select public.ad_resume($1)", [postAd.id])).then(() => "resumed", (e) => e.message);
  if (!resume.includes("UniBuzz team paused")) throw new Error(resume);
});
await expectOk("the UniBuzz team looks again and resumes it: students now see the new copy it reviewed", async () => {
  await as(admin, () => db.query("select public.admin_resume_ad($1)", [postAd.id]));
  const f = await feed(ben, "for_you");
  if (f[0]?.promoted?.title !== "Verify your student login to win") throw new Error(JSON.stringify(f[0]?.promoted));
});
let listing, housingAd;
await expectOk("a promoted listing renamed to discriminatory words pauses its ad, and the ad's flags say so", async () => {
  listing = (await as(rentOwner, () => one(db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id) values ($1, $2, 'Two-bed', 'Pool and gym', 1200, '1 River Rd', $3) returning id", [rentOwner, rent, txstate])))).id;
  housingAd = await draft(rentOwner, rent, { name: "Leasing", apt: listing, cta: "view_listing" });
  await submit(rentOwner, housingAd.id);
  await approve(housingAd.id, { fh: true });
  await as(rentOwner, () => db.query("update public.apartments set title = 'Adults only, no kids' where id = $1", [listing]));
  const a = await ad(housingAd.id);
  if (a.status !== "paused" || !a.fair_housing_flags.join().includes("adults only")) throw new Error(JSON.stringify(a));
  if ((await feed(ben, "housing")).length !== 0) throw new Error("still served");
});

// --- Fair Housing whatever the category ---------------------------------------------------------------------------------
await expectOk("a business that leaves 'housing' for another category gets flagged words screened anyway, and needs the check and a note", async () => {
  const [svcOwner, svc] = await business("hi@svc.example", "Quick Rentals", "housing");
  await as(svcOwner, () => db.query("update public.businesses set category = 'services' where id = $1", [svc]));
  const photo = await upload(svcOwner, "rooms");
  const a = await draft(svcOwner, svc, { name: "Rooms", caption: "Apartments for rent. Adults only, no kids.", media: [photo], cta: "visit_profile" });
  if (!a.fair_housing_flags.length) throw new Error("not screened");
  await submit(svcOwner, a.id);
  const refused = await approve(a.id).then(() => "approved", (e) => e.message);
  if (!refused.includes("Fair Housing")) throw new Error(refused);
  const noNote = await approve(a.id, { fh: true }).then(() => "approved", (e) => e.message);
  if (!noNote.includes("flagged")) throw new Error(noNote);
});
await expectOk("switching category while ads run pauses them for the UniBuzz team", async () => {
  const fresh = await draft(cafeOwner, cafe, { name: "Muffins", media: [LATTE], cta: "visit_profile" });
  await submit(cafeOwner, fresh.id);
  await approve(fresh.id);
  await as(cafeOwner, () => db.query("update public.businesses set category = 'housing' where id = $1", [cafe]));
  if ((await ad(fresh.id)).status !== "paused") throw new Error("still running");
  await as(cafeOwner, () => db.query("update public.businesses set category = 'food' where id = $1", [cafe]));
});

// --- Video ads wait for migration 51 ---------------------------------------------------------------------------------------
await expectOk("without migration 51's guard, a video ad cannot be approved; with it, it can", async () => {
  const v = (await one(db.query("insert into public.media (owner_id, status, width, height, duration_seconds, playback_id) values ($1, 'ready', 1080, 1920, 20, 'pb-own') returning id", [cafeOwner]))).id;
  const a = await draft(cafeOwner, cafe, { name: "Reel", placements: ["reels"], media: [{ type: "video", media_id: v }], cta: "visit_profile" });
  await submit(cafeOwner, a.id);
  await db.exec("alter table public.media disable trigger media_server_fields; drop trigger media_server_fields on public.media");
  const refused = await approve(a.id).then(() => "approved", (e) => e.message);
  await db.exec(read("migrations/20261107000200_media_server_fields.sql"));
  if (!refused.includes("migration 51")) throw new Error(refused);
  if ((await approve(a.id)).status !== "active") throw new Error("not approved with the guard");
});

// --- Photos ---------------------------------------------------------------------------------------------------------------
await expectError("an ad's photo on another host, even with storage's path, is refused", () => draft(cafeOwner, cafe, { media: [{ type: "image", url: LATTE.url.replace("proj.supabase.co", "tracker.example") }] }), "Upload photos to UniBuzz");
await expectError("and so is a storage path nobody on the team uploaded", () => draft(cafeOwner, cafe, { media: [{ type: "image", url: "https://proj.supabase.co/storage/v1/object/public/uploads/posts/x/y.jpg" }] }), "Upload photos to UniBuzz");

// --- Chats ----------------------------------------------------------------------------------------------------------------
let chat;
await expectOk("the student taps Message: the business sees neither the chat nor the student until the student writes", async () => {
  chat = (await as(ben, () => one(db.query("select public.start_business_inquiry('business', $1) as id", [cafe])))).id;
  const c = await as(cafeOwner, () => rows(db.query("select id from public.conversations where id = $1", [chat])));
  const p = await as(cafeOwner, () => rows(db.query("select id from public.profiles where id = $1", [ben])));
  if (c.length || p.length) throw new Error(JSON.stringify({ c, p }));
  await as(ben, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Hi!')", [chat, ben]));
  const c2 = await as(cafeOwner, () => rows(db.query("select id from public.conversations where id = $1", [chat])));
  const p2 = await as(cafeOwner, () => rows(db.query("select id from public.profiles where id = $1", [ben])));
  if (c2.length !== 1 || p2.length !== 1) throw new Error("not visible after the student wrote");
});
await expectOk("the student blocks the business: the business cannot reply, nor the student write, until unblocked", async () => {
  await as(ben, () => db.query("select public.set_business_blocked($1, true)", [cafe]));
  const biz = await as(cafeOwner, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Still there?')", [chat, cafeOwner])).then(() => "sent", (e) => e.message);
  const stu = await as(ben, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Hello')", [chat, ben])).then(() => "sent", (e) => e.message);
  if (!biz.includes("not taking messages") || !stu.includes("You blocked this business")) throw new Error(`${biz} / ${stu}`);
  await as(ben, () => db.query("select public.set_business_blocked($1, false)", [cafe]));
  await as(cafeOwner, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Welcome back')", [chat, cafeOwner]));
});

// --- Dates, the foreign-key exception, the ledger ---------------------------------------------------------------------
await expectOk("a post dated by the client gets the database's date (the daily count and the order read it)", async () => {
  const d = await as(cafeOwner, () => one(db.query("insert into public.deals (business_id, created_by, title, created_at) values ($1, $2, 'Old', '2001-01-01') returning created_at", [cafe, cafeOwner])));
  if (new Date(d.created_at).getFullYear() < 2026) throw new Error(String(d.created_at));
  const a = await as(cafeOwner, () => one(db.query("insert into public.ads (business_id, created_by, name, created_at) values ($1, $2, 'Dated', '2099-01-01') returning created_at", [cafe, cafeOwner])));
  if (new Date(a.created_at).getFullYear() > 2027) throw new Error(String(a.created_at));
});
await expectError("clearing the reviewer on a running ad is an edit, refused", () => as(cafeOwner, () => db.query("update public.ads set reviewed_by = null, fair_housing_checked_by = null where id = $1", [postAd.id])), "Only a draft or a rejected ad");
await expectOk("deleting a promoted post keeps its payment on record", async () => {
  await as(cafeOwner, () => db.query("delete from public.deals where id = $1", [post]));
  const pay = await one(db.query("select deal_id, ad_id, status from public.listing_promotions where ad_id = $1", [postAd.id]));
  if (!pay || pay.deal_id !== null || pay.status !== "active") throw new Error(JSON.stringify(pay));
});

// --- Events -----------------------------------------------------------------------------------------------------------------
await expectOk("an ad's impression counts once per student per hour, whatever post or listing is sent beside it, and only on its campus", async () => {
  const live = await draft(cafeOwner, cafe, { name: "Count me", media: [LATTE], cta: "visit_profile" });
  await submit(cafeOwner, live.id);
  await approve(live.id);
  for (let i = 0; i < 5; i++) {
    const other = (await as(cafeOwner, () => one(db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, $3) returning id", [cafe, cafeOwner, `Noise ${i}`])))).id;
    await as(ben, () => db.query("select public.record_business_event('impression', null, $1, $2, null, 'for_you')", [live.id, other]));
  }
  await as(uma, () => db.query("select public.record_business_event('impression', null, $1, null, null, 'for_you')", [live.id]));
  const s = await as(cafeOwner, () => one(db.query("select impressions, reach from public.business_ad_stats($1) where ad_id = $2", [cafe, live.id])));
  if (Number(s.impressions) !== 1 || Number(s.reach) !== 1) throw new Error(JSON.stringify(s));
});

// --- Saved ads, the reviewer, the log, links -------------------------------------------------------------------------------
await expectOk("a saved ad the UniBuzz team pauses leaves the student's saved ads", async () => {
  const live = await draft(cafeOwner, cafe, { name: "Saved", media: [LATTE], cta: "visit_profile" });
  await submit(cafeOwner, live.id);
  await approve(live.id);
  await as(ben, () => db.query("select public.save_ad($1, true)", [live.id]));
  await as(admin, () => db.query("select public.admin_pause_ad($1, 'Checking a complaint.')", [live.id]));
  const saved = await as(ben, () => rows(db.query("select id from public.my_saved_ads() where id = $1", [live.id])));
  if (saved.length) throw new Error("still listed");
});
await expectOk("a business reads the UniBuzz team's actions without the reviewer's id, and its notifications carry no actor", async () => {
  const log = await as(cafeOwner, () => rows(db.query("select actor_id, actor_name from public.business_audit($1) where actor_kind = 'admin'", [cafe])));
  if (!log.length || log.some((l) => l.actor_id !== null || l.actor_name !== "UniBuzz team")) throw new Error(JSON.stringify(log.slice(0, 2)));
  const n = await as(cafeOwner, () => rows(db.query("select actor_id from public.notifications where type in ('business', 'ad')")));
  if (!n.length || n.some((x) => x.actor_id !== null)) throw new Error(JSON.stringify(n.slice(0, 2)));
});
await expectOk("twenty quick profile edits make one log entry", async () => {
  const before = Number((await one(db.query("select count(*) from public.business_audit_log where business_id = $1 and action = 'profile_updated'", [cafe]))).count);
  for (let i = 0; i < 20; i++) await as(cafeOwner, () => db.query("update public.businesses set description = $2 where id = $1", [cafe, `Edit ${i}`]));
  const after = Number((await one(db.query("select count(*) from public.business_audit_log where business_id = $1 and action = 'profile_updated'", [cafe]))).count);
  if (after - before > 1) throw new Error(`${after - before} entries`);
});
await expectOk("a website or a post link that is not http(s) is dropped", async () => {
  await as(cafeOwner, () => db.query("update public.businesses set website = 'javascript:alert(1)' where id = $1", [cafe]));
  const d = await as(cafeOwner, () => one(db.query("insert into public.deals (business_id, created_by, title, link_url) values ($1, $2, 'Link', 'itms-services://x') returning link_url", [cafe, cafeOwner])));
  const b = await one(db.query("select website from public.businesses where id = $1", [cafe]));
  if (b.website !== null || d.link_url !== null) throw new Error(JSON.stringify({ b, d }));
});

// --- Rollback ---------------------------------------------------------------------------------------------------------------
await expectOk("the migration re-runs cleanly; the rollback puts 50's serving back (live content) and re-applying works", async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read(ROLLBACK));
  if ((await one(db.query("select to_regprocedure('public.storage_upload_url_ok(text, uuid[])') is not null as ok"))).ok) throw new Error("helper left");
  if ((await one(db.query("select count(*)::int as n from information_schema.columns where table_name = 'ads' and column_name = 'promoted_snapshot'"))).n) throw new Error("column left");
  await db.exec(read(MIGRATION));
});

done("MIGRATION-52 BUSINESS HARDENING");
