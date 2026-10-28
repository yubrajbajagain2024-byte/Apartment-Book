// The production rollout, rehearsed offline: a database in production's state as of 2026-10-28 (production's migration
// order, the migrations applied outside this repo, and neither 44, 46 nor 47), with v1 business data in it; then what
// `npm run db:setup` would apply, in file order (44, 46, 47, 49, 50, Buzz's 51 to 54, 55, 56, 57), with checks after; then every one of their
// rollbacks in reverse order; then all of them again. A real staging project is still the place to try it for real
// (docs/migrations.md); this shows the files themselves apply, undo and re-apply cleanly in that order.
import { boot, read, expectOk, done } from "./harness.mjs";

const PENDING = [
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
  "20261110000000_report_auto_hide.sql",
];
const { db, mk, as } = await boot({ live: true, skip: PENDING });
const one = async (p) => (await p).rows[0];
const signUp = async (email, meta) => (await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify(meta)])).rows[0].id;
const confirm = (id) => db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
const has = async (sql) => Boolean((await one(db.query(sql))).ok);

// v1 data, as production has it.
const admin = await mk("ops@txstate.edu", "Ops Admin");
const ben = await mk("ben@txstate.edu", "Ben Brooks");
await db.query("select public.grant_role($1, 'admin')", [admin]);
const txstate = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const owner = await signUp("hi@riverrock.example", { account_type: "business", full_name: "Rita Rock", business_name: "River Rock", business_category: "housing", business_university_id: txstate });
await confirm(owner);
const business = (await one(db.query("select id from public.businesses where owner_id = $1", [owner]))).id;
await as(admin, () => db.query("select public.admin_review_business($1, 'approved', null)", [business]));
const apt = (await as(owner, () => one(db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id) values ($1, $2, 'Two-bed', 'Pool', 1200, '1 River Rd', $3) returning id", [owner, business, txstate])))).id;
await as(admin, () => db.query("select public.admin_record_promotion('apartment', $1, now() - interval '1 day', now() + interval '6 days', 5000, 'USD', 'INV-1')", [apt]));
const invite = await as(owner, () => one(db.query("select * from public.business_invite_create('leasing@riverrock.example')")));
const staff = await signUp("leasing@riverrock.example", { account_type: "business", full_name: "Lee Leasing", business_invite: invite.token });
await confirm(staff);
const chat = (await as(ben, () => one(db.query("select public.start_business_inquiry('apartment', $1) as id", [apt])))).id;
await as(ben, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Still free?')", [chat, ben]));
await as(ben, () => db.query("insert into public.feed_posts (author_id, kind, body, university_id) values ($1, 'post', 'Move-in day #txst', $2)", [ben, txstate]));

const sponsored = async () => (await one(db.query("select public.listing_sponsored(a) as ok from public.apartments a where id = $1", [apt]))).ok;
const staffRole = async () => (await one(db.query("select role from public.business_members where user_id = $1", [staff]))).role;

await expectOk("before: production's state, v1 rules in force (staff on the team, the listing Sponsored)", async () => {
  if ((await staffRole()) !== "staff" || !(await sponsored())) throw new Error("v1 data not as expected");
  if (await has("select to_regclass('public.ads') is not null as ok")) throw new Error("ads already there");
});

async function applyAll(round) {
  for (const f of PENDING) await expectOk(`${round}: ${f} applies`, () => db.exec(read(`migrations/${f}`)));
  await expectOk(`${round}: afterwards, Discover ranks (44 + 46), anonymous listings exist (47), the staffer is an editor (49), the promotion is a running paid ad and the listing is still Sponsored (50), buzzes take a category (54), media are guarded (55)`, async () => {
    await db.query("select public.discover_refresh()");
    if (!(await has("select exists (select 1 from information_schema.columns where table_name = 'roommate_posts' and column_name = 'is_anonymous') as ok"))) throw new Error("47 missing");
    if ((await staffRole()) !== "editor") throw new Error(`staff is ${await staffRole()}`);
    const ad = await one(db.query("select status, vertical, placements from public.ads where promoted_apartment_id = $1", [apt]));
    if (ad?.status !== "active" || ad.vertical !== "housing" || !(await sponsored())) throw new Error(JSON.stringify(ad));
    if (!(await has("select exists (select 1 from information_schema.columns where table_name = 'buzz_posts' and column_name = 'category') as ok"))) throw new Error("54 missing");
    if (!(await has("select exists (select 1 from pg_trigger where tgname = 'media_server_fields') as ok"))) throw new Error("55 missing");
  });
  await expectOk(`${round}: messaging rules hold: the student and the editor talk; the business still cannot start a chat or write first`, async () => {
    await as(staff, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Yes!')", [chat, staff]));
    let refused = false;
    try { await as(owner, () => db.query("select public.get_or_create_direct_conversation($1)", [ben])); } catch (e) { refused = e.message.includes("only reply"); }
    if (!refused) throw new Error("a business opened a chat");
  });
}

await applyAll("first rollout");

const ROLLBACKS = [...PENDING].reverse().map((f) => `rollbacks/${f.replace(/\.sql$/, ".down.sql")}`);
for (const r of ROLLBACKS) await expectOk(`rollback: ${r} runs`, () => db.exec(read(r)));
await expectOk("after every rollback: v1 again (staff, the listing Sponsored through its v1 promotion, no ads or Business v2 functions)", async () => {
  if ((await staffRole()) !== "staff" || !(await sponsored())) throw new Error("v1 not restored");
  if (await has("select to_regclass('public.ads') is not null or to_regprocedure('public.business_can(uuid, text)') is not null as ok")) throw new Error("v2 left behind");
  if (!(await has("select to_regprocedure('public.business_invite_create(text)') is not null as ok"))) throw new Error("v1 invite function missing");
  await as(staff, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Back on v1')", [chat, staff]));
});

await applyAll("second rollout");

done("PRODUCTION ROLLOUT (44, 46, 47, 49 TO 57)");
