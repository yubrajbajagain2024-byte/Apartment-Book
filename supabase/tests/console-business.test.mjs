// Migration 59 (the staff console's Analytics and Business sections) against PGlite:
//   * who may call: admins of the staff with a second factor; the Business functions also need the UniBuzz admin role;
//     everyone else 'not found', staff without the second factor 'mfa_required'; the internal helpers are closed to
//     the API; on this repo's schema and on production's (CampConnect Admin's public.staff, suspensions);
//   * the platform's numbers: sign-ups per day and in total, engagement by kind, engaged students (never business
//     accounts, never Buzz authors), the campus filter, the range's limits, active students and the daily snapshot;
//   * ad numbers (impressions, reach, clicks, placements, top ads, the previous range, review times);
//   * revenue: booked, voided, net, earned over the paid period, by placement, category and business, the pipeline;
//   * advertisers: search (names, the owner's email, an id's first characters, wildcards taken literally), paging,
//     the detail (never who reported), internal notes kept out of the business's own log;
//   * campaigns: drafted for a business (and what the ad trigger refuses), rescheduled with the payments' period
//     following, further payments, voiding (the ad ends with its last payment), the ledger's filters;
//   * the rate card and the quote; re-running the migration; the rollback's refusal and a clean undo and redo.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261112000000_console_business.sql";
const ROLLBACK = "rollbacks/20261112000000_console_business.down.sql";
const MFA = { aal: "aal2" };
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NIL = "00000000-0000-0000-0000-000000000000";
const at = (ms) => new Date(Date.now() + ms).toISOString();
const ms = (offset) => Date.now() + offset;
/** The Central-time day (the console's days) of now + offset, as YYYY-MM-DD. */
const centralDay = (offset = 0) => new Date(Date.now() + offset).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const check = (cond, message) => { if (!cond) throw new Error(message); };

const ANALYTICS = ["public.console_analytics_overview(30, null)", "public.console_analytics_ads(30, null)", "public.console_analytics_revenue(30)"];
const businessCalls = (biz) => [
  "public.console_business_overview()", "public.console_businesses(null, null, 30, 0)", `public.console_business('${biz}')`,
  `public.console_add_business_note('${biz}', 'hello there')`, "public.console_ads('all', null, null, 30, 0)", `public.console_ad('${NIL}')`,
  `public.console_create_ad('${biz}', '{}'::jsonb)`, `public.console_update_ad_terms('${NIL}', null, null, null, 'because')`,
  `public.console_record_ad_payment('${NIL}', 100, 'USD', 'REF-1', null)`, `public.console_void_ad_payment('${NIL}', 'because')`,
  "public.console_payments(null, null, null, 50, 0)", "public.console_ad_rates()", "public.console_set_ad_rate('for_you', 100, 0)",
];
const INTERNAL = [
  "public.console_require_business_admin()", "public.platform_activity_snapshot()",
  "public.console_recognized_cents(now(), now())", "public.console_campus_json(null)", "public.console_audit('x.y', null, null, null, null)", "public.console_ad_quote(null::uuid)",
  "public.console_payment_json(null::uuid)", "public.console_ad_row_json(null::uuid)",
  // The pure helpers too: an open day series would let anyone ask for millions of rows.
  "public.console_tz()", "public.console_day_start('2026-01-01')", "public.console_day_series('1000-01-01', '9999-12-31')",
  "public.console_days(30)", "public.console_like('x')",
];

/** What every part of this file needs, on one booted database. */
async function setup(h) {
  const { db, mk, as } = h;
  const one = async (p) => (await p).rows[0];
  const rows = async (p) => (await p).rows;
  const sql1 = (text, params = []) => one(db.query(text, params));
  /** `select <expr> as r` as a user (after two-factor sign-in unless claims say otherwise). */
  const call = (uid, expr, params = [], claims = MFA) => as(uid, async () => (await one(db.query(`select ${expr} as r`, params))).r, claims);
  const staffTable = (await sql1("select to_regclass('public.staff') is not null as ok")).ok ? "staff" : "staff_members";
  const makeStaff = (uid, role) => db.query(`insert into public.${staffTable} (user_id, role) values ($1, $2)`, [uid, role]);
  const txstate = (await sql1("select id from public.universities where email_domain = 'txstate.edu'")).id;
  const utsa = (await sql1("select id from public.universities where name = 'University of Texas at San Antonio'")).id;
  const student = async (email, name, campus = txstate) => {
    const id = await mk(email, name);
    if (campus !== txstate) await db.query("update public.profiles set university_id = $2 where id = $1", [id, campus]);
    return id;
  };
  const admin = await mk("ann.admin@txstate.edu", "Ann Avery");
  await db.query("select public.grant_role($1, 'admin')", [admin]);
  await makeStaff(admin, "admin");
  const signUp = async (email, meta) => (await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify(meta)])).rows[0].id;
  const confirm = (id) => db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
  /** A business owner, confirmed and approved unless asked otherwise: [owner, business]. */
  const business = async (email, name, category, campus = txstate, approve = true) => {
    const owner = await signUp(email, { account_type: "business", full_name: `${name} Owner`, business_name: name, business_category: category, business_university_id: campus });
    await confirm(owner);
    const id = (await sql1("select id from public.businesses where owner_id = $1", [owner])).id;
    if (approve) await as(admin, () => db.query("select public.admin_review_business($1, 'approved', null)", [id]), MFA);
    return [owner, id];
  };
  /** A photo really uploaded to this project's storage by `owner` (migration 56 holds ad and post photos to those). */
  const upload = async (owner, name) => {
    await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2, $3)", [`posts/${owner}/${name}.jpg`, owner, owner]);
    return { type: "image", url: `https://proj.supabase.co/storage/v1/object/public/uploads/posts/${owner}/${name}.jpg` };
  };
  const AD_INSERT = `insert into public.ads (business_id, created_by, name, objective, placements, university_ids, headline, caption, media, cta, cta_url,
      promoted_deal_id, promoted_apartment_id, budget_cents, starts_at, ends_at)
    select r.business_id, r.created_by, r.name, coalesce(r.objective, 'awareness'), coalesce(r.placements, '{for_you}'), coalesce(r.university_ids, '{}'),
      r.headline, coalesce(r.caption, ''), coalesce(r.media, '[]'), coalesce(r.cta, 'learn_more'), r.cta_url, r.promoted_deal_id, r.promoted_apartment_id,
      coalesce(r.budget_cents, 0), r.starts_at, r.ends_at
    from jsonb_populate_record(null::public.ads, $1::jsonb) r returning *`;
  /** A complete ad drafted by the business's owner. */
  const draft = (owner, biz, fields = {}) => as(owner, () => one(db.query(AD_INSERT, [JSON.stringify({
    business_id: biz, created_by: owner, name: "Latte week", placements: ["for_you"], university_ids: [txstate], caption: "Half-price lattes for students.",
    cta: "order_now", cta_url: "https://beanthere.example/order", budget_cents: 5000, starts_at: at(HOUR), ends_at: at(7 * DAY), ...fields,
  })])));
  const submit = (owner, id) => as(owner, () => db.query("select public.ad_submit($1)", [id]));
  const approve = (id, amount = 5000, reference = "INV-1") => as(admin, () => db.query("select public.admin_approve_ad($1, $2, 'USD', $3, null, false)", [id, amount, reference]), MFA);
  /** Drafted, submitted and approved with its payment. */
  const running = async (owner, biz, fields = {}, amount = 5000, reference = "INV-1") => {
    const ad = await draft(owner, biz, fields);
    await submit(owner, ad.id);
    await approve(ad.id, amount, reference);
    return ad.id;
  };
  const feed = (who, placement = "for_you") => as(who, () => rows(db.query("select id from public.ads_for_feed($1, 10, 0)", [placement])));
  const event = (who, kind, ad, placement = "for_you") => as(who, () => db.query("select public.record_business_event($1, null, $2, null, null, $3)", [kind, ad, placement]));
  /** Rows written with their triggers off (the content tables set created_at themselves), for backdated history. */
  const raw = async (sql, params = []) => {
    await db.exec("set session_replication_role = replica");
    try { return await db.query(sql, params); } finally { await db.exec("set session_replication_role = origin"); }
  };
  return { ...h, one, rows, sql1, call, staffTable, makeStaff, txstate, utsa, student, admin, signUp, confirm, business, upload, draft, submit, approve, running, feed, event, raw };
}

