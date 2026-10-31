// The production rollout, rehearsed offline: a database in production's state as of 2026-10-30 (production's migration
// order, the migrations applied outside this repo, 47 applied on 2026-10-27 although 44 and 46 were not, 58 applied on
// its own on 2026-10-30, and 59 after it, alone too), with v1 business data in it; then what `npm run db:setup` would apply (44, 46, 49, 50, Buzz's
// 51 to 54, 55, 56, 57: 44 and 46 after 47 and 58, as production will), with checks after.
// Then the release's own rollback, the business migrations only (57, 56, 55, 50, 49): every Buzz object and Buzz row stays
// exactly as it was, Buzz still works, and the schema matches a database that never had the business migrations. Then
// the business migrations again; then every rollback in reverse order; then all of them again. The staging rehearsal
// (supabase/tests/staging/release-rehearsal.mjs) does the same on a real project.
import { boot, read, expectOk, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION, BUZZ_CATEGORIES } from "../../packages/shared/src/buzz/constants.ts";
import { catalog, diffCatalogs, isBuzz, BUZZ_DATA_SQL, DATA_HELPER_SQL, DROP_DATA_HELPER_SQL } from "./catalog.mjs";

// 61 (Events) goes to production on its own, ahead of this release, like 58 to 60 did (events-rollout.test.mjs): it is
// left out here so the database starts in production's state as it is.
const AHEAD = ["20261113000000_events.sql"];
const PENDING = [
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
];
// The release's rollback: the business migrations (57 included), newest first. Buzz's 51 to 54 stay.
const BUSINESS = ["20261107000000_business_teams.sql", "20261107000100_business_ads.sql", "20261109000000_media_server_fields.sql", "20261109000100_business_hardening.sql", "20261110000000_business_hours.sql"];
const BUSINESS_ROLLBACKS = [...BUSINESS].reverse().map((f) => `rollbacks/${f.replace(/\.sql$/, ".down.sql")}`);
const { db, mk, as, asService } = await boot({ live: true, skip: [...PENDING, ...AHEAD] });
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

await expectOk("before: production's state (47 and 58 applied, 44 and 46 not), v1 rules in force (staff on the team, the listing Sponsored)", async () => {
  if ((await staffRole()) !== "staff" || !(await sponsored())) throw new Error("v1 data not as expected");
  if (await has("select to_regclass('public.ads') is not null as ok")) throw new Error("ads already there");
  if (!(await has("select exists (select 1 from information_schema.columns where table_name = 'roommate_posts' and column_name = 'is_anonymous') as ok"))) throw new Error("47 is not applied");
  if (!(await has("select to_regclass('public.stories') is not null as ok"))) throw new Error("58 is not applied");
});

async function applyAll(round, files = PENDING) {
  for (const f of files) await expectOk(`${round}: ${f} applies`, () => db.exec(read(`migrations/${f}`)));
  await expectOk(`${round}: afterwards, Discover ranks (44 + 46), anonymous listings still work (47), the staffer is an editor (49), the promotion is a running paid ad and the listing is still Sponsored (50), buzzes take a category (54), media are guarded (55)`, async () => {
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

// --- The release's rollback (business migrations only) leaves Buzz alone ------------------------------------------------
const val = async (p) => { const row = (await p).rows[0]; return row ? row[Object.keys(row)[0]] : undefined; };
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, min_campus_size = 1");
const cam = await mk("cam@txstate.edu", "Cam Cruz");
for (const uid of [ben, cam]) {
  await db.query("update public.profiles set university_id = $2, created_at = now() - interval '30 days' where id = $1", [uid, txstate]);
  await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [BUZZ_GUIDELINES_VERSION]));
}
const buzzCall = (uid, fn, args) => as(uid, () => val(db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)));
const buzzWrite = async (uid, sql, args) => { await db.query("delete from public.buzz_rate_log where user_id = $1", [uid]); return asService(() => val(db.query(sql, args))); };
const category = BUZZ_CATEGORIES[0].value;
const thread = await buzzWrite(ben, "select public.buzz_v2_create($1, $2::jsonb, 'active', false, null) as r", [ben, JSON.stringify({ text: "Best study spot on campus?", category })]);
const reply = await buzzWrite(cam, "select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null) as r", [cam, thread.id, JSON.stringify({ text: "Third floor of the library" })]);
await buzzWrite(ben, "select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null) as r", [ben, thread.id, JSON.stringify({ text: "Which side?", parentId: reply.id })]);
const prompt = (await db.query("select * from public.buzz_v2_today_prompt()")).rows[0];
const promptThread = await buzzCall(cam, "buzz_v2_prompt_thread", [prompt.prompt_id, "campus"]);

