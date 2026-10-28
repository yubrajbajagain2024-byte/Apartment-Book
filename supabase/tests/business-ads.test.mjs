// Migration 50 (UniBuzz Business v2: posts, the Ads Manager and what students see of it) against PGlite: v1's paid
// promotions become ads; posts with photos, a video and a price; ad drafts and who may write them; placement rules
// (housing ads only in Housing, Reels only with a vertical video); Fair Housing flags; submission, review and payment;
// ads starting and ending on time (with and without the sweep); campus-only serving to signed-in students; hide,
// report and block; events counted once and read only as numbers; "Sponsored" only while a paid ad runs; rate limits;
// and the rollback's refusal.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const TEAMS = "migrations/20261107000000_business_teams.sql";
const MIGRATION = "migrations/20261107000100_business_ads.sql";
const ROLLBACK = "rollbacks/20261107000100_business_ads.down.sql";
const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const photo = (name) => ({ type: "image", url: `https://proj.supabase.co/storage/v1/object/public/uploads/apartments/x/${name}.jpg` });

function helpers(db, as) {
  const one = async (p) => (await p).rows[0];
  const rows = async (p) => (await p).rows;
  const signUp = async (email, meta) => (await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify(meta)])).rows[0].id;
  const confirm = (id) => db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
  const review = (admin, business, decision) => as(admin, () => db.query("select public.admin_review_business($1, $2, null)", [business, decision]));
  /** A business owner, confirmed and (unless asked) approved: [owner id, business id]. */
  const business = async (admin, email, name, category, campus) => {
    const owner = await signUp(email, { account_type: "business", full_name: `${name} Owner`, business_name: name, business_category: category, business_university_id: campus });
    await confirm(owner);
    const id = (await one(db.query("select id from public.businesses where owner_id = $1", [owner]))).id;
    await review(admin, id, "approved");
    return [owner, id];
  };
  return { one, rows, signUp, confirm, review, business };
}