// =====================================================================================================================
// 1. The platform's, the ads' and the money's numbers
// =====================================================================================================================
{
  const t = await setup(await boot());
  const { db, as, call, sql1, rows, admin, txstate, utsa, student, raw } = t;
  const ana = await student("ana@txstate.edu", "Ana Arce");
  const ben = await student("ben@txstate.edu", "Ben Brooks");
  const cal = await student("cal@txstate.edu", "Cal Cortez", utsa);
  const dee = await student("dee@txstate.edu", "Dee Diaz");
  const eve = await student("eve@txstate.edu", "Eve Ellis");
  await db.query("update public.profiles set created_at = now() - interval '2 days' where id = $1", [dee]);
  await db.query("update public.profiles set created_at = now() - interval '40 days' where id = $1", [eve]);
  const [cafeOwner, cafe] = await t.business("hi@beanthere.example", "Bean There", "food");

  await expectOk("sign-ups: students only, per Central day, with a running total; the range before counts apart", async () => {
    const o = await call(admin, "public.console_analytics_overview(30, null)");
    const students = Number((await sql1("select count(*) as n from public.profiles where role = 'student'")).n);
    check(o.totals.students === students && students === 5, `students ${o.totals.students} / ${students}`);
    check(o.totals.businessAccounts === 1 && o.totals.businesses === 1, JSON.stringify(o.totals));
    check(o.growth.signups === 4 && o.growth.signupsPrev === 1, JSON.stringify(o.growth).slice(0, 200));
    const day = (d) => o.growth.perDay.find((x) => x.day === d);
    check(o.growth.perDay.length === 30 && o.range.days === 30 && o.range.to === centralDay(), `${o.growth.perDay.length} ${JSON.stringify(o.range)}`);
    check(day(centralDay(-2 * DAY))?.signups === 1, JSON.stringify(day(centralDay(-2 * DAY))));
    check(day(centralDay())?.signups === 3, JSON.stringify(day(centralDay())));
    check(o.growth.perDay[0].total === 1 && o.growth.perDay.at(-1).total === 5, `${o.growth.perDay[0].total} → ${o.growth.perDay.at(-1).total}`);
    check(o.timeZone === "America/Chicago" && typeof o.generatedAt === "number" && o.campus === null, `${o.timeZone} ${o.campus}`);
  });
  await expectOk("the range is 1 to 365 days, whatever is asked", async () => {
    check((await call(admin, "public.console_analytics_overview(0, null)")).range.days === 1, "0 days");
    check((await call(admin, "public.console_analytics_overview(1000, null)")).range.days === 365, "1000 days");
    check((await call(admin, "public.console_analytics_overview(null, null)")).range.days === 30, "null days");
    check((await call(admin, "public.console_analytics_ads(-4, null)")).range.days === 1, "ads -4 days");
    check((await call(admin, "public.console_analytics_revenue(9999)")).perDay.length === 365, "revenue 9999 days");
  });
  await expectError("an unknown campus is not found", () => call(admin, `public.console_analytics_overview(30, '${NIL}')`), "ts:not_found:");
  await expectError("in the ad numbers too", () => call(admin, `public.console_analytics_ads(30, '${NIL}')`), "ts:not_found:");

  // Engagement: Ana posts and writes to Ben; Ben posts (three days ago), comments and follows; Cal (UTSA) likes; Dee
  // only writes on Buzz and Eve only replies there; the café's owner (a business account) likes too, as the database
  // owner (the API would refuse a business account that).
  let post;
  await expectOk("engagement is counted by kind and day", async () => {
    post = (await as(ana, () => sql1("insert into public.feed_posts (author_id, university_id, body) values ($1, $2, 'First day!') returning id", [ana, txstate]))).id;
    await as(ana, () => db.query("insert into public.feed_posts (author_id, university_id, kind, body, videos) values ($1, $2, 'reel', 'Campus tour', $3)", [ana, txstate, JSON.stringify([{ playback_id: "pb" }])]));
    await raw("insert into public.feed_posts (author_id, university_id, body, created_at) values ($1, $2, 'Old post', now() - interval '3 days')", [ben, txstate]);
    await raw("insert into public.post_comments (target_type, target_id, user_id, body) values ('post', $1, $2, 'Welcome')", [post, ben]);
    await raw("insert into public.post_likes (target_type, target_id, user_id) values ('post', $1, $2)", [post, cal]);
    await raw("insert into public.post_likes (target_type, target_id, user_id) values ('post', $1, $2)", [post, cafeOwner]);
    await as(ben, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [ben, ana]));
    const chat = (await as(ana, () => sql1("select public.get_or_create_direct_conversation($1) as id", [ben]))).id;
    await as(ana, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'hey')", [chat, ana]));
    const buzz = (await raw("insert into public.buzz_posts (author_id, university_id, alias, title) values ($1, $2, 'Quiet Otter', 'Library at night') returning id", [dee, txstate])).rows[0].id;
    await raw("insert into public.buzz_comments (post_id, author_id, alias, body) values ($1, $2, 'Loud Heron', 'So true')", [buzz, eve]);
    // Buzz counts only what students can see: not a buzz or a reply still inside its publication delay (counting it
    // would date it to the second), nor one held for review.
    await raw("insert into public.buzz_posts (author_id, university_id, alias, title, visible_at) values ($1, $2, 'Quiet Otter', 'Not yet', now() + interval '170 seconds')", [dee, txstate]);
    await raw("insert into public.buzz_posts (author_id, university_id, alias, title, status) values ($1, $2, 'Quiet Otter', 'Held', 'held')", [dee, txstate]);
    await raw("insert into public.buzz_comments (post_id, author_id, alias, body, visible_at) values ($1, $2, 'Loud Heron', 'Soon', now() + interval '40 seconds')", [buzz, eve]);
    const o = await call(admin, "public.console_analytics_overview(30, null)");
    const e = o.engagement.totals;
    const want = { posts: 2, reels: 1, comments: 1, likes: 1, messages: 1, follows: 1, buzzes: 1, buzzReplies: 1, listings: 0, items: 0 };
    for (const [k, v] of Object.entries(want)) check(e[k] === v, `${k}: ${e[k]} (want ${v}) ${JSON.stringify(e)}`);
    const today = o.engagement.perDay.find((x) => x.day === centralDay());
    check(today.posts === 1 && today.reels === 1 && today.messages === 1 && today.likes === 1 && today.buzzes === 1, JSON.stringify(today));
    check(o.engagement.perDay.find((x) => x.day === centralDay(-3 * DAY))?.posts === 1, "Ben's older post is not on its day");
  });
  await expectOk("engaged students: Ana, Ben and Cal; never the business account, never Buzz's anonymous authors", async () => {
    const o = await call(admin, "public.console_analytics_overview(30, null)");
    check(o.engaged.inRange === 3 && o.engaged.last30 === 3 && o.engaged.last7 === 3 && o.engaged.today === 3, JSON.stringify(o.engaged));
    check(o.engagement.perDay.find((x) => x.day === centralDay()).engaged === 3, "today's engaged");
    check(o.engagement.perDay.find((x) => x.day === centralDay(-3 * DAY)).engaged === 1, "Ben alone three days ago");
  });
  await expectOk("the range before is counted apart (two days: Ben's post of three days ago is in the previous two)", async () => {
    const o = await call(admin, "public.console_analytics_overview(2, null)");
    check(o.engagement.totals.posts === 1 && o.engagement.prev.posts === 1 && o.engaged.inPrevRange === 1, `${JSON.stringify(o.engagement.prev)} ${JSON.stringify(o.engaged)}`);
  });
  await expectOk("a campus narrows every number to its students", async () => {
    const o = await call(admin, `public.console_analytics_overview(30, '${utsa}')`);
    check(o.campus?.id === utsa && o.totals.students === 1 && o.growth.signups === 1, JSON.stringify({ c: o.campus, t: o.totals, g: o.growth.signups }));
    check(o.engagement.totals.likes === 1 && o.engagement.totals.posts === 0 && o.engagement.totals.buzzes === 0 && o.engaged.inRange === 1, JSON.stringify(o.engagement.totals));
    check(o.campuses.length === 0, "the campus list is for all campuses only");
    const all = await call(admin, "public.console_analytics_overview(30, null)");
    const tx = all.campuses.find((c) => c.id === txstate), ut = all.campuses.find((c) => c.id === utsa);
    check(tx?.students === 4 && ut?.students === 1 && tx.signups === 3, JSON.stringify(all.campuses));
  });

  await expectOk("active students now: from the times of those who show their status; business accounts left out", async () => {
    for (const [uid, offset] of [[ana, 0], [ben, -2 * DAY], [cal, -10 * DAY], [cafeOwner, 0]]) {
      await db.query("insert into public.user_activity (user_id, last_active_at) values ($1, $2) on conflict (user_id) do update set last_active_at = excluded.last_active_at", [uid, at(offset)]);
    }
    const o = await call(admin, "public.console_analytics_overview(30, null)");
    check(JSON.stringify(o.active.now) === JSON.stringify({ dau: 1, mau: 3, wau: 2, online15m: 1 }), JSON.stringify(o.active.now));
    check(o.active.perDay.at(-1).dau === 1 && o.active.since === null && o.active.perDay[0].dau === null, JSON.stringify(o.active.perDay.slice(-2)));
    check(o.lastHour.signups === 3 && o.lastHour.posts === 2 && o.lastHour.messages === 1, JSON.stringify(o.lastHour));
  });
  await expectOk("the snapshot counts each campus's active students by day, numbers only; a day's count only grows", async () => {
    const n = (await sql1("select public.platform_activity_snapshot() as n")).n;
    check(n >= 2, `rows ${n}`);
    const row = async (campus) => sql1("select dau, wau, mau from public.platform_activity_daily where day = $1::date and university_id = $2", [centralDay(), campus]);
    check(JSON.stringify(await row(txstate)) === JSON.stringify({ dau: 1, wau: 2, mau: 2 }), JSON.stringify(await row(txstate)));
    check(JSON.stringify(await row(utsa)) === JSON.stringify({ dau: 0, wau: 0, mau: 1 }), JSON.stringify(await row(utsa)));
    const cols = (await rows(db.query("select column_name from information_schema.columns where table_name = 'platform_activity_daily'"))).map((c) => c.column_name).sort().join();
    check(cols === "dau,day,mau,recorded_at,university_id,wau", cols);
    await db.query("delete from public.user_activity where user_id = $1", [ana]); // Ana hides her activity status
    await sql1("select public.platform_activity_snapshot() as n");
    check(JSON.stringify(await row(txstate)) === JSON.stringify({ dau: 1, wau: 1, mau: 1 }), JSON.stringify(await row(txstate)));
  });
  await expectOk("past days come from the snapshots, today from the live count", async () => {
    await sql1("select public.platform_activity_snapshot(now() - interval '1 day') as n");
    await db.query("update public.platform_activity_daily set dau = 7 where day = $1::date and university_id = $2", [centralDay(-DAY), txstate]);
    const o = await call(admin, "public.console_analytics_overview(30, null)");
    check(o.active.perDay.find((x) => x.day === centralDay(-DAY)).dau === 7 && o.active.since === centralDay(-DAY), JSON.stringify(o.active.perDay.slice(-2)));
    check(o.active.perDay.at(-1).dau === o.active.now.dau && o.active.now.dau === 0, JSON.stringify(o.active.now));
    const u = await call(admin, `public.console_analytics_overview(30, '${utsa}')`);
    check(u.active.perDay.find((x) => x.day === centralDay(-DAY)).dau === 0 && u.active.now.mau === 1, JSON.stringify(u.active));
  });

  // Ads: one For You ad for Texas State (Latte week) and one for UTSA, both running and paid.
  let latte, utsaAd;
  await expectOk("ad numbers: impressions, reach and clicks of students, by day and placement; the top ads with their money", async () => {
    const photo = await t.upload(cafeOwner, "latte");
    latte = await t.running(cafeOwner, cafe, { media: [photo], starts_at: at(-HOUR) }, 5000, "INV-LATTE");
    utsaAd = await t.running(cafeOwner, cafe, { name: "UTSA week", media: [photo], university_ids: [utsa], starts_at: at(-HOUR) }, 3000, "INV-UTSA");
    await t.event(ana, "impression", latte);
    await t.event(ana, "click", latte);
    await t.event(ben, "impression", latte);
    await t.event(cal, "impression", utsaAd);
    await t.event(cal, "impression", latte); // not Cal's campus: not counted (migration 56)
    const a = await call(admin, "public.console_analytics_ads(30, null)");
    check(JSON.stringify(a.totals) === JSON.stringify({ reach: 3, saves: 0, clicks: 1, inquiries: 0, impressions: 3, profileVisits: 0 }), JSON.stringify(a.totals));
    const today = a.perDay.find((x) => x.day === centralDay());
    check(today.impressions === 3 && today.reach === 3 && today.clicks === 1 && a.perDay.length === 30, JSON.stringify(today));
    check(JSON.stringify(a.byPlacement) === JSON.stringify([{ clicks: 1, placement: "for_you", impressions: 3 }]), JSON.stringify(a.byPlacement));
    check(a.topAds[0].id === latte && a.topAds[0].impressions === 2 && a.topAds[0].paidCents === 5000 && a.topAds[0].businessName === "Bean There", JSON.stringify(a.topAds[0]));
    check(a.topAds[1].id === utsaAd && a.adsByStatus.active === 2, JSON.stringify(a.adsByStatus));
    check(a.review.decided === 2 && a.review.pending === 0 && a.review.medianHoursToDecision !== null, JSON.stringify(a.review));
  });
  await expectOk("a campus counts its own students' impressions; an older one counts in the range before", async () => {
    const tx = await call(admin, `public.console_analytics_ads(30, '${txstate}')`);
    check(tx.totals.impressions === 2 && tx.totals.clicks === 1 && tx.totals.reach === 2 && tx.adsByStatus.active === 1, JSON.stringify(tx.totals));
    await db.query("update public.business_events set created_at = now() - interval '35 days' where viewer_id = $1 and event = 'impression'", [ben]);
    const a = await call(admin, "public.console_analytics_ads(30, null)");
    check(a.totals.impressions === 2 && a.prev.impressions === 1 && a.prev.reach === 1, `${JSON.stringify(a.totals)} ${JSON.stringify(a.prev)}`);
  });
  await expectOk("review: an ad waiting is counted, with its submission time", async () => {
    const waiting = await t.draft(cafeOwner, cafe, { name: "Pending pastry", media: [await t.upload(cafeOwner, "pastry")], budget_cents: 4000 });
    await t.submit(cafeOwner, waiting.id);
    const a = await call(admin, "public.console_analytics_ads(30, null)");
    check(a.review.pending === 1 && typeof a.review.oldestPendingAt === "number" && a.adsByStatus.pending_review === 1, JSON.stringify(a.review));
  });

  // Money: Latte week $50 and UTSA week $30 (both approved above, an hour into a week), plus a $100 payment over ten
  // days, five of them gone, for an ad in For You and Reels; $20 forty days ago; €7 today.
  await expectOk("revenue: booked in the range, earned over the paid period, by placement, category and business", async () => {
    const reels = await t.draft(cafeOwner, cafe, { name: "Two places", placements: ["for_you", "reels"] });
    await raw(`insert into public.listing_promotions (business_id, ad_id, starts_at, ends_at, amount_cents, currency, payment_reference, created_at)
      values ($1, $2, now() - interval '5 days', now() + interval '5 days', 10000, 'USD', 'INV-TEN', now() - interval '5 days'),
             ($1, null, now() - interval '45 days', now() - interval '35 days', 2000, 'USD', 'INV-OLD', now() - interval '40 days'),
             ($1, null, now(), now() + interval '5 days', 700, 'EUR', 'INV-EUR', now())`, [cafe, reels.id]);
    const r = await call(admin, "public.console_analytics_revenue(30)");
    check(r.totals.bookedCents === 18000 && r.totals.payments === 3 && r.totals.advertisers === 1 && r.totals.avgPaymentCents === 6000, JSON.stringify(r.totals));
    check(r.totals.voidedCents === 0 && r.totals.netCents === 18000 && r.totals.activeAdvertisers === 1, JSON.stringify(r.totals));
    // Earned: $100 over ten days, five gone ($50). The two ads' payments began when they were submitted (a start in
    // the past moves to that minute), so they have earned a cent at most yet.
    check(r.totals.recognizedCents >= 5000 && r.totals.recognizedCents <= 5002, `earned ${r.totals.recognizedCents}, want about 5000`);
    check(r.perDay.find((x) => x.day === centralDay(-3 * DAY)).recognizedCents === 1000, JSON.stringify(r.perDay.find((x) => x.day === centralDay(-3 * DAY))));
    check(r.perDay.find((x) => x.day === centralDay(-5 * DAY)).bookedCents === 10000, "the $100 payment's day");
    const placement = Object.fromEntries(r.byPlacement.map((p) => [p.placement, p.bookedCents]));
    check(placement.for_you === 13000 && placement.reels === 5000 && Object.keys(placement).length === 2, JSON.stringify(r.byPlacement));
    check(JSON.stringify(r.byCategory) === JSON.stringify([{ category: "food", bookedCents: 18000 }]), JSON.stringify(r.byCategory));
    check(r.topBusinesses[0].id === cafe && r.topBusinesses[0].bookedCents === 18000 && r.topBusinesses[0].payments === 3, JSON.stringify(r.topBusinesses));
    check(JSON.stringify(r.otherCurrencies) === JSON.stringify([{ currency: "EUR", bookedCents: 700 }]), JSON.stringify(r.otherCurrencies));
    check(r.prev.bookedCents === 2000 && r.prev.payments === 1 && r.prev.netCents === 2000, JSON.stringify(r.prev));
    check(r.pipeline.pendingAds === 1 && r.pipeline.pendingBudgetCents === 4000, JSON.stringify(r.pipeline));
  });
  await expectOk("a voided payment is voided in the range, lowers net, and earns nothing", async () => {
    const pay = (await sql1("select id from public.listing_promotions where ad_id = $1", [utsaAd])).id;
    const v = await call(admin, `public.console_void_ad_payment('${pay}', 'Refunded at the business''s request')`);
    check(v.adEnded === true, JSON.stringify(v));
    const r = await call(admin, "public.console_analytics_revenue(30)");
    check(r.totals.bookedCents === 18000 && r.totals.voidedCents === 3000 && r.totals.netCents === 15000, JSON.stringify(r.totals));
    check(r.perDay.find((x) => x.day === centralDay()).voidedCents === 3000, "today's voided");
    // Earned spreads a payment in force over its period: Latte week's, moved to have begun a day ago, has earned a
    // seventh (and a bit) of its $50 by now; the voided UTSA payment earns nothing.
    await db.query("update public.listing_promotions set starts_at = now() - interval '1 day', ends_at = now() + interval '6 days' where ad_id = $1", [latte]);
    const after = await call(admin, "public.console_analytics_revenue(30)");
    const want = 5000 + Math.round(5000 / 7);
    check(Math.abs(after.totals.recognizedCents - want) <= 2, `earned ${after.totals.recognizedCents}, want about ${want}`);
  });
  await expectOk("the overview of Business: money this month and in 30 days, ads in review, ending soon", async () => {
    const o = await call(admin, "public.console_business_overview()");
    check(o.ads.inReview === 1 && o.ads.running === 1 && o.businesses.approved === 1 && o.reports.open === 0, JSON.stringify(o));
    check(o.revenue.last30Cents === 18000, JSON.stringify(o.revenue));
    check(o.endingSoon.length === 0, JSON.stringify(o.endingSoon));
    await call(admin, "public.console_update_ad_terms($1, null, $2, null, 'Ends early, as agreed')", [latte, ms(2 * DAY)]);
    check((await call(admin, "public.console_business_overview()")).endingSoon[0]?.id === latte, "Latte week ends in two days");
  });
  await db.close();
}

