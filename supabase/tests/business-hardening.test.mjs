// Migration 56 (UniBuzz Business v2 hardening) against PGlite, one check per finding of the independent review of
// migrations 49 and 50: an approved ad shows what was reviewed, and pauses when what it promotes (or the business's
// category) changes; every ad's words are screened; video ads wait for migration 55; ad photos are this project's
// uploads; a business sees a chat and the student in it only once the student wrote, and a block stops the chat both
// ways; dates are the database's; the foreign-key exception and the payment ledger hold; events count once and only
// for the targeted campus; saved ads respect takedowns; the reviewer stays unnamed; repeated edits fold in the log;
// non-http links are dropped; and the rollback.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261109000100_business_hardening.sql";
const ROLLBACK = "rollbacks/20261109000100_business_hardening.down.sql";
const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

const { db, mk, as, reopen } = await boot();
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

// --- A new connection: the ad trigger's checks run there too ---------------------------------------------------------------
// Every API request may come on a connection that has never seen an ad change status (staging, 2026-10-28). Migration 50's
// own data step leaves the transition setting defined in this test session, so the check runs on a reopened one.
await expectOk("on a new connection, a business's ad still starts as a draft, unreviewed and unpaid, and its photos are checked", async () => {
  const c = await reopen();
  const row = await c.as(cafeOwner, async () => (await c.db.query(`insert into public.ads (business_id, created_by, name, placements, university_ids, caption, media, cta, budget_cents, status, reviewed_by, reviewed_at, promoted_snapshot)
    values ($1, $2, 'Self-approved', '{for_you}', $3, 'Come by.', $4, 'visit_profile', 0, 'active', $5, now(), '{}') returning status, reviewed_by, reviewed_at, promoted_snapshot`, [cafe, cafeOwner, [txstate], JSON.stringify([LATTE]), admin])).rows[0]);
  if (row.status !== "draft" || row.reviewed_by || row.reviewed_at || row.promoted_snapshot) throw new Error(JSON.stringify(row));
  let refused = false;
  try {
    await c.as(cafeOwner, () => c.db.query("insert into public.ads (business_id, created_by, name, placements, university_ids, caption, media, cta, budget_cents) values ($1, $2, 'Linked', '{for_you}', $3, 'x', $4, 'visit_profile', 0)", [cafe, cafeOwner, [txstate], JSON.stringify([{ type: "image", url: "https://tracker.example/storage/v1/object/public/uploads/x.jpg" }])]));
  } catch (e) { refused = /Upload photos/.test(e.message); }
  await c.db.close();
  if (!refused) throw new Error("a linked photo was accepted");
});

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