// --- v1's promotions become ads -------------------------------------------------------------------------------------
await expectOk("on a database with v1's promotions: running, future and cancelled ones become active, scheduled and completed ads, their payments linked, Sponsored unchanged", async () => {
  const { db, mk, as } = await boot({ upTo: "20261105000000_anonymous_listings.sql" });
  const h = helpers(db, as);
  const admin = await mk("old.admin@txstate.edu", "Old Admin");
  await db.query("select public.grant_role($1, 'admin')", [admin]);
  const txstate = (await h.one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
  const [owner, biz] = await h.business(admin, "old@grill.example", "Old Grill", "food", txstate);
  const apt = (await as(owner, () => h.one(db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id) values ($1, $2, 'Loft', 'Above the grill', 900, '1 Main', $3) returning id", [owner, biz, txstate])))).id;
  const deal = (await as(owner, () => h.one(db.query("insert into public.deals (business_id, created_by, title, image_url) values ($1, $2, 'Taco Tuesday', 'https://cdn.example/taco.jpg') returning id", [biz, owner])))).id;
  const promote = (type, id, from, to, ref) => as(admin, () => h.one(db.query("select public.admin_record_promotion($1, $2, $3, $4, 5000, 'USD', $5) as id", [type, id, from, to, ref])));
  const running = (await promote("apartment", apt, hours(-24), hours(24), "INV-RUN")).id;
  const future = (await promote("apartment", apt, hours(48), hours(96), "INV-FUT")).id;
  const cancelled = (await promote("deal", deal, hours(-24), hours(24), "INV-CAN")).id;
  await as(admin, () => db.query("select public.admin_cancel_promotion($1)", [cancelled]));
  await db.exec(read(TEAMS));
  await db.exec(read(MIGRATION));
  const ads = await h.rows(db.query("select a.legacy_promotion_id, a.status, a.vertical, a.placements, a.university_ids, a.budget_cents, a.cta, p.ad_id = a.id as linked from public.ads a join public.listing_promotions p on p.id = a.legacy_promotion_id"));
  const by = Object.fromEntries(ads.map((a) => [a.legacy_promotion_id, a]));
  if (by[running]?.status !== "active" || by[future]?.status !== "scheduled" || by[cancelled]?.status !== "completed") throw new Error(JSON.stringify(ads));
  if (!ads.every((a) => a.linked) || by[running].vertical !== "housing" || by[running].placements.join() !== "housing" || by[running].cta !== "view_listing") throw new Error(JSON.stringify(by[running]));
  if (by[cancelled].vertical !== "general" || by[cancelled].placements.join() !== "for_you" || by[cancelled].university_ids.length !== 0) throw new Error(JSON.stringify(by[cancelled]));
  const s = await h.one(db.query("select public.listing_sponsored(a) as s from public.apartments a where id = $1", [apt]));
  if (!s.s) throw new Error("the running promotion stopped making the listing Sponsored");
  const media = await h.one(db.query("select media, image_url from public.deals where id = $1", [deal]));
  if (media.media[0]?.url !== "https://cdn.example/taco.jpg" || media.image_url !== "https://cdn.example/taco.jpg") throw new Error(JSON.stringify(media));
  await db.exec(read(MIGRATION));
  if ((await h.rows(db.query("select id from public.ads"))).length !== 3) throw new Error("re-running duplicated the ads");
  await db.close();
});

// --- The main database --------------------------------------------------------------------------------------------
const { db, mk, as, asAnon } = await boot();
const { one, rows, signUp, confirm, review, business } = helpers(db, as);
const admin = await mk("ann@txstate.edu", "Ann Avery");
await db.query("select public.grant_role($1, 'admin')", [admin]);
const ben = await mk("ben@txstate.edu", "Ben Brooks");
const cat = await mk("cat@txstate.edu", "Cat Cruz");
const uma = await mk("uma@txstate.edu", "Uma Utsa");
const txstate = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const utsa = (await one(db.query("select id from public.universities where name = 'University of Texas at San Antonio'"))).id;
await db.query("update public.profiles set university_id = $2 where id = $1", [uma, utsa]);

const [cafeOwner, cafe] = await business(admin, "hi@beanthere.example", "Bean There", "food", txstate);
const [rentOwner, rent] = await business(admin, "hi@riverrock.example", "River Rock", "housing", txstate);
const invite = async (by, email, role) => {
  const inv = await as(by, () => one(db.query("select * from public.business_invite_create($1, $2)", [email, role])));
  const id = await signUp(email, { account_type: "business", full_name: email.split("@")[0], business_invite: inv.token });
  await confirm(id);
  return id;
};
const cafeEditor = await invite(cafeOwner, "ed@beanthere.example", "editor");
/** A photo the person really uploaded to this project's storage (migration 56 holds ad photos to those). */
const upload = async (owner, name) => {
  await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2, $3)", [`posts/${owner}/${name}.jpg`, owner, owner]);
  return { type: "image", url: `https://proj.supabase.co/storage/v1/object/public/uploads/posts/${owner}/${name}.jpg` };
};
const LATTE = await upload(cafeOwner, "latte");
const cafeAnalyst = await invite(cafeOwner, "al@beanthere.example", "analyst");
/** A video the business uploaded (as Mux would leave it): ready unless said otherwise. */
const video = async (owner, width, height, opts = {}) =>
  (await one(db.query("insert into public.media (owner_id, status, width, height, duration_seconds, playback_id, poster_url) values ($1, $2, $3, $4, $5, 'pb-' || gen_random_uuid(), 'https://image.mux.com/x/thumbnail.jpg') returning id", [owner, opts.status ?? "ready", width, height, opts.seconds ?? 20]))).id;
const AD_INSERT = `insert into public.ads (business_id, created_by, name, objective, placements, university_ids, headline, caption, media, cta, cta_url,
    promoted_deal_id, promoted_apartment_id, budget_cents, starts_at, ends_at, status)
  select r.business_id, r.created_by, r.name, coalesce(r.objective, 'awareness'), coalesce(r.placements, '{for_you}'), coalesce(r.university_ids, '{}'),
    r.headline, coalesce(r.caption, ''), coalesce(r.media, '[]'), coalesce(r.cta, 'learn_more'), r.cta_url, r.promoted_deal_id, r.promoted_apartment_id,
    coalesce(r.budget_cents, 0), r.starts_at, r.ends_at, coalesce(r.status, 'draft')
  from jsonb_populate_record(null::public.ads, $1::jsonb) r returning *`;
/** A complete For You ad of the café, starting in an hour unless said otherwise. */
const ready = (fields = {}) => ({
  business_id: cafe, created_by: cafeOwner, name: "Latte week", placements: ["for_you"], university_ids: [txstate], caption: "Half-price lattes for students.",
  media: [LATTE], cta: "order_now", cta_url: "https://beanthere.example/order", budget_cents: 5000, starts_at: hours(1), ends_at: hours(24 * 7), ...fields,
});
const draft = (who, fields) => as(who, () => one(db.query(AD_INSERT, [JSON.stringify({ created_by: who, ...fields })])));
const submit = (who, id) => as(who, () => one(db.query("select (public.ad_submit($1)).status", [id])));
const approve = (id, opts = {}) =>
  as(admin, () => one(db.query("select (public.admin_approve_ad($1, $2, 'USD', $3, $4, $5)).status", [id, opts.amount ?? 5000, opts.reference ?? "INV-1", opts.note ?? null, opts.fairHousing ?? false])));
const feed = (who, placement, limit = 10, offset = 0) => as(who, () => rows(db.query("select * from public.ads_for_feed($1, $2, $3)", [placement, limit, offset])));
const transition = async (sql, params) => {
  await db.query("select set_config('app.ad_transition', 'on', false)");
  try { return await db.query(sql, params); } finally { await db.query("select set_config('app.ad_transition', '', false)"); }
};

// --- Posts ----------------------------------------------------------------------------------------------------------
let post;
await expectOk("an editor publishes a product post with a price and two photos; image_url is the first photo", async () => {
  post = await as(cafeEditor, () => one(db.query("insert into public.deals (business_id, created_by, title, kind, price_cents, media, event_at) values ($1, $2, 'Cold brew', 'product', 450, $3, now()) returning id, image_url, event_at, currency", [cafe, cafeEditor, JSON.stringify([photo("brew1"), photo("brew2")])])));
  if (!post.image_url.endsWith("brew1.jpg") || post.event_at !== null || post.currency !== "USD") throw new Error(JSON.stringify(post));
});
await expectError("a post has one video at most", async () => {
  const v1 = await video(cafeEditor, 1080, 1920), v2 = await video(cafeEditor, 1080, 1920);
  await as(cafeEditor, () => db.query("insert into public.deals (business_id, created_by, title, media) values ($1, $2, 'Two videos', $3)", [cafe, cafeEditor, JSON.stringify([{ type: "video", media_id: v1 }, { type: "video", media_id: v2 }])]));
}, "one video at most");
await expectError("and photos or a video, not both", async () => {
  const v = await video(cafeEditor, 1080, 1920);
  await as(cafeEditor, () => db.query("insert into public.deals (business_id, created_by, title, media) values ($1, $2, 'Mixed', $3)", [cafe, cafeEditor, JSON.stringify([{ type: "video", media_id: v }, photo("x")])]));
}, "not both");
await expectError("a video someone outside the team uploaded is refused", async () => {
  const v = await video(ben, 1080, 1920);
  await as(cafeEditor, () => db.query("insert into public.deals (business_id, created_by, title, media) values ($1, $2, 'Borrowed', $3)", [cafe, cafeEditor, JSON.stringify([{ type: "video", media_id: v }])]));
}, "not your business");
await expectOk("a video post stores the provider's numbers, not the client's", async () => {
  const v = await video(cafeEditor, 1080, 1920);
  const r = await as(cafeEditor, () => one(db.query("insert into public.deals (business_id, created_by, title, kind, media) values ($1, $2, 'Barista tour', 'update', $3) returning media, image_url", [cafe, cafeEditor, JSON.stringify([{ type: "video", media_id: v, width: 4000, height: 10 }])])));
  if (r.media[0].width !== 1080 || r.media[0].height !== 1920 || !r.media[0].playback_id || r.image_url !== "https://image.mux.com/x/thumbnail.jpg") throw new Error(JSON.stringify(r));
});
await expectError("an analyst publishes nothing", () => as(cafeAnalyst, () => db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, 'No')", [cafe, cafeAnalyst])), "row-level security");

// --- Ad drafts ------------------------------------------------------------------------------------------------------
let ad;
await expectOk("an editor writes a draft; whatever status it sends, it is a draft", async () => {
  ad = await draft(cafeEditor, { ...ready(), created_by: cafeEditor, status: "active" });
  if (ad.status !== "draft" || ad.vertical !== "general") throw new Error(JSON.stringify(ad));
});
await expectError("an analyst cannot write ads", () => draft(cafeAnalyst, ready()), "row-level security");
await expectError("a student cannot either", () => draft(ben, ready()), "row-level security");
await expectError("a general ad cannot run in Housing", () => draft(cafeOwner, ready({ placements: ["for_you", "housing"] })), "Only housing ads run in Housing");
await expectError("an ad runs somewhere", () => draft(cafeOwner, ready({ placements: [] })), "Choose where the ad runs");
await expectError("a campus that does not exist is refused", () => draft(cafeOwner, ready({ university_ids: ["00000000-0000-0000-0000-000000000001"] })), "campuses does not exist");
await expectError("photos are uploaded to UniBuzz, not linked from elsewhere", () => draft(cafeOwner, ready({ media: [{ type: "image", url: "https://evil.example/x.jpg" }] })), "Upload photos to UniBuzz");
await expectError("nor from another host dressed as storage, nor a storage path nobody on the team uploaded", async () => {
  await draft(cafeOwner, ready({ media: [{ type: "image", url: LATTE.url.replace("proj.supabase.co", "tracker.example") }] })).catch(async (e) => {
    if (!e.message.includes("Upload photos to UniBuzz")) throw e;
    await draft(cafeOwner, ready({ media: [{ type: "image", url: "https://proj.supabase.co/storage/v1/object/public/uploads/posts/nobody/x.jpg" }] }));
  });
}, "Upload photos to UniBuzz");
await expectError("an ad promotes only the business's own posts", async () => {
  const other = (await as(rentOwner, () => one(db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, 'Rent deal') returning id", [rent, rentOwner])))).id;
  await draft(cafeOwner, ready({ promoted_deal_id: other }));
}, "only your own business's posts");
let housingAd, listing;
await expectOk("a housing business's ad is a housing ad, in Housing only, screened for Fair Housing wording", async () => {
  listing = (await as(rentOwner, () => one(db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id, images) values ($1, $2, 'Two-bed by the river', 'Pool and gym', 1200, '1 River Rd', $3, array['https://proj.supabase.co/storage/v1/object/public/uploads/apartments/r/1.jpg']) returning id", [rentOwner, rent, txstate])))).id;
  housingAd = await draft(rentOwner, ready({ business_id: rent, created_by: rentOwner, placements: ["for_you", "reels"], caption: "Perfect for singles. No kids, adults only.", media: [], cta: "view_listing", cta_url: null, promoted_apartment_id: listing }));
  if (housingAd.vertical !== "housing" || housingAd.placements.join() !== "housing") throw new Error(JSON.stringify(housingAd));
  const flags = housingAd.fair_housing_flags.join(" | ");
  if (!flags.includes('Familial status: "no kids"') || !flags.includes('Familial status: "adults only"') || !flags.includes('Familial status: "perfect for singles"')) throw new Error(flags);
});
await expectOk("the same words in a café's ad are screened too (migration 56: every ad, whatever the business's category)", async () => {
  const a = await draft(cafeOwner, ready({ caption: "Adults only open mic. No kids." }));
  if (a.fair_housing_flags.length === 0) throw new Error("not screened");
});
await expectOk("the screen catches each protected class and leaves ordinary words alone", async () => {
  const r = await one(db.query(`select public.fair_housing_flags('Christians only. English speakers only. No wheelchairs. Women only. No section 8.') as hit,
    public.fair_housing_flags('Two-bed near campus, pets welcome, walk to class, families welcome.') as clean`));
  const hit = r.hit.join(" | ");
  for (const k of ["Religion", "Race, color or national origin", "Disability", "Sex", "Source of income"]) if (!hit.includes(k)) throw new Error(`${k}: ${hit}`);
  if (r.clean.length) throw new Error(r.clean.join());
});

// --- Submission ---------------------------------------------------------------------------------------------------
await expectOk("what still stops a draft from being submitted, in the portal's words", async () => {
  const empty = await draft(cafeOwner, { business_id: cafe, name: "Empty", media: [], cta: "learn_more" });
  const p = (await as(cafeOwner, () => one(db.query("select public.ad_problems($1) as p", [empty.id])))).p;
  for (const want of ["Write a caption.", "Choose at least one campus.", "Choose a start date.", "Choose an end date.", "The budget is at least $10.", "Add the link the button opens.", "Add a photo or a video."]) {
    if (!p.includes(want)) throw new Error(`missing "${want}": ${p.join(" / ")}`);
  }
});
await expectError("an editor cannot submit (spending is for the owner and admins)", () => submit(cafeEditor, ad.id), "Only the owner or an admin");
await expectError("a draft with problems is refused with the first one", async () => {
  const bad = await draft(cafeOwner, ready({ ends_at: hours(24 * 120) }));
  await submit(cafeOwner, bad.id);
}, "90 days at most");
await expectOk("the owner submits a finished ad: waiting for review, and the UniBuzz team's admins are told once", async () => {
  if ((await submit(cafeOwner, ad.id)).status !== "pending_review") throw new Error("not pending");
  const n = await as(admin, () => rows(db.query("select title, link from public.notifications where type = 'business' and title = 'Ads waiting for review'")));
  if (n.length !== 1 || n[0].link !== "/business/admin/ads") throw new Error(JSON.stringify(n));
});
await expectError("an ad waiting for review cannot be edited", () => as(cafeOwner, () => db.query("update public.ads set caption = 'Changed' where id = $1", [ad.id])), "Only a draft or a rejected ad can be edited");
await expectOk("nor its status set by hand (a draft stays a draft)", async () => {
  const d = await draft(cafeOwner, ready({ name: "Sneaky" }));
  await as(cafeOwner, () => db.query("update public.ads set status = 'active', reviewed_by = $2 where id = $1", [d.id, cafeOwner]));
  const r = await one(db.query("select status, reviewed_by from public.ads where id = $1", [d.id]));
  if (r.status !== "draft" || r.reviewed_by !== null) throw new Error(JSON.stringify(r));
});
await expectOk("an editor takes a submitted ad back to draft; the owner submits it again", async () => {
  await as(cafeEditor, () => db.query("select public.ad_withdraw($1)", [ad.id]));
  if ((await one(db.query("select status from public.ads where id = $1", [ad.id]))).status !== "draft") throw new Error("not back");
  await submit(cafeOwner, ad.id);
});

// --- Reels needs one vertical video -----------------------------------------------------------------------------------
await expectOk("Reels: a photo, a landscape video, a processing one and a long one are refused; a vertical one passes", async () => {
  const problems = async (media) => {
    const d = await draft(cafeOwner, ready({ name: "Reel", placements: ["reels"], media }));
    return (await as(cafeOwner, () => one(db.query("select public.ad_problems($1) as p", [d.id])))).p.join(" / ");
  };
  if (!(await problems([LATTE])).includes("Reels needs one vertical video.")) throw new Error("photo passed");
  if (!(await problems([{ type: "video", media_id: await video(cafeOwner, 1920, 1080) }])).includes("taller than it is wide")) throw new Error("landscape passed");
  if (!(await problems([{ type: "video", media_id: await video(cafeOwner, 1080, 1920, { status: "processing" }) }])).includes("still processing")) throw new Error("processing passed");
  if (!(await problems([{ type: "video", media_id: await video(cafeOwner, 1080, 1920, { seconds: 75 }) }])).includes("60 seconds")) throw new Error("long passed");
  const ok = await problems([{ type: "video", media_id: await video(cafeOwner, 1080, 1920) }]);
  if (ok !== "") throw new Error(ok);
});

// --- Review -----------------------------------------------------------------------------------------------------------
await expectError("a student cannot approve ads", () => as(ben, () => db.query("select public.admin_approve_ad($1, 5000, 'USD', 'INV-1')", [ad.id])), "admins");
await expectError("nor the business itself", () => as(cafeOwner, () => db.query("select public.admin_approve_ad($1, 5000, 'USD', 'INV-1')", [ad.id])), "admins");
await expectError("an ad is paid: no amount, no approval", () => approve(ad.id, { amount: 0 }), "enter the amount");
await expectError("and the payment's reference is on record", () => approve(ad.id, { reference: "" }), "payment reference");
await expectOk("approved with its payment: scheduled (it starts in an hour), the payment in the ledger, the team (not the analyst) told", async () => {
  if ((await approve(ad.id)).status !== "scheduled") throw new Error("not scheduled");
  const pay = await one(db.query("select amount_cents, payment_reference, status from public.listing_promotions where ad_id = $1", [ad.id]));
  if (pay.amount_cents !== 5000 || pay.payment_reference !== "INV-1" || pay.status !== "active") throw new Error(JSON.stringify(pay));
  for (const [who, want] of [[cafeOwner, 1], [cafeEditor, 1], [cafeAnalyst, 0]]) {
    const n = await as(who, () => rows(db.query("select title, link from public.notifications where type = 'ad'")));
    if (n.length !== want || (want && (n[0].title !== "Your ad is approved" || n[0].link !== `/ads/${ad.id}`))) throw new Error(`${who}: ${JSON.stringify(n)}`);
  }
});
await expectError("an approved ad cannot be edited", () => as(cafeOwner, () => db.query("update public.ads set caption = 'Changed' where id = $1", [ad.id])), "Only a draft or a rejected ad");
let rejected;
await expectOk("a rejection says why; the team edits the ad and submits it again", async () => {
  rejected = await draft(cafeOwner, ready({ name: "Claims", caption: "Best coffee in Texas, guaranteed." }));
  await submit(cafeOwner, rejected.id);
  await as(admin, () => db.query("select public.admin_reject_ad($1, 'Avoid unprovable claims like guaranteed.')", [rejected.id]));
  const r = await one(db.query("select status, status_reason from public.ads where id = $1", [rejected.id]));
  const n = await as(cafeOwner, () => rows(db.query("select body from public.notifications where type = 'ad' and title = 'Your ad was not approved'")));
  if (r.status !== "rejected" || !r.status_reason.includes("unprovable") || !n[0]?.body.includes("unprovable")) throw new Error(JSON.stringify({ r, n }));
  await as(cafeOwner, () => db.query("update public.ads set caption = 'Coffee we are proud of.' where id = $1", [rejected.id]));
  if ((await submit(cafeOwner, rejected.id)).status !== "pending_review") throw new Error("not resubmitted");
});
await expectError("a rejection needs a reason", () => as(admin, () => db.query("select public.admin_reject_ad($1, 'no')", [rejected.id])), "Say why");
let housingReady;
await expectOk("housing: submitted with the listing's photos standing in", async () => {
  housingReady = await draft(rentOwner, { business_id: rent, created_by: rentOwner, name: "Fall leasing", university_ids: [txstate], caption: "Two-bed by the river, pool and gym.", cta: "view_listing", promoted_apartment_id: listing, budget_cents: 20000, starts_at: hours(-1), ends_at: hours(24 * 30) });
  await submit(rentOwner, housingReady.id);
});
await expectError("a housing ad needs the reviewer's Fair Housing check", () => approve(housingReady.id), "Fair Housing");
await expectOk("checked: it runs at once (its start has passed) and the check is on record", async () => {
  if ((await approve(housingReady.id, { fairHousing: true, reference: "INV-H" })).status !== "active") throw new Error("not active");
  const r = await one(db.query("select fair_housing_checked_by, started_at from public.ads where id = $1", [housingReady.id]));
  if (r.fair_housing_checked_by !== admin || !r.started_at) throw new Error(JSON.stringify(r));
});
await expectOk("a flagged housing ad needs a note on top", async () => {
  await as(rentOwner, () => db.query("update public.ads set university_ids = $2, starts_at = $3, ends_at = $4, budget_cents = 9000 where id = $1", [housingAd.id, [txstate], hours(1), hours(48)]));
  await submit(rentOwner, housingAd.id);
  let refused = false;
  try { await approve(housingAd.id, { fairHousing: true }); } catch (e) { refused = e.message.includes("flagged"); }
  if (!refused) throw new Error("approved without a note");
  await as(admin, () => db.query("select public.admin_reject_ad($1, 'Remove \"no kids\", \"adults only\" and \"perfect for singles\": familial status is protected.')", [housingAd.id]));
});

// --- Time ---------------------------------------------------------------------------------------------------------------
await expectOk("the sweep starts a scheduled ad at its start and tells the team", async () => {
  const r = await one(db.query("select public.ads_sweep($1) as r", [hours(2)]));
  if (r.r.started < 1) throw new Error(JSON.stringify(r));
  const a = await one(db.query("select status, started_at from public.ads where id = $1", [ad.id]));
  const n = await as(cafeOwner, () => rows(db.query("select 1 from public.notifications where type = 'ad' and title = 'Your ad is live'")));
  if (a.status !== "active" || !a.started_at || n.length !== 1) throw new Error(JSON.stringify({ a, n }));
});
await expectOk("a submitted ad whose dates pass before review goes back to draft, with the reason", async () => {
  const late = await draft(cafeOwner, ready({ name: "Too late", starts_at: hours(1), ends_at: hours(3) }));
  await submit(cafeOwner, late.id);
  await db.query("select public.ads_sweep($1)", [hours(4)]);
  const r = await one(db.query("select status, status_reason from public.ads where id = $1", [late.id]));
  if (r.status !== "draft" || !r.status_reason.includes("dates passed")) throw new Error(JSON.stringify(r));
});
await expectError("the sweep is not for the API", () => as(cafeOwner, () => db.query("select public.ads_sweep()")), "permission denied");
// The sweep ran ahead of the clock; what students see follows the real one, so the café's first ad starts now.
await transition("update public.ads set starts_at = now() - interval '1 hour' where id = $1", [ad.id]);

// --- What students see --------------------------------------------------------------------------------------------
await expectOk("a Texas State student gets the running For You ad; a UTSA student, signed-in businesses and the Housing placement do not", async () => {
  const mine = await feed(ben, "for_you");
  if (mine.length !== 1 || mine[0].id !== ad.id || mine[0].business_name !== "Bean There" || "budget_cents" in mine[0]) throw new Error(JSON.stringify(mine));
  if ((await feed(uma, "for_you")).length !== 0) throw new Error("another campus saw it");
  if ((await feed(cafeOwner, "for_you")).length !== 0) throw new Error("a business session got ads");
  if ((await feed(ben, "reels")).length !== 0) throw new Error("it ran in Reels");
});
await expectError("signed out, there are no ads", () => asAnon(() => db.query("select * from public.ads_for_feed('for_you')")), "permission denied");
await expectOk("Housing shows the housing ad with its listing", async () => {
  const h = await feed(ben, "housing");
  if (h.length !== 1 || h[0].id !== housingReady.id || h[0].promoted?.type !== "apartment" || h[0].promoted.title !== "Two-bed by the river") throw new Error(JSON.stringify(h));
});
await expectOk("students never read the ads table itself", async () => {
  if ((await as(ben, () => rows(db.query("select id from public.ads")))).length !== 0) throw new Error("a student read ads");
});
await expectOk("the listing a paid ad promotes is Sponsored while it runs", async () => {
  const s = await as(ben, () => one(db.query("select public.listing_sponsored(a) as s from public.apartments a where id = $1", [listing])));
  if (!s.s) throw new Error("not Sponsored");
});
await expectOk("an ad past its end date is gone at once, before any sweep", async () => {
  await transition("update public.ads set starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute' where id = $1", [housingReady.id]);
  if ((await feed(ben, "housing")).length !== 0) throw new Error("served after its end");
  const s = await one(db.query("select public.listing_sponsored(a) as s from public.apartments a where id = $1", [listing]));
  if (s.s) throw new Error("still Sponsored");
  const st = await as(rentOwner, () => one(db.query("select status from public.business_ad_stats($1)", [rent])));
  if (st.status !== "completed") throw new Error(`shown as ${st.status}`);
  await db.query("select public.ads_sweep(now())");
  if ((await one(db.query("select status from public.ads where id = $1", [housingReady.id]))).status !== "completed") throw new Error("the sweep did not complete it");
});
await expectOk("a second running ad: the rotation gives each its own slot", async () => {
  const second = await draft(cafeOwner, ready({ name: "Muffin Monday", starts_at: hours(-1) }));
  await submit(cafeOwner, second.id);
  await approve(second.id, { reference: "INV-2" });
  const a = await feed(ben, "for_you", 1, 0), b = await feed(ben, "for_you", 1, 1), c = await feed(ben, "for_you", 1, 2);
  if (a.length !== 1 || b.length !== 1 || a[0].id === b[0].id || c.length !== 0) throw new Error(JSON.stringify([a, b, c].map((x) => x.map((y) => y.id))));
});
await expectOk("a suspended business's ads stop; approved again, they run again", async () => {
  await review(admin, cafe, "suspended");
  if ((await feed(ben, "for_you")).length !== 0) throw new Error("suspended ads served");
  await review(admin, cafe, "approved");
  if ((await feed(ben, "for_you")).length !== 2) throw new Error("not back");
});

// --- Pausing and ending -------------------------------------------------------------------------------------------
await expectOk("an editor pauses; only the owner or an admin resumes", async () => {
  await as(cafeEditor, () => db.query("select public.ad_pause($1)", [ad.id]));
  let refused = false;
  try { await as(cafeEditor, () => db.query("select public.ad_resume($1)", [ad.id])); } catch (e) { refused = e.message.includes("owner or an admin"); }
  if (!refused) throw new Error("the editor resumed");
  if ((await feed(ben, "for_you")).some((x) => x.id === ad.id)) throw new Error("paused ad served");
  await as(cafeOwner, () => db.query("select public.ad_resume($1)", [ad.id]));
  if ((await one(db.query("select status from public.ads where id = $1", [ad.id]))).status !== "active") throw new Error("not active");
});
await expectOk("paused by the UniBuzz team: the business cannot resume it; the team can", async () => {
  await as(admin, () => db.query("select public.admin_pause_ad($1, 'Checking a complaint about the price.')", [ad.id]));
  let refused = false;
  try { await as(cafeOwner, () => db.query("select public.ad_resume($1)", [ad.id])); } catch (e) { refused = e.message.includes("UniBuzz team paused"); }
  if (!refused) throw new Error("the business resumed an admin pause");
  await as(admin, () => db.query("select public.admin_resume_ad($1)", [ad.id]));
});

// --- Hide, report, block --------------------------------------------------------------------------------------------
await expectOk("Ben hides an ad: gone for him, still there for Cat", async () => {
  await as(ben, () => db.query("select public.hide_ad($1)", [ad.id]));
  if ((await feed(ben, "for_you")).some((x) => x.id === ad.id)) throw new Error("hidden ad served");
  if (!(await feed(cat, "for_you")).some((x) => x.id === ad.id)) throw new Error("Cat lost it");
});
await expectOk("Cat reports it: hidden for her, once in the UniBuzz team's queue, invisible to the business", async () => {
  await as(cat, () => db.query("select public.report_business(null, 'misleading', 'The price is wrong', $1)", [ad.id]));
  await as(cat, () => db.query("select public.report_business(null, 'misleading', 'Again', $1)", [ad.id]));
  if ((await feed(cat, "for_you")).some((x) => x.id === ad.id)) throw new Error("reported ad served");
  const q = await as(admin, () => rows(db.query("select reason, reporter_name, ad_name from public.admin_list_business_reports('open')")));
  if (q.length !== 1 || q[0].reporter_name !== "Cat Cruz" || q[0].ad_name !== "Latte week") throw new Error(JSON.stringify(q));
  const ownerReads = await as(cafeOwner, () => db.query("select * from public.business_reports").then(() => "read", (e) => e.message));
  if (!ownerReads.includes("permission denied")) throw new Error(ownerReads);
  const log = await as(cafeOwner, () => rows(db.query("select action from public.business_audit($1) where action like 'report%'", [cafe])));
  if (log.length) throw new Error("the business saw the report in its log");
});
await expectOk("resolving a report goes in the log without the reporter", async () => {
  const id = (await as(admin, () => one(db.query("select id from public.admin_list_business_reports('open')")))).id;
  await as(admin, () => db.query("select public.admin_resolve_business_report($1, 'dismissed', 'Price checked')", [id]));
  const log = await as(cafeOwner, () => rows(db.query("select detail from public.business_audit($1) where action = 'report_dismissed'", [cafe])));
  if (log.length !== 1 || JSON.stringify(log[0].detail).includes("Cat")) throw new Error(JSON.stringify(log));
});
await expectOk("Uma blocks the café after moving to Texas State: no ads, no posts, no messages; unblocked, all back", async () => {
  await db.query("update public.profiles set university_id = $2 where id = $1", [uma, txstate]);
  await as(uma, () => db.query("select public.set_business_blocked($1, true)", [cafe]));
  if ((await feed(uma, "for_you")).length !== 0) throw new Error("blocked business's ads served");
  if ((await as(uma, () => rows(db.query("select id from public.deals where business_id = $1", [cafe])))).length !== 0) throw new Error("posts visible");
  let refused = false;
  try { await as(uma, () => db.query("select public.start_business_inquiry('business', $1)", [cafe])); } catch (e) { refused = e.message.includes("You blocked this business"); }
  if (!refused) throw new Error("could message");
  await as(uma, () => db.query("select public.set_business_blocked($1, false)", [cafe]));
  if ((await feed(uma, "for_you")).length !== 2) throw new Error("not back");
});
await expectError("a business account cannot block, hide or report", () => as(rentOwner, () => db.query("select public.hide_ad($1)", [ad.id])), "Sign in as a student");
await expectError("reports: 20 a day per student", async () => {
  for (let i = 0; i < 25; i++) {
    const p = (await as(cafeOwner, () => one(db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, $3) returning id", [cafe, cafeOwner, `Post ${i}`])))).id;
    await as(ben, () => db.query("select public.report_business(null, 'spam', null, null, $1)", [p]));
  }
}, "a lot of reports today");

// --- Events and the numbers ---------------------------------------------------------------------------------------------
await expectOk("events count once per person per hour or day; the business's own team does not count", async () => {
  for (const who of [uma, uma, cat]) await as(who, () => db.query("select public.record_business_event('impression', null, $1, null, null, 'for_you')", [ad.id]));
  await as(uma, () => db.query("select public.record_business_event('click', null, $1, null, null, 'for_you')", [ad.id]));
  await as(uma, () => db.query("select public.record_business_event('profile_visit', $1, $2, null, null, 'profile')", [cafe, ad.id]));
  await as(uma, () => db.query("select public.save_ad($1, true)", [ad.id]));
  await as(cafeEditor, () => db.query("select public.record_business_event('impression', null, $1, null, null, 'for_you')", [ad.id]));
  const chat = await as(uma, () => one(db.query("select public.start_business_inquiry('ad', $1) as id", [ad.id])));
  const c = await one(db.query("select inquiry_target_type, inquiry_target_id from public.conversations where id = $1", [chat.id]));
  if (c.inquiry_target_type !== "ad" || c.inquiry_target_id !== ad.id) throw new Error(JSON.stringify(c));
  const s = await as(cafeAnalyst, () => one(db.query("select * from public.business_ad_stats($1) where ad_id = $2", [cafe, ad.id])));
  const got = ["impressions", "reach", "clicks", "saves", "profile_visits", "inquiries"].map((k) => Number(s[k])).join();
  if (got !== "2,2,1,1,1,1") throw new Error(got);
});
await expectOk("the day-by-day numbers have every day, today's counted", async () => {
  const d = await as(cafeOwner, () => rows(db.query("select * from public.business_daily_stats($1, 30, null)", [cafe])));
  if (d.length !== 30 || Number(d[29].impressions) !== 2 || Number(d[0].impressions) !== 0) throw new Error(JSON.stringify(d.slice(-2)));
  const o = await as(cafeOwner, () => one(db.query("select * from public.business_analytics_overview($1, 30)", [cafe])));
  if (Number(o.inquiries) !== 1 || Number(o.reach) !== 2 || Number(o.active_ads) !== 2) throw new Error(JSON.stringify(o));
});
await expectError("a student cannot read a business's numbers", () => as(ben, () => db.query("select * from public.business_ad_stats($1)", [cafe])), "Only the business");
await expectError("nor another business", () => as(rentOwner, () => db.query("select * from public.business_daily_stats($1)", [cafe])), "Only the business");
await expectError("nobody reads the events themselves, the business included", () => as(cafeOwner, () => db.query("select * from public.business_events")), "permission denied");
await expectOk("a signed-out visitor's events are dropped quietly", async () => {
  const before = Number((await one(db.query("select count(*) from public.business_events"))).count);
  await as(null, () => db.query("select public.record_business_event('profile_visit', $1)", [cafe])).catch(() => {});
  if (Number((await one(db.query("select count(*) from public.business_events"))).count) !== before) throw new Error("counted");
});

// --- Rate limits ------------------------------------------------------------------------------------------------------
await expectError("a student opens 15 new business chats an hour at most", async () => {
  for (let i = 0; i < 20; i++) {
    const [, b] = await business(admin, `shop${i}@example.org`, `Shop ${i}`, "retail", txstate);
    await as(cat, () => db.query("select public.start_business_inquiry('business', $1)", [b]));
  }
}, "a lot of businesses in the last hour");
await expectError("a business publishes 30 posts a day", async () => {
  for (let i = 0; i < 40; i++) await as(rentOwner, () => db.query("insert into public.deals (business_id, created_by, title) values ($1, $2, $3)", [rent, rentOwner, `Flash ${i}`]));
}, "30 posts today");

// --- Rollback refuses while it would lose a payment --------------------------------------------------------------------
await expectError("the rollback refuses while an ad that promoted nothing has a payment", () => db.exec(read(ROLLBACK)), "payments for ads that promoted no listing or deal");

done("BUSINESS ADS");