// =====================================================================================================================
// 2. Who may call, advertisers, campaigns, payments, the rate card, re-running and the rollback (this repo's schema)
// =====================================================================================================================
{
  const t = await setup(await boot());
  const { db, as, asAnon, call, sql1, rows, one, admin, txstate, utsa, student, makeStaff } = t;
  const ben = await student("ben@txstate.edu", "Ben Brooks");
  const uma = await student("uma@txstate.edu", "Uma Utsa", utsa);
  const mod = await student("mo.mod@txstate.edu", "Mo Moderator");
  await makeStaff(mod, "moderator");
  const staffOnly = await student("sam.staff@txstate.edu", "Sam Staffer");
  await makeStaff(staffOnly, "admin");
  const roleOnly = await student("rae.role@txstate.edu", "Rae Roleonly");
  await db.query("select public.grant_role($1, 'admin')", [roleOnly]);
  const [cafeOwner, cafe] = await t.business("hi@beanthere.example", "Bean There", "food");
  const [rentOwner, rent] = await t.business("hi@riverrock.example", "River Rock", "housing");
  const [, pies] = await t.business("hi@pendingpies.example", "Pending Pies", "food", txstate, false);
  const [, juice] = await t.business("hi@juice.example", "100% Juice", "food");
  const [, juices] = await t.business("hi@juices.example", "1000 Juices", "food");

  // --- Who may call ----------------------------------------------------------------------------------------------
  await expectOk("signed out: every console function is closed (permission denied)", async () => {
    for (const expr of [...ANALYTICS, ...businessCalls(cafe)]) {
      const msg = await asAnon(() => db.query(`select ${expr}`)).then(() => "allowed", (e) => e.message);
      check(msg.includes("permission denied"), `${expr}: ${msg}`);
    }
  });
  for (const [label, who] of [["a student", ben], ["a business owner", cafeOwner], ["a moderator", mod], ["an admin by role who is not staff", roleOnly]]) {
    await expectOk(`${label}: 'not found' from every console function, as if none existed`, async () => {
      for (const expr of [...ANALYTICS, ...businessCalls(cafe)]) {
        const msg = await call(who, expr).then(() => "allowed", (e) => e.message);
        check(msg.includes("ts:not_found:"), `${expr}: ${msg}`);
      }
    });
  }
  await expectOk("an admin of the staff without the second factor is asked for it", async () => {
    for (const expr of [...ANALYTICS, ...businessCalls(cafe)]) {
      const msg = await call(admin, expr, [], {}).then(() => "allowed", (e) => e.message);
      check(msg.includes("ts:mfa_required:"), `${expr}: ${msg}`);
    }
  });
  await expectOk("an admin of the staff without the UniBuzz admin role: the analytics, and 'forbidden' for every business tool", async () => {
    for (const expr of ANALYTICS) await call(staffOnly, expr);
    for (const expr of businessCalls(cafe)) {
      const msg = await call(staffOnly, expr).then(() => "allowed", (e) => e.message);
      check(msg.includes("ts:forbidden:") && msg.includes("grant_role"), `${expr}: ${msg}`);
    }
  });
  await expectOk("the internal helpers are not the API's to call, even for an admin", async () => {
    for (const expr of INTERNAL) {
      const msg = await call(admin, expr).then(() => "allowed", (e) => e.message);
      check(msg.includes("permission denied"), `${expr}: ${msg}`);
    }
  });
  await expectOk("the new tables are closed to the API", async () => {
    for (const table of ["ad_rates", "business_admin_notes", "platform_activity_daily"]) {
      const msg = await as(admin, () => db.query(`select * from public.${table}`), MFA).then(() => "allowed", (e) => e.message);
      check(msg.includes("permission denied"), `${table}: ${msg}`);
    }
  });

  // --- Advertisers ---------------------------------------------------------------------------------------------------
  const names = (page) => page.items.map((b) => b.name);
  await expectOk("advertisers: waiting for review first, then newest; counts by standing", async () => {
    const p = await call(admin, "public.console_businesses(null, null, 30, 0)");
    check(p.items[0].name === "Pending Pies" && p.items.length === 5 && p.nextOffset === null, names(p).join());
    check(JSON.stringify(p.counts) === JSON.stringify({ all: 5, pending: 1, approved: 4, rejected: 0, suspended: 0 }), JSON.stringify(p.counts));
    const c = p.items.find((b) => b.id === cafe);
    check(c.owner.email === "hi@beanthere.example" && c.owner.confirmed === true && c.members === 1 && c.status === "approved", JSON.stringify(c));
  });
  await expectOk("search: by name, by the owner's email, by an id's first characters; wildcards are taken literally", async () => {
    check(names(await call(admin, "public.console_businesses('river', null, 30, 0)")).join() === "River Rock", "by name");
    check(names(await call(admin, "public.console_businesses('beanthere.example', null, 30, 0)")).join() === "Bean There", "by email");
    check(names(await call(admin, `public.console_businesses('${cafe.slice(0, 8)}', null, 30, 0)`)).includes("Bean There"), "by id");
    check(names(await call(admin, "public.console_businesses('100%', null, 30, 0)")).join() === "100% Juice", "a % is a %");
    check(names(await call(admin, "public.console_businesses('100_', null, 30, 0)")).length === 0, "an _ is an _");
    check(names(await call(admin, "public.console_businesses('juice', null, 30, 0)")).sort().join() === "100% Juice,1000 Juices", "both juices");
  });
  await expectOk("the standing filter and paging", async () => {
    check(names(await call(admin, "public.console_businesses(null, 'pending', 30, 0)")).join() === "Pending Pies", "pending");
    const first = await call(admin, "public.console_businesses(null, 'approved', 2, 0)");
    const second = await call(admin, "public.console_businesses(null, 'approved', 2, 2)");
    check(first.items.length === 2 && first.nextOffset === 2 && second.items.length === 2 && second.nextOffset === null, `${first.nextOffset} ${second.nextOffset}`);
    check(new Set([...names(first), ...names(second)]).size === 4, "pages overlap");
  });
  await expectError("an unknown standing is refused", () => call(admin, "public.console_businesses(null, 'sleeping', 30, 0)"), "ts:validation_failed:");
  void juice; void juices;

  let editor;
  await expectOk("an advertiser in full: profile, owner and team, payments, reports without the reporter", async () => {
    const inv = await as(cafeOwner, () => one(db.query("select * from public.business_invite_create('ed@beanthere.example', 'editor')")));
    editor = await t.signUp("ed@beanthere.example", { account_type: "business", full_name: "Ed Editor", business_invite: inv.token });
    await t.confirm(editor);
    await as(ben, () => db.query("select public.report_business($1, 'misleading', 'The prices are not what the ad says.', null, null)", [cafe]));
    const d = await call(admin, `public.console_business('${cafe}')`);
    check(d.business.name === "Bean There" && d.owner.email === "hi@beanthere.example" && d.team.length === 2, JSON.stringify(d.team));
    check(d.team[0].role === "owner" && d.team[1].role === "editor" && d.team[1].email === "ed@beanthere.example", JSON.stringify(d.team));
    check(d.reports.open === 1 && d.reports.recent[0].reason === "misleading" && d.reports.recent[0].details.includes("prices"), JSON.stringify(d.reports));
    const s = JSON.stringify(d);
    check(!s.includes(ben) && !s.includes("reporter") && !s.includes("Ben Brooks"), "the reporter shows");
    check(d.notes.length === 0 && d.payments.length === 0 && d.stats30d.impressions === 0, JSON.stringify({ n: d.notes, p: d.payments }));
  });
  await expectError("an unknown business is not found", () => call(admin, `public.console_business('${NIL}')`), "ts:not_found:");
  await expectOk("a note is the team's alone: in the staff console's log, never in the business's", async () => {
    const notes = await call(admin, `public.console_add_business_note('${cafe}', 'Called the owner about the March invoice.')`);
    check(notes.length === 1 && notes[0].authorName === "Ann Avery" && notes[0].body.includes("March invoice"), JSON.stringify(notes));
    check((await call(admin, `public.console_business('${cafe}')`)).notes.length === 1, "not in the detail");
    const a = await sql1("select actor_id, actor_role, target_id from public.audit_log where action = 'business.note'");
    check(a?.actor_id === admin && a.actor_role === "admin" && a.target_id === cafe, JSON.stringify(a));
    check(Number((await sql1("select count(*) as n from public.business_audit_log where action = 'business.note' or detail::text like '%March invoice%'")).n) === 0, "in the business's log");
    const own = await as(cafeOwner, () => rows(db.query("select action, detail from public.business_audit($1, 100, null)", [cafe])));
    check(!JSON.stringify(own).includes("March invoice"), "the business reads the note");
  });
  await expectError("a note says something", () => call(admin, `public.console_add_business_note('${cafe}', ' x ')`), "ts:validation_failed:");
  await expectError("about a business that exists", () => call(admin, `public.console_add_business_note('${NIL}', 'Hello there')`), "ts:not_found:");

  // --- Campaigns drafted for a business ------------------------------------------------------------------------------
  const brew = await t.upload(cafeOwner, "brew");
  const post = (await as(cafeOwner, () => one(db.query("insert into public.deals (business_id, created_by, title, media) values ($1, $2, 'Cold brew', $3) returning id", [cafe, cafeOwner, JSON.stringify([brew])])))).id;
  const listing = (await as(rentOwner, () => one(db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id, images) values ($1, $2, 'Two-bed by the river', 'Pool and gym', 1200, '1 River Rd', $3, array['https://proj.supabase.co/storage/v1/object/public/uploads/apartments/r/1.jpg']) returning id", [rentOwner, rent, txstate])))).id;
  const input = (fields = {}) => JSON.stringify({
    name: "Cold brew week", objective: "traffic", placements: ["for_you"], universityIds: [txstate], headline: "Cold brew, $3", caption: "Cold brew all week.",
    cta: "order_now", ctaUrl: "https://beanthere.example/order", promotedDealId: post, budgetCents: 5000, startsAt: ms(HOUR), endsAt: ms(7 * DAY), note: "As agreed on the phone.", ...fields,
  });
  let drafted;
  await expectOk("the team drafts an ad for an approved business: a draft, by the admin, the owner told, on the business's log", async () => {
    const a = await call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input()]);
    drafted = a.id;
    check(a.status === "draft" && a.draftedByTeam === true && a.business.id === cafe && a.promoted?.type === "post" && a.budgetCents === 5000, JSON.stringify(a).slice(0, 300));
    const row = await sql1("select created_by, status, media, currency from public.ads where id = $1", [drafted]);
    check(row.created_by === admin && row.status === "draft" && row.media.length === 0 && row.currency === "USD", JSON.stringify(row));
    const n = await as(cafeOwner, () => rows(db.query("select title, body, link from public.notifications where type = 'ad'")));
    check(n.length === 1 && n[0].title === "The UniBuzz team drafted an ad for you" && n[0].body === "As agreed on the phone." && n[0].link === `/ads/${drafted}`, JSON.stringify(n));
    check((await as(editor, () => rows(db.query("select 1 from public.notifications where type = 'ad'")))).length === 0, "the editor was told");
    const log = await sql1("select actor_kind, actor_id from public.business_audit_log where action = 'ad_drafted_by_admin' and target_id = $1", [drafted]);
    check(log?.actor_kind === "admin" && log.actor_id === admin, JSON.stringify(log));
    const own = await as(cafeOwner, () => rows(db.query("select actor_name from public.business_audit($1, 100, null) where action = 'ad_drafted_by_admin'", [cafe])));
    check(own[0]?.actor_name === "UniBuzz team", JSON.stringify(own));
  });
  await expectError("not for a business waiting for review", () => call(admin, `public.console_create_ad('${pies}', $1::jsonb)`, [input()]), "ts:conflict:");
  await expectError("not for a business that does not exist", () => call(admin, `public.console_create_ad('${NIL}', $1::jsonb)`, [input()]), "ts:not_found:");
  await expectError("the ad trigger's rules hold: a café's ad does not run in Housing", () => call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input({ placements: ["for_you", "housing"] })]), "ts:validation_failed:Only housing ads run in Housing");
  await expectError("nor promote another business's listing", () => call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input({ promotedDealId: null, promotedApartmentId: listing })]), "ts:validation_failed:You can promote only your own business");
  await expectError("an ad names a campus", () => call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input({ universityIds: [] })]), "ts:validation_failed:Choose at least one campus");
  await expectError("a real one", () => call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input({ universityIds: ["not-a-uuid"] })]), "ts:validation_failed:");
  await expectError("and a name", () => call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input({ name: "x" })]), "ts:validation_failed:");
  await expectError("a button's link is https", () => call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input({ ctaUrl: "http://beanthere.example" })]), "ts:validation_failed:");
  await expectError("dates in order and ahead", () => call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input({ startsAt: ms(2 * DAY), endsAt: ms(DAY) })]), "ts:validation_failed:");
  await expectError("a budget that is a number", () => call(admin, `public.console_create_ad('${cafe}', $1::jsonb)`, [input({ budgetCents: "lots" })]), "ts:validation_failed:");
  await expectOk("a housing business's draft is a housing ad, in Housing only", async () => {
    const a = await call(admin, `public.console_create_ad('${rent}', $1::jsonb)`, [input({ name: "Fall leasing", promotedDealId: null, promotedApartmentId: listing, cta: "view_listing", ctaUrl: null })]);
    check(a.vertical === "housing" && JSON.stringify(a.placements) === '["housing"]', JSON.stringify(a.placements));
  });
  await expectOk("the business submits the team's draft, and the team approves it with its payment", async () => {
    await t.submit(cafeOwner, drafted);
    await t.approve(drafted, 5000, "INV-77");
    const a = await call(admin, `public.console_ad('${drafted}')`);
    check(a.status === "scheduled" && a.paidCents === 5000 && a.payments.length === 1 && a.payments[0].reference === "INV-77", JSON.stringify(a).slice(0, 300));
    check(a.history.some((h) => h.action === "ad_approved") && a.history.some((h) => h.action === "ad_drafted_by_admin"), JSON.stringify(a.history.map((h) => h.action)));
  });

  // --- Dates and budget ----------------------------------------------------------------------------------------------
  const terms = (id, starts, ends, budget, reason = "Moved at the owner's request") =>
    call(admin, "public.console_update_ad_terms($1, $2, $3, $4, $5)", [id, starts, ends, budget, reason]);
  const pay = (id) => sql1("select starts_at, ends_at from public.listing_promotions where ad_id = $1 and status = 'active' order by created_at limit 1", [id]);
  await expectError("a draft is the business's to edit", async () => {
    const d = await t.draft(cafeOwner, cafe, { name: "Their own draft" });
    await terms(d.id, ms(HOUR), ms(2 * DAY), 5000);
  }, "ts:conflict:");
  await expectError("a change says why", () => terms(drafted, ms(-HOUR), null, null, "no"), "ts:validation_failed:");
  let paid;
  await expectOk("a scheduled ad whose start moves into the past runs at once; the payment on record keeps its period; the team is told", async () => {
    paid = await pay(drafted);
    const a = await terms(drafted, ms(-HOUR), null, null);
    const row = await sql1("select status, started_at, starts_at from public.ads where id = $1", [drafted]);
    check(a.status === "active" && row.status === "active" && row.started_at !== null, JSON.stringify(row));
    const p = await pay(drafted);
    check(String(p.starts_at) === String(paid.starts_at) && String(p.ends_at) === String(paid.ends_at), `payment rewritten: ${JSON.stringify(p)} was ${JSON.stringify(paid)}`);
    check((await t.feed(ben)).some((x) => x.id === drafted), "not served");
    for (const who of [cafeOwner, editor]) {
      const n = await as(who, () => rows(db.query("select body from public.notifications where title = 'The UniBuzz team updated your ad''s dates or budget'")));
      check(n.length === 1 && n[0].body === "Moved at the owner's request", `${who}: ${JSON.stringify(n)}`);
    }
    const log = await sql1("select actor_kind, detail from public.business_audit_log where action = 'ad_terms_changed' and target_id = $1", [drafted]);
    check(log?.actor_kind === "admin" && log.detail.reason === "Moved at the owner's request" && log.detail.from && log.detail.to, JSON.stringify(log));
  });
  await expectOk("a running ad whose start moves ahead waits for it; the ledger is still not rewritten", async () => {
    const a = await terms(drafted, ms(2 * HOUR), ms(10 * DAY), 6000);
    check(a.status === "scheduled" && a.budgetCents === 6000, JSON.stringify({ s: a.status, b: a.budgetCents }));
    const p = await pay(drafted);
    check(String(p.ends_at) === String(paid.ends_at), `payment ends ${p.ends_at}, was ${paid.ends_at}`);
    check(!(await t.feed(ben)).some((x) => x.id === drafted), "served before its start");
    await terms(drafted, ms(-HOUR), null, null, "Back to running today");
  });
  await expectError("the end is ahead", () => terms(drafted, null, ms(-HOUR), null), "ts:validation_failed:");
  await expectError("and after the start", () => terms(drafted, ms(3 * DAY), ms(2 * DAY), null), "ts:validation_failed:");
  await expectError("a year at most", () => terms(drafted, ms(-HOUR), ms(400 * DAY), null), "ts:validation_failed:");
  await expectError("a budget in bounds", () => terms(drafted, null, null, -5), "ts:validation_failed:");
  await expectError("an ad that does not exist", () => terms(NIL, null, null, 100), "ts:not_found:");
  await expectError("the business still cannot change a running ad's dates itself", () => as(cafeOwner, () => db.query("update public.ads set ends_at = now() + interval '90 days' where id = $1", [drafted])), "Only a draft or a rejected ad can be edited");

  // --- Payments -----------------------------------------------------------------------------------------------------
  const record = (id, amount, reference, currency = "USD", note = null) => call(admin, "public.console_record_ad_payment($1, $2, $3, $4, $5)", [id, amount, currency, reference, note]);
  const voidPay = (id, reason = "Refunded: the business cancelled") => call(admin, "public.console_void_ad_payment($1, $2)", [id, reason]);
  let waiting;
  await expectError("an ad in review is paid when it is approved", async () => {
    waiting = (await t.draft(cafeOwner, cafe, { name: "Waiting", media: [brew] })).id;
    await t.submit(cafeOwner, waiting);
    await record(waiting, 1000, "INV-NOPE");
  }, "ts:conflict:");
  await expectOk("a further payment for a running ad: a second ledger row for the rest of the ad, the ad still served, the owner told", async () => {
    const a = await record(drafted, 2500, "INV-78", "USD", "Internal: owner disputes, likely chargeback");
    const p = await sql1("select starts_at, ends_at from public.listing_promotions where payment_reference = 'INV-78'");
    const ad = await sql1("select starts_at, ends_at from public.ads where id = $1", [drafted]);
    check(new Date(p.starts_at) > new Date(ad.starts_at) && Math.abs(new Date(p.starts_at) - Date.now()) < 60_000 && String(p.ends_at) === String(ad.ends_at),
      `a further payment pays from now to the end: ${JSON.stringify(p)} for ${JSON.stringify(ad)}`);
    check(a.paidCents === 7500 && a.payments.length === 2 && a.payments.every((p) => p.status === "active"), JSON.stringify(a.payments));
    check((await t.feed(ben)).some((x) => x.id === drafted), "not served");
    check(!(await t.feed(uma)).some((x) => x.id === drafted), "served to another campus");
    const n = await as(cafeOwner, () => rows(db.query("select link from public.notifications where title = 'Payment recorded'")));
    check(n.length === 1 && n[0].link.startsWith("/billing/"), JSON.stringify(n));
    check((await sql1("select count(*) as n from public.business_audit_log where action = 'payment_recorded'")).n == 1, "not on the log");
  });
  await expectOk("the note on a further payment is the team's: in the staff console's log, never in what the business reads", async () => {
    const staff = await sql1("select reason, metadata from public.audit_log where action = 'ad.payment_recorded'");
    check(staff?.reason === "Internal: owner disputes, likely chargeback" && staff.metadata.reference === "INV-78", JSON.stringify(staff));
    const own = await as(cafeOwner, () => rows(db.query("select detail from public.business_audit($1)", [cafe])));
    check(own.length > 0 && !JSON.stringify(own).includes("chargeback"), "the business can read the team's note");
    const notes = await as(cafeOwner, () => rows(db.query("select title, body from public.notifications")));
    check(!JSON.stringify(notes).includes("chargeback"), "a notification carries the team's note");
  });
  await expectError("a further payment is in the ad's own currency", () => record(drafted, 100, "INV-EUR-2", "EUR"), "ts:validation_failed:This ad is paid in USD");
  await expectError("a payment has an amount", () => record(drafted, 0, "INV-0"), "ts:validation_failed:");
  await expectError("a reference", () => record(drafted, 100, "x"), "ts:validation_failed:");
  await expectError("and a currency of three letters", () => record(drafted, 100, "INV-79", "dollars"), "ts:validation_failed:");
  let first, second;
  await expectOk("voiding one of two payments leaves the ad running", async () => {
    [first, second] = (await rows(db.query("select id from public.listing_promotions where ad_id = $1 order by created_at, payment_reference", [drafted]))).map((r) => r.id);
    const v = await voidPay(first);
    check(v.adEnded === false && v.payment.status === "cancelled" && typeof v.payment.cancelledAt === "number", JSON.stringify(v));
    check((await t.feed(ben)).some((x) => x.id === drafted), "stopped");
  });
  await expectOk("voiding the last ends it: completed, with the reason, and no longer served", async () => {
    const v = await voidPay(second);
    const row = await sql1("select status, status_reason from public.ads where id = $1", [drafted]);
    check(v.adEnded === true && row.status === "completed" && row.status_reason.includes("Refunded"), JSON.stringify(row));
    check(!(await t.feed(ben)).some((x) => x.id === drafted), "still served");
    check((await sql1("select count(*) as n from public.business_audit_log where action = 'payment_voided'")).n == 2, "not on the log");
    const n = await as(cafeOwner, () => rows(db.query("select 1 from public.notifications where title = 'A payment was voided'")));
    check(n.length === 2, `${n.length} notices`);
  });
  await expectError("a voided payment is voided once", () => voidPay(second), "ts:conflict:");
  await expectError("a void says why", () => voidPay(NIL, "no"), "ts:validation_failed:");
  await expectError("an ended ad takes no further payment", () => record(drafted, 1000, "INV-80"), "ts:conflict:");
  await expectError("nor new dates", () => terms(drafted, null, ms(20 * DAY), null), "ts:conflict:");
  await expectOk("the ledger: filters by standing and text, with totals", async () => {
    const all = await call(admin, "public.console_payments(null, null, null, 50, 0)");
    check(all.items.length === 2 && all.totals.count === 2 && all.totals.voidedCents === 7500 && all.totals.inForceCents === 0, JSON.stringify(all.totals));
    check(all.items[0].business?.name === "Bean There" && all.items[0].ad?.id === drafted && all.items[0].recordedBy === "Ann Avery", JSON.stringify(all.items[0]));
    const one78 = await call(admin, "public.console_payments(null, null, 'INV-78', 50, 0)");
    check(one78.items.length === 1 && one78.items[0].amountCents === 2500, JSON.stringify(one78.items));
    check((await call(admin, "public.console_payments(30, 'active', null, 50, 0)")).items.length === 0, "active ones");
    check((await call(admin, "public.console_payments(30, 'cancelled', 'bean', 1, 0)")).nextOffset === 1, "paging");
  });
  await expectError("an unknown standing is refused", () => call(admin, "public.console_payments(null, 'refunded', null, 50, 0)"), "ts:validation_failed:");

  // --- Campaign lists ---------------------------------------------------------------------------------------------------
  await expectOk("campaigns: waiting for review first; by status, business and text; counts by status", async () => {
    const all = await call(admin, "public.console_ads('all', null, null, 50, 0)");
    check(all.items[0].id === waiting && all.items[0].status === "pending_review" && all.counts.pending_review === 1 && all.counts.completed === 1, JSON.stringify(all.counts));
    check(all.items.every((a) => a.business && typeof a.paidCents === "number" && "quote" in a), "a row lacks its parts");
    const review = await call(admin, "public.console_ads('pending_review', null, null, 50, 0)");
    check(review.items.length === 1 && review.items[0].id === waiting, JSON.stringify(review.items.map((a) => a.name)));
    const rentAds = await call(admin, `public.console_ads('all', null, '${rent}', 50, 0)`);
    check(rentAds.items.length === 1 && rentAds.counts.all === 1 && rentAds.items[0].business.name === "River Rock", JSON.stringify(rentAds.counts));
    check((await call(admin, "public.console_ads('all', 'cold brew', null, 50, 0)")).items.every((a) => a.name.toLowerCase().includes("cold brew")), "search by ad name");
    check((await call(admin, "public.console_ads('all', 'river', null, 50, 0)")).items.length === 1, "search by business name");
    check((await call(admin, "public.console_ads('all', null, null, 1, 0)")).nextOffset === 1, "paging");
  });
  await expectError("an unknown status is refused", () => call(admin, "public.console_ads('lost', null, null, 50, 0)"), "ts:validation_failed:");
  await expectOk("an ad in full: problems while it is a draft, the promoted post, its numbers", async () => {
    const d = await t.draft(cafeOwner, cafe, { name: "Unfinished", caption: "", media: [] });
    const a = await call(admin, `public.console_ad('${d.id}')`);
    check(a.problems.includes("Write a caption.") && a.stats.impressions === 0 && a.draftedByTeam === false && a.business.name === "Bean There", JSON.stringify(a.problems));
    const w = await call(admin, `public.console_ad('${waiting}')`);
    check(w.problems.length === 0 && typeof w.submittedAt === "number", JSON.stringify(w.problems));
  });

  // --- The rate card and quotes -------------------------------------------------------------------------------------------
  let two, short;
  await expectOk("no rates yet: no price suggested, and the placements without one are named", async () => {
    const rates = await call(admin, "public.console_ad_rates()");
    check(rates.map((r) => r.placement).join() === "for_you,reels,housing" && rates.every((r) => r.dailyCents === null), JSON.stringify(rates));
    two = (await t.draft(cafeOwner, cafe, { name: "Two campuses", placements: ["for_you", "reels"], university_ids: [txstate, utsa], starts_at: at(HOUR), ends_at: at(HOUR + 10 * DAY) })).id;
    const q = (await call(admin, `public.console_ad('${two}')`)).quote;
    check(q.cents === null && JSON.stringify(q.missing) === '["for_you","reels"]' && q.days === 10 && q.campuses === 2, JSON.stringify(q));
  });
  await expectOk("with rates: each placement's daily rate x days x campuses, at least the highest minimum", async () => {
    await call(admin, "public.console_set_ad_rate('for_you', 500, 2000)");
    const rates = await call(admin, "public.console_set_ad_rate('reels', 300, 10000)");
    check(rates[1].dailyCents === 300 && rates[1].minimumCents === 10000 && rates[1].updatedBy === "Ann Avery", JSON.stringify(rates[1]));
    const q = (await call(admin, `public.console_ad('${two}')`)).quote;
    check(q.cents === (500 + 300) * 10 * 2 && q.lines.length === 2 && q.missing.length === 0 && q.minimumCents === 10000, JSON.stringify(q));
    short = (await t.draft(cafeOwner, cafe, { name: "One day", placements: ["for_you", "reels"], starts_at: at(HOUR), ends_at: at(HOUR + DAY) })).id;
    check((await call(admin, `public.console_ad('${short}')`)).quote.cents === 10000, "the minimum");
    const listed = (await call(admin, "public.console_ads('draft', 'two campuses', null, 50, 0)")).items[0];
    check(listed.quote.cents === 16000, JSON.stringify(listed.quote));
  });
  await expectOk("a rate taken away suggests no price again; every change is in the staff console's log", async () => {
    await call(admin, "public.console_set_ad_rate('reels', null, 0)");
    const q = (await call(admin, `public.console_ad('${two}')`)).quote;
    check(q.cents === null && JSON.stringify(q.missing) === '["reels"]', JSON.stringify(q));
    const log = await rows(db.query("select target_id, metadata from public.audit_log where action = 'ad_rate.set' order by seq"));
    check(log.length === 3 && log[2].target_id === "reels" && log[2].metadata.to === null && log[2].metadata.from.dailyCents === 300, JSON.stringify(log));
  });
  await expectError("a rate is not negative", () => call(admin, "public.console_set_ad_rate('for_you', -1, 0)"), "ts:validation_failed:");
  await expectError("nor over $10,000 a day", () => call(admin, "public.console_set_ad_rate('for_you', 2000000, 0)"), "ts:validation_failed:");
  await expectError("a minimum is not negative", () => call(admin, "public.console_set_ad_rate('for_you', 100, -5)"), "ts:validation_failed:");
  await expectError("a placement exists", () => call(admin, "public.console_set_ad_rate('stories', 100, 0)"), "ts:validation_failed:");

  // --- Re-running and the rollback ---------------------------------------------------------------------------------------
  await expectOk("nothing here depends on Business v2's tables, so its own rollbacks never wait for this one's", async () => {
    const deps = await rows(db.query(`select d.objid::regprocedure::text as f, d.refobjid::regclass::text as t from pg_depend d
      join pg_class c on c.oid = d.refobjid where d.classid = 'pg_proc'::regclass and d.refclassid = 'pg_class'::regclass
      and c.relname in ('ads', 'listing_promotions', 'businesses', 'business_events', 'business_reports', 'business_audit_log', 'deals', 'apartments')
      union all
      select p.oid::regprocedure::text, t.typname::text from pg_proc p join pg_type t on t.oid = any (p.proargtypes::oid[]) or t.oid = p.prorettype
      where p.proname like 'console\\_%' and t.typrelid <> 0`));
    check(deps.length === 0, JSON.stringify(deps));
  });
  await expectOk("the migration re-runs cleanly; rates and notes stay", async () => {
    await db.exec(read(MIGRATION));
    const rates = await call(admin, "public.console_ad_rates()");
    check(rates[0].dailyCents === 500 && (await call(admin, `public.console_business('${cafe}')`)).notes.length === 1, JSON.stringify(rates[0]));
    for (const expr of INTERNAL) check((await call(admin, expr).then(() => "allowed", (e) => e.message)).includes("permission denied"), `${expr} opened by the re-run`);
  });
  await expectError("the rollback refuses while the team's notes exist", () => db.exec(read(ROLLBACK)), "business_admin_notes holds");
  await expectError("and while the rate card holds a price", async () => {
    await db.query("delete from public.business_admin_notes");
    await db.exec(read(ROLLBACK));
  }, "ad_rates holds");
  await expectOk("emptied on purpose, it undoes the migration; Business v2 carries on; and it applies again", async () => {
    await db.query("delete from public.ad_rates");
    await db.exec(read(ROLLBACK));
    const left = await rows(db.query(`select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'console\\_analytics%' or p.proname in ('console_ads', 'console_ad', 'console_create_ad', 'console_update_ad_terms',
        'console_record_ad_payment', 'console_void_ad_payment', 'console_payments', 'console_business_overview', 'console_businesses', 'console_business',
        'console_add_business_note', 'console_ad_rates', 'console_set_ad_rate', 'console_ad_quote', 'console_ad_row_json', 'console_payment_json',
        'console_recognized_cents', 'console_require_business_admin', 'console_is_student', 'console_campus_json', 'console_like', 'console_days',
        'console_day_series', 'console_day_start', 'console_tz', 'platform_activity_snapshot'))`));
    check(left.length === 0, left.map((r) => r.f).join());
    for (const table of ["ad_rates", "business_admin_notes", "platform_activity_daily"]) check((await sql1(`select to_regclass('public.${table}') as r`)).r === null, `${table} left`);
    check((await call(admin, "public.console_queue_counts()")) !== null, "the staff console's own functions went too");
    const ads = await as(admin, () => rows(db.query("select id, status from public.admin_list_ads(null)")), MFA);
    check(ads.some((a) => a.id === drafted && a.status === "completed"), "Business v2's list");
    check(Number((await sql1("select count(*) as n from public.listing_promotions where ad_id = $1 and status = 'cancelled'", [drafted])).n) === 2, "the voided payments");
    await db.exec(read(MIGRATION));
    check((await call(admin, "public.console_ad_rates()")).length === 3 && (await call(admin, `public.console_ad('${drafted}')`)).status === "completed", "after re-applying");
  });
  await db.close();
}