const buzzState = async () => {
  await db.exec(DATA_HELPER_SQL);
  const data = await val(db.query(BUZZ_DATA_SQL));
  await db.exec(DROP_DATA_HELPER_SQL);
  return { catalog: await catalog(async (q) => (await db.query(q)).rows), data };
};
const buzzWorks = async () => {
  const feed = await buzzCall(cam, "buzz_v2_feed", ["campus", "new", "day", null, 50, 0, null]);
  const item = feed.items.find((b) => b.id === thread.id);
  if (!item || item.category !== category || !("topReply" in item)) throw new Error(`feed: ${JSON.stringify(item)}`);
  const replies = await buzzCall(cam, "buzz_v2_replies", [thread.id, 0, 50]);
  if (!JSON.stringify(replies).includes(`"treeParentId":"${reply.id}"`)) throw new Error("the nested reply lost its parent");
  const meta = await buzzCall(cam, "buzz_v2_meta", ["campus"]);
  if (meta.prompt.threadId !== promptThread) throw new Error(`prompt thread: ${JSON.stringify(meta.prompt)}`);
};
const before = await buzzState();
await expectOk("with every pending migration applied, Buzz works: categories, the reply tree, top replies, today's prompt thread", buzzWorks);

for (const r of BUSINESS_ROLLBACKS) await expectOk(`release rollback: ${r} runs (Buzz's 51 to 54 stay)`, () => db.exec(read(r)));
await expectOk("after the release rollback: every Buzz table, column, constraint, index, trigger, policy, grant and function is as it was, and so is every Buzz row", async () => {
  const after = await buzzState();
  const changed = diffCatalogs(before.catalog, after.catalog, isBuzz);
  if (changed.length) throw new Error(changed.join("; "));
  const rows = Object.keys({ ...before.data, ...after.data }).filter((t) => before.data[t] !== after.data[t]);
  if (rows.length) throw new Error(`rows changed in ${rows.join(", ")}`);
});
await expectOk("after the release rollback: Buzz still works", buzzWorks);
await expectOk("after the release rollback: v1 business rules again (staff, the listing Sponsored through its v1 promotion, no ads, the business still cannot write first)", async () => {
  if ((await staffRole()) !== "staff" || !(await sponsored())) throw new Error("v1 not restored");
  if (await has("select to_regclass('public.ads') is not null or to_regprocedure('public.business_can(uuid, text)') is not null or exists (select 1 from pg_trigger where tgname = 'media_server_fields') as ok")) throw new Error("v2 left behind");
  let refused = false;
  try { await as(owner, () => db.query("select public.get_or_create_direct_conversation($1)", [ben])); } catch (e) { refused = e.message.includes("only reply"); }
  if (!refused) throw new Error("a business opened a chat");
});
await expectOk("after the release rollback: the schema is exactly that of a database that never had 49, 50, 55 or 56 (44, 46, 47 and 51 to 54 only)", async () => {
  const reference = await boot({ live: true, skip: [...BUSINESS, ...AHEAD] });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  await reference.db.close();
  if (changed.length) throw new Error(changed.join("; "));
});

await applyAll("release re-applied", BUSINESS);
await expectOk("after re-applying the release: Buzz is still exactly as it was, and works", async () => {
  const after = await buzzState();
  const changed = diffCatalogs(before.catalog, after.catalog, isBuzz);
  if (changed.length) throw new Error(changed.join("; "));
  if (JSON.stringify(after.data) !== JSON.stringify(before.data)) throw new Error("Buzz rows changed");
  await buzzWorks();
});

const ROLLBACKS = [...PENDING].reverse().map((f) => `rollbacks/${f.replace(/\.sql$/, ".down.sql")}`);
for (const r of ROLLBACKS) await expectOk(`rollback: ${r} runs`, () => db.exec(read(r)));
await expectOk("after every rollback: v1 again (staff, the listing Sponsored through its v1 promotion, no ads or Business v2 functions)", async () => {
  if ((await staffRole()) !== "staff" || !(await sponsored())) throw new Error("v1 not restored");
  if (await has("select to_regclass('public.ads') is not null or to_regprocedure('public.business_can(uuid, text)') is not null as ok")) throw new Error("v2 left behind");
  if (!(await has("select to_regprocedure('public.business_invite_create(text)') is not null as ok"))) throw new Error("v1 invite function missing");
  await as(staff, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Back on v1')", [chat, staff]));
});

await applyAll("second rollout");

done("PRODUCTION ROLLOUT (44, 46, 49 TO 57 AFTER 47 AND 58)");