// --- Video ads wait for migration 55 ---------------------------------------------------------------------------------------
await expectOk("without migration 55's guard, a video ad cannot be approved; with it, it can", async () => {
  const v = (await one(db.query("insert into public.media (owner_id, status, width, height, duration_seconds, playback_id) values ($1, 'ready', 1080, 1920, 20, 'pb-own') returning id", [cafeOwner]))).id;
  const a = await draft(cafeOwner, cafe, { name: "Reel", placements: ["reels"], media: [{ type: "video", media_id: v }], cta: "visit_profile" });
  await submit(cafeOwner, a.id);
  await db.exec("alter table public.media disable trigger media_server_fields; drop trigger media_server_fields on public.media");
  const refused = await approve(a.id).then(() => "approved", (e) => e.message);
  await db.exec(read("migrations/20261109000000_media_server_fields.sql"));
  if (!refused.includes("migration 55")) throw new Error(refused);
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

// --- The second independent review (2026-10-28), on new connections ---------------------------------------------------------
const approved = async (owner, biz, fields, o = {}) => {
  const a = await draft(owner, biz, fields);
  await submit(owner, a.id);
  await approve(a.id, o);
  return a.id;
};
const fails = (p) => p.then(() => "allowed", (e) => e.message);
const [gymOwner, gym] = await business("hi@gym.example", "Lift Gym", "fitness");
const PUMP = await upload(gymOwner, "pump");
await db.query("update public.profiles set university_id = $2 where id = $1", [ben, txstate]);

await expectOk("an approved video ad keeps the video that was reviewed: a video's id cannot be taken or changed, and status changes do not re-read it", async () => {
  const c = await reopen();
  const mine = async (playback) => {
    const id = (await c.as(gymOwner, () => c.db.query("insert into public.media (owner_id, provider) values ($1, 'mux') returning id", [gymOwner]))).rows[0].id;
    await c.db.query("update public.media set status = 'ready', playback_id = $2, width = 1080, height = 1920, duration_seconds = 20 where id = $1", [id, playback]);
    return id;
  };
  const m1 = await mine("pb-reviewed");
  const a = (await c.as(gymOwner, () => c.db.query(AD, [gym, gymOwner, "Video", ["for_you"], [txstate], "Come lift.", JSON.stringify([{ type: "video", media_id: m1 }]), "visit_profile", null, null, null, hours(-1), hours(48)]))).rows[0];
  await c.as(gymOwner, () => c.db.query("select public.ad_submit($1)", [a.id]));
  await c.as(admin, () => c.db.query("select public.admin_approve_ad($1, 5000, 'USD', 'INV-V', null, false)", [a.id]));
  const m2 = await mine("pb-unreviewed");
  await c.as(gymOwner, () => c.db.query("delete from public.media where id = $1", [m1]));
  await c.as(gymOwner, () => c.db.query("update public.media set id = $1 where id = $2", [m1, m2]));
  if ((await c.db.query("select 1 from public.media where id = $1", [m1])).rows.length) throw new Error("a video took the reviewed video's id");
  await c.as(gymOwner, () => c.db.query("select public.ad_pause($1)", [a.id]));
  await c.as(gymOwner, () => c.db.query("select public.ad_resume($1)", [a.id]));
  const served = (await c.db.query("select media from public.ads where id = $1", [a.id])).rows[0].media[0];
  await c.db.close();
  if (served.playback_id !== "pb-reviewed") throw new Error(JSON.stringify(served));
});

let gymAd;
await expectOk("a photo a live ad shows cannot be replaced or deleted by its uploader; once the ad ends, it can", async () => {
  gymAd = await approved(gymOwner, gym, { name: "Pump", media: [PUMP] });
  const path = `posts/${gymOwner}/pump.jpg`;
  const c = await reopen();
  const upd = await c.as(gymOwner, () => c.db.query("update storage.objects set owner_id = owner_id where bucket_id = 'uploads' and name = $1", [path]));
  const del = await c.as(gymOwner, () => c.db.query("delete from storage.objects where bucket_id = 'uploads' and name = $1", [path]));
  if (upd.affectedRows !== 0 || del.affectedRows !== 0) throw new Error(`update ${upd.affectedRows}, delete ${del.affectedRows}`);
  const other = await c.as(gymOwner, () => c.db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2, $3)", [`posts/${gymOwner}/spare.jpg`, gymOwner, gymOwner]));
  const delOther = await c.as(gymOwner, () => c.db.query("delete from storage.objects where bucket_id = 'uploads' and name = $1", [`posts/${gymOwner}/spare.jpg`]));
  if (other.affectedRows !== 1 || delOther.affectedRows !== 1) throw new Error("its other files are locked too");
  await c.db.close();
});

await expectOk("pausing first does not skip the review: an edit while the business has it paused hands it to the UniBuzz team", async () => {
  const deal = (await as(gymOwner, () => one(db.query("insert into public.deals (business_id, created_by, title, media) values ($1, $2, 'Free week', $3) returning id", [gym, gymOwner, JSON.stringify([PUMP])])))).id;
  const id = await approved(gymOwner, gym, { name: "Free week", deal, cta: "get_offer" });
  await as(gymOwner, () => db.query("select public.ad_pause($1)", [id]));
  await as(gymOwner, () => db.query("update public.deals set title = 'Verify your student login', link_url = 'https://phish.example' where id = $1", [deal]));
  const a = await ad(id);
  if (a.status !== "paused" || a.paused_by !== "admin") throw new Error(JSON.stringify(a));
  if (!(await fails(as(gymOwner, () => db.query("select public.ad_resume($1)", [id])))).includes("UniBuzz team paused")) throw new Error("the business resumed it");
});

await expectOk("an ad waiting for review goes back to draft when its post changes, so the team approves what it was sent", async () => {
  const deal = (await as(gymOwner, () => one(db.query("insert into public.deals (business_id, created_by, title, media) values ($1, $2, 'Spin class', $3) returning id", [gym, gymOwner, JSON.stringify([PUMP])])))).id;
  const a = await draft(gymOwner, gym, { name: "Spin", deal, cta: "get_offer" });
  await submit(gymOwner, a.id);
  await as(gymOwner, () => db.query("update public.deals set description = 'Changed after submitting' where id = $1", [deal]));
  const now = await ad(a.id);
  if (now.status !== "draft" || !now.status_reason) throw new Error(JSON.stringify(now));
});

await expectOk("a category switch makes a general ad unresumable as it is: the team's resume refuses a housing ad it never approved", async () => {
  const id = await approved(gymOwner, gym, { name: "Classes", media: [PUMP] });
  await as(gymOwner, () => db.query("select public.ad_pause($1)", [id]));
  await as(gymOwner, () => db.query("update public.businesses set category = 'housing' where id = $1", [gym]));
  const refused = await fails(as(admin, () => db.query("select public.admin_resume_ad($1)", [id])));
  await as(gymOwner, () => db.query("update public.businesses set category = 'fitness' where id = $1", [gym]));
  if (!refused.includes("housing")) throw new Error(refused);
  await as(admin, () => db.query("select public.admin_resume_ad($1)", [id]));
  if (!["active", "scheduled"].includes((await ad(id)).status)) throw new Error("not resumed once it is what was approved again");
});

await expectOk("new Fair Housing words make an ad unresumable as it is; any change to a promoted listing pauses its ad", async () => {
  const apt = (await as(rentOwner, () => one(db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id) values ($1, $2, 'Studio', 'Bright', 900, '3 River Rd', $3) returning id", [rentOwner, rent, txstate])))).id;
  const id = await approved(rentOwner, rent, { name: "Studio", apt, cta: "view_listing" }, { fh: true });
  await as(rentOwner, () => db.query("update public.apartments set amenities = '{\"Adults only\"}', map_url = 'https://phish.example' where id = $1", [apt]));
  if ((await ad(id)).paused_by !== "admin") throw new Error("amenities and map edits did not pause it");
  const refused = await fails(as(admin, () => db.query("select public.admin_resume_ad($1)", [id])));
  if (!refused.includes("Fair Housing")) throw new Error(refused);
});

await expectOk("when its promoted post is removed, the ad stops and cannot be resumed", async () => {
  const deal = (await as(gymOwner, () => one(db.query("insert into public.deals (business_id, created_by, title, media) values ($1, $2, 'Scam deal', $3) returning id", [gym, gymOwner, JSON.stringify([PUMP])])))).id;
  const id = await approved(gymOwner, gym, { name: "Gone", deal, cta: "get_offer" });
  await db.query("delete from public.deals where id = $1", [deal]);
  const a = await ad(id);
  if (a.status !== "paused" || a.paused_by !== "admin") throw new Error(JSON.stringify(a));
  if ((await feed(ben, "for_you")).some((x) => x.id === id)) throw new Error("still served");
  if (!(await fails(as(admin, () => db.query("select public.admin_resume_ad($1)", [id])))).includes("removed")) throw new Error("resumed");
});

await expectOk("a saved ad the UniBuzz team took down stays gone once the business ends it", async () => {
  await as(ben, () => db.query("select public.save_ad($1, true)", [gymAd]));
  await as(admin, () => db.query("select public.admin_pause_ad($1, 'Takedown')", [gymAd]));
  await as(gymOwner, () => db.query("select public.ad_end($1)", [gymAd]));
  if ((await as(ben, () => rows(db.query("select * from public.my_saved_ads()")))).some((s) => s.id === gymAd)) throw new Error("back in saved ads");
});

await expectOk("an ad shows the business's logo only when it is the team's own upload, and a new logo goes past the team", async () => {
  await db.query("update public.businesses set logo_url = 'http://tracker.example/px.gif' where id = $1", [gym]);
  const id = await approved(gymOwner, gym, { name: "Logo", media: [PUMP] });
  const logo = async () => (await feed(ben, "for_you")).find((x) => x.id === id)?.business_logo_url;
  const tracker = await logo();
  // A new logo pauses the business's ads for the team (it shows on every ad); once resumed, the team's upload shows.
  await db.query("update public.businesses set logo_url = $2 where id = $1", [gym, PUMP.url]);
  if ((await ad(id)).paused_by !== "admin") throw new Error("a new logo did not pause the ad");
  await as(admin, () => db.query("select public.admin_resume_ad($1)", [id]));
  const own = await logo();
  if (tracker !== null || own !== PUMP.url) throw new Error(JSON.stringify({ tracker, own }));
});

await expectOk("payments stay on record when the owner deletes their account (business and ads go)", async () => {
  const [byeOwner, bye] = await business("hi@bye.example", "Bye Bikes", "retail");
  const photo = await upload(byeOwner, "bike");
  const a = await draft(byeOwner, bye, { name: "Bikes", media: [photo] });
  await submit(byeOwner, a.id);
  await as(admin, () => db.query("select public.admin_approve_ad($1, 7000, 'USD', 'INV-BYE', null, false)", [a.id]));
  await as(byeOwner, () => db.query("select public.delete_my_account()"));
  const p = await one(db.query("select count(*)::int as n, bool_and(business_id is null and ad_id is null) as orphaned, max(amount_cents) as amount from public.listing_promotions where payment_reference = 'INV-BYE'"));
  if (p.n !== 1 || !p.orphaned || p.amount !== 7000) throw new Error(JSON.stringify(p));
  await db.query("delete from public.listing_promotions where payment_reference = 'INV-BYE'"); // the rollback below refuses while it exists
});

// --- Rollback ---------------------------------------------------------------------------------------------------------------
await expectOk("the migration re-runs cleanly; the rollback puts 50's serving back (live content) and re-applying works", async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read(ROLLBACK));
  if ((await one(db.query("select to_regprocedure('public.storage_upload_url_ok(text, uuid[])') is not null as ok"))).ok) throw new Error("helper left");
  if ((await one(db.query("select count(*)::int as n from information_schema.columns where table_name = 'ads' and column_name = 'promoted_snapshot'"))).n) throw new Error("column left");
  await db.exec(read(MIGRATION));
});

done("MIGRATION-56 BUSINESS HARDENING");