// =====================================================================================================================
// 3. Production's order: CampConnect Admin's staff list (owners and admins are admins here; a suspended one is nobody)
// =====================================================================================================================
{
  const t = await setup(await boot({ live: true }));
  const { db, call, sql1, rows, admin, student, staffTable, makeStaff } = t;
  await expectOk("production's schema: the staff list is CampConnect Admin's public.staff", async () => check(staffTable === "staff", staffTable));
  const owner = await student("olive.owner@txstate.edu", "Olive Owner");
  await db.query("select public.grant_role($1, 'admin')", [owner]);
  await makeStaff(owner, "owner");
  const mod = await student("max.mod@txstate.edu", "Max Moderator");
  await makeStaff(mod, "moderator");
  const benched = await student("bo.benched@txstate.edu", "Bo Benched");
  await db.query("select public.grant_role($1, 'admin')", [benched]);
  await makeStaff(benched, "admin");
  const noRole = await student("nia.norole@txstate.edu", "Nia Norole");
  await makeStaff(noRole, "admin");
  const [, cafe] = await t.business("hi@beanthere.example", "Bean There", "food");
  await expectOk("an admin and an owner of the staff, with the role and a second factor, use both sections", async () => {
    for (const who of [admin, owner]) {
      for (const expr of ANALYTICS) await call(who, expr);
      await call(who, "public.console_businesses(null, null, 30, 0)");
      await call(who, `public.console_business('${cafe}')`);
    }
  });
  await expectOk("a moderator of the staff: not found", async () => {
    for (const expr of [...ANALYTICS, ...businessCalls(cafe)]) check((await call(mod, expr).then(() => "allowed", (e) => e.message)).includes("ts:not_found:"), expr);
  });
  await expectOk("a staff admin without the role: the analytics, not the business tools", async () => {
    await call(noRole, ANALYTICS[0]);
    check((await call(noRole, businessCalls(cafe)[1]).then(() => "allowed", (e) => e.message)).includes("ts:forbidden:"), "business tools allowed");
  });
  await expectOk("a suspended staff admin is nobody", async () => {
    await call(benched, ANALYTICS[0]);
    await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'Lost laptop, under review')", [benched]);
    for (const expr of [ANALYTICS[0], businessCalls(cafe)[1]]) check((await call(benched, expr).then(() => "allowed", (e) => e.message)).includes("ts:not_found:"), expr);
  });
  await expectOk("the team's own records go to CampConnect Admin's log there (staff_audit_log, with the actor's email), not the console's", async () => {
    await call(admin, `public.console_add_business_note('${cafe}', 'Spoke to the owner about the renewal.')`);
    await call(admin, "public.console_set_ad_rate('reels', 900, 0)");
    const logged = await rows(db.query("select action, actor_email, target_type, details from public.staff_audit_log where action in ('business.note', 'ad_rate.set') order by id"));
    check(logged.length === 2 && logged.every((r) => r.actor_email) && logged[0].action === "business.note" && logged[1].details.to?.dailyCents === 900, JSON.stringify(logged));
    check(Number((await sql1("select count(*) as n from public.audit_log where action in ('business.note', 'ad_rate.set')")).n) === 0, "also in the console's log");
    await db.query("delete from public.ad_rates");
  });
  await expectOk("the numbers work on production's schema too", async () => {
    const o = await call(admin, "public.console_analytics_overview(7, null)");
    // Students: the moderator and the staff admin without the role (the others have the admin role).
    check(o.range.days === 7 && o.totals.students === 2 && o.totals.businessAccounts === 1, JSON.stringify(o.totals));
    check((await call(admin, "public.console_analytics_revenue(7)")).totals.bookedCents === 0, "revenue");
  });
  await db.close();
}

done("CONSOLE BUSINESS");
