// Anonymous listings, listing audiences and anonymous inquiry chats (20261105000000_anonymous_listings.sql) against
// PGlite, twice: on this repo's migrations alone and on production's schema (with the migrations applied outside this
// repo, where they ran). Each run starts just before the migration, records the schema, applies it, and checks:
// posting anonymously (the row keeps no poster, only the poster can read who it is, nobody can post as someone else or
// change it afterwards), each audience per kind of viewer with and without anonymity, blocks and suspensions without a
// way to test a guess, what the poster can still do (see, change, delete, numbers, notifications) and may not (like or
// save their own), listing_owner() and the private helpers, the reels feed and profile stats, shared cards; then the
// inquiry chat: who may open it, what each side sees of the other, how the poster's messages are stored and announced,
// unread counts, what the chat refuses while the poster is hidden (files, Snaps, calls, private cards, leaving), the
// helpers that must not answer a guess (is_conversation_member, activity_status, Snap recipients), blocks both ways,
// and showing who they are to one person only; staff resolving the poster; a deleted account; and that the rollback
// refuses while any of it exists, otherwise puts the schema back exactly as it was, after which the migration applies
// again.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, ok, fail, expectOk, expectError, done } from "./harness.mjs";

const NAME = "20261105000000_anonymous_listings.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261105000000_anonymous_listings.down.sql";
const BEFORE = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const VIDEO = JSON.stringify([{ media_id: "00000000-0000-4000-8000-000000000001", playback_id: "pb1abcdef", poster_url: null, width: 1080, height: 1920, duration_seconds: 5 }]);
const check = (cond, message) => { if (!cond) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const outcome = async (fn) => { try { await fn(); return "ok"; } catch (e) { return e.message; } };
const expectRefused = async (name, fn, message, code = "42501") => {
  try { await fn(); fail(name, "no error"); } catch (e) { if (e.message.includes(message) && (!code || e.code === code)) ok(name); else fail(name, `${e.code}: ${e.message}`); }
};

const fingerprint = async (db) => (await db.query(`
  select 'column ' || table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as x
    from information_schema.columns where table_schema in ('public', 'storage', 'auth')
  union all
  select 'constraint ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'trigger ' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
  union all
  select 'policy ' || schemaname || '.' || tablename || '.' || policyname || ' ' || permissive || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') from pg_policies
  union all
  select 'function ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(p.proconfig::text, '') || ' ' || coalesce(p.proacl::text, '') || ' ' || pg_get_function_result(p.oid)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'table ' || c.oid::regclass::text || ' ' || coalesce(c.relacl::text, '') from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'i')
  order by 1`)).rows.map((r) => r.x);
const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => `- ${x}`), ...b.filter((x) => !a.includes(x)).map((x) => `+ ${x}`)].join("\n");

async function suite(label, live) {
  const { db, mk, as, asAnon } = await boot({ live, upTo: BEFORE });
  const t = (name) => `${label}: ${name}`;
  const one = async (p) => (await p).rows[0];
  const run = (who, fn) => (who ? as(who, fn) : asAnon(fn));
  const before = await fingerprint(db);
  await expectOk(t(`the migration applies after ${BEFORE} and re-runs cleanly`), async () => { await db.exec(read(MIGRATION)); await db.exec(read(MIGRATION)); });

  const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
  const UT = (await one(db.query("select id from public.universities where name = 'University of Texas at Austin'"))).id;
  await db.query("update public.universities set email_domain = 'utexas.edu' where id = $1", [UT]);
  const ANN = await mk("ann@txstate.edu", "Ann Poster"); // posts anonymously
  const CARA = await mk("cara@txstate.edu", "Cara Campus"); // Ann's campus, no follows: writes to Ann
  const OLI = await mk("oli@utexas.edu", "Oli Other"); // another campus
  const FAY = await mk("fay@utexas.edu", "Fay Friend"); // follows Ann and is followed back
  const BO = await mk("bo@txstate.edu", "Bo Blocked"); // Ann blocked him
  const VIC = await mk("vic@txstate.edu", "Vic Blocker"); // has blocked Ann (without knowing she posted anything)
  const follow = (a, b) => as(a, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [a, b]));
  await follow(FAY, ANN); await follow(ANN, FAY);
  await as(ANN, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [ANN, BO]));
  await as(VIC, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [VIC, ANN]));

  /** A roommate post or an item by `uid` (cols added), the row the insert hands back to its poster. */
  const roommate = (uid, cols = {}) => {
    const all = { author_id: uid, post_type: "needs_room", title: "Room wanted", description: "Quiet student looking for a room near campus.", ...cols };
    const keys = Object.keys(all);
    return as(uid, () => one(db.query(`insert into public.roommate_posts (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(all))));
  };
  const item = (uid, cols = {}) => {
    const all = { seller_id: uid, title: "Desk lamp", description: "Works well, small scratch.", price: 15, category: "furniture", ...cols };
    const keys = Object.keys(all);
    return as(uid, () => one(db.query(`insert into public.items (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(all))));
  };

  // --- Posting ------------------------------------------------------------------------------------------------------
  await expectOk(t("defaults: a plain roommate post and item are Global, not anonymous, under their poster"), async () => {
    const r = await roommate(ANN, { title: "Plain post" });
    const i = await item(ANN, { title: "Plain item" });
    check(r.is_anonymous === false && r.audience === "global" && r.author_id === ANN, JSON.stringify(r));
    check(i.is_anonymous === false && i.audience === "global" && i.seller_id === ANN, JSON.stringify(i));
  });
  let ANON_R, ANON_I;
  await expectOk(t("anonymous: the row comes back with no poster; the poster table names Ann; only she can read it"), async () => {
    ANON_R = await roommate(ANN, { title: "Anon room", is_anonymous: true, videos: VIDEO });
    ANON_I = await item(ANN, { title: "Anon lamp", is_anonymous: true });
    check(ANON_R.author_id === null && ANON_R.is_anonymous && ANON_I.seller_id === null && ANON_I.is_anonymous, JSON.stringify([ANON_R, ANON_I]));
    const owners = (await db.query("select owner_id, roommate_post_id, item_id from public.anonymous_listing_owners")).rows;
    check(owners.length === 2 && owners.every((o) => o.owner_id === ANN), JSON.stringify(owners));
    const mine = (await as(ANN, () => db.query("select roommate_post_id, item_id from public.anonymous_listing_owners"))).rows;
    check(mine.length === 2, `Ann reads ${mine.length}`);
    const cara = (await as(CARA, () => db.query("select * from public.anonymous_listing_owners"))).rows;
    check(cara.length === 0, `Cara reads ${cara.length}`);
  });
  await expectError(t("signed out, the poster table is not readable at all"), () => asAnon(() => db.query("select * from public.anonymous_listing_owners")), "permission denied");
  await expectError(t("an anonymous listing must arrive with its poster"), () => roommate(ANN, { author_id: null, is_anonymous: true }), "still needs its poster");
  await expectRefused(t("nobody posts anonymously as someone else"), () => as(ANN, () => db.query("insert into public.items (seller_id, title, description, price, category, is_anonymous) values ($1, 'x', 'yyyyyyyyyy', 1, 'furniture', true)", [CARA])), "only post as yourself");
  await expectOk(t("a listing that is not anonymous still needs its poster"), async () => {
    const o = await outcome(() => as(ANN, () => db.query("insert into public.items (seller_id, title, description, price, category) values (null, 'x', 'yyyyyyyyyy', 1, 'furniture')")));
    check(o.includes("row-level security") || o.includes("items_poster_check"), o);
  });
  for (const [what, sql] of [
    ["made public", "update public.roommate_posts set is_anonymous = false, author_id = $2 where id = $1"],
    ["given a poster", "update public.roommate_posts set author_id = $2 where id = $1"],
  ]) {
    await expectOk(t(`an anonymous listing cannot be ${what}`), async () => {
      const o = await outcome(() => as(ANN, () => db.query(sql, [ANON_R.id, ANN])));
      check(o.includes("can't be changed"), o);
      const row = await one(db.query("select author_id, is_anonymous from public.roommate_posts where id = $1", [ANON_R.id]));
      check(row.author_id === null && row.is_anonymous, JSON.stringify(row));
    });
  }
  await expectRefused(t("a public listing cannot be made anonymous later"), async () => {
    const p = await roommate(ANN, { title: "Turn anon" });
    await as(ANN, () => db.query("update public.roommate_posts set is_anonymous = true where id = $1", [p.id]));
  }, "can't be changed");
  await expectOk(t("profile delete of an anonymous poster takes the anonymous listing with it"), async () => {
    const zed = await mk("zed@txstate.edu", "Zed Gone");
    const z = await item(zed, { title: "Zed's anon", is_anonymous: true });
    await db.query("delete from public.profiles where id = $1", [zed]);
    check(!(await one(db.query("select exists (select 1 from public.items where id = $1) as e", [z.id]))).e, "still there");
  });
  await expectError(t("business accounts cannot post anonymous listings"), async () => {
    const meta = { account_type: "business", full_name: "Rita Rock", business_name: "River Rock Apartments", business_category: "housing", business_university_id: TX, business_phone: "512-555-0100", business_website: "https://riverrock.example" };
    const biz = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('hello@riverrock.example', $1, now()) returning id", [JSON.stringify(meta)]))).id;
    check((await one(db.query("select public.is_business_account($1) as b", [biz]))).b, "not a business account");
    await item(biz, { title: "Biz anon", is_anonymous: true });
  }, "Business");

  // --- Audience -----------------------------------------------------------------------------------------------------
  for (const audience of ["everyone", "selected", "Global"]) {
    // Without "returning": the new row is checked against the select policies first, which refuse it as well.
    await expectError(t(`audience '${audience}' is refused`), () => as(ANN, () => db.query("insert into public.roommate_posts (author_id, post_type, title, description, audience, university_id) values ($1, 'needs_room', 'Room wanted', 'Quiet student looking for a room.', $2, $3)", [ANN, audience, TX])), "audience_check");
  }
  await expectRefused(t("a campus listing needs a university (its poster's verified campus)"), () => roommate(ANN, { audience: "campus" }), "own campus");
  await expectError(t("…and a campus listing's university cannot be removed (the check)"), async () => {
    const r = await roommate(ANN, { audience: "campus", university_id: TX, is_anonymous: true });
    await as(ANN, () => db.query("update public.roommate_posts set audience = 'campus', university_id = null where id = $1", [r.id]));
  }, "own campus");
  await expectRefused(t("a campus listing is for the poster's own verified campus"), () => item(ANN, { audience: "campus", university_id: UT }), "own campus");
  await expectRefused(t("…also when anonymous (the check sees the poster before the row loses them)"), () => item(ANN, { audience: "campus", university_id: UT, is_anonymous: true }), "own campus");
  await expectOk(t("an anonymous friends-only listing comes back to its poster on insert (returning)"), async () => {
    const r = await roommate(ANN, { title: "Anon friends returning", is_anonymous: true, audience: "friends", university_id: TX });
    check(r.author_id === null && r.audience === "friends", JSON.stringify(r));
  });

  // The matrix: per kind, audience and anonymity, all at Ann's campus.
  const IDS = [];
  for (const anonymous of [false, true]) for (const audience of ["global", "campus", "friends"]) {
    const tag = `${anonymous ? "anon" : "named"} ${audience}`;
    IDS.push((await roommate(ANN, { title: `R ${tag}`, is_anonymous: anonymous, audience, university_id: TX })).id);
    IDS.push((await item(ANN, { title: `I ${tag}`, is_anonymous: anonymous, audience, university_id: TX })).id);
  }
  const seen = (who) => run(who, () => db.query("select title, coalesce(author_id::text, '-') as poster from public.roommate_posts where id = any($1::uuid[]) union all select title, coalesce(seller_id::text, '-') from public.items where id = any($1::uuid[]) order by 1", [IDS])).then((r) => r.rows);
  const titles = (rows) => rows.map((r) => r.title).sort();
  const want = (audiences, kinds = ["anon", "named"]) => ["R", "I"].flatMap((k) => kinds.flatMap((a) => audiences.map((x) => `${k} ${a} ${x}`))).sort();
  for (const [name, who, audiences] of [
    ["the poster", ANN, ["global", "campus", "friends"]],
    ["a stranger at the same campus", CARA, ["global", "campus"]],
    ["a stranger at another campus", OLI, ["global"]],
    ["a friend at another campus", FAY, ["global", "friends"]],
    ["signed out", null, ["global"]],
  ]) {
    await expectOk(t(`select: ${name} sees ${audiences.join(", ")}, and no poster on any anonymous one`), async () => {
      const rows = await seen(who);
      check(same(titles(rows), want(audiences)), JSON.stringify(titles(rows)));
      check(rows.filter((r) => r.title.includes(" anon ")).every((r) => r.poster === "-"), JSON.stringify(rows));
      check(rows.filter((r) => r.title.includes(" named ")).every((r) => r.poster === ANN), JSON.stringify(rows));
    });
  }

  // --- Blocks and suspensions ---------------------------------------------------------------------------------------
  await expectOk(t("blocks: someone the poster blocked sees none of her anonymous listings"), async () => {
    check(same(titles(await seen(BO)), []), JSON.stringify(titles(await seen(BO))));
  });
  await expectOk(t("blocks: someone who blocked the poster still sees her anonymous listings (their own blocks would name her)"), async () => {
    check(same(titles(await seen(VIC)), want(["global", "campus"], ["anon"])), JSON.stringify(titles(await seen(VIC))));
  });
  await expectOk(t("…and may like one (the like policy's block check skips anonymous listings)"), async () => {
    await as(VIC, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('item', $1, $2)", [ANON_I.id, VIC]));
  });
  if (live) {
    await expectOk(t("suspension: a suspended poster's anonymous listings disappear for others, stay for her, and come back when lifted"), async () => {
      const r = await one(db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'testing anonymity') returning id", [ANN]));
      check(!titles(await seen(CARA)).some((x) => x.includes(" anon ")), "still shown while suspended");
      check(titles(await seen(ANN)).length === 12, "Ann lost hers");
      await db.query("update public.account_restrictions set lifted_at = now() where id = $1", [r.id]);
      check(same(titles(await seen(CARA)), want(["global", "campus"])), "not back");
    });
  }

  // --- The poster's powers ------------------------------------------------------------------------------------------
  await expectOk(t("listing_owner(): the poster gets herself, anyone else null (signed out too)"), async () => {
    const q = (who) => run(who, () => one(db.query("select public.listing_owner('roommate', $1) as r, public.listing_owner('item', $2) as i", [ANON_R.id, ANON_I.id])));
    const a = await q(ANN), c = await q(CARA), s = await q(null);
    check(a.r === ANN && a.i === ANN && c.r === null && c.i === null && s.r === null && s.i === null, JSON.stringify([a, c, s]));
  });
  for (const fn of ["anonymous_listing_owner('item', $1)", "listing_poster('item', $1)", "can_see_listing_as(null, 'item', $1, null, 'global', null)", "anonymous_chat_poster($1)"]) {
    await expectError(t(`${fn.split("(")[0]}() is not for API roles`), () => as(CARA, () => db.query(`select public.${fn}`, [ANON_I.id])), "permission denied");
  }
  await expectOk(t("listing_stats(): the poster reads her anonymous listing's numbers; nobody else does"), async () => {
    await as(CARA, () => db.query("select public.record_view('item', $1)", [ANON_I.id]));
    await as(ANN, () => db.query("select public.record_view('item', $1)", [ANON_I.id]));
    const views = (await one(db.query("select count(*)::int as n from public.post_views where target_type = 'item' and target_id = $1", [ANON_I.id]))).n;
    check(views === 1, `views ${views} (Cara's counts, Ann's own does not)`);
    const mine = await as(ANN, () => one(db.query("select views::int from public.listing_stats('item', $1)", [ANON_I.id])));
    check(mine?.views === 1, JSON.stringify(mine));
    const theirs = await outcome(() => as(CARA, () => db.query("select * from public.listing_stats('item', $1)", [ANON_I.id])));
    check(theirs.includes("Only the owner"), theirs);
  });
  await expectOk(t("likes and saves of an anonymous listing reach its poster as notifications (from the liker)"), async () => {
    await as(CARA, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('roommate', $1, $2)", [ANON_R.id, CARA]));
    await as(CARA, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('roommate', $1, $2)", [ANON_R.id, CARA]));
    const n = (await db.query("select type, actor_id from public.notifications where user_id = $1 and data ->> 'target_id' = $2 order by type", [ANN, ANON_R.id])).rows;
    check(same(n.map((x) => x.type), ["like", "listing_saved"]) && n.every((x) => x.actor_id === CARA), JSON.stringify(n));
  });
  await expectRefused(t("the poster cannot like her own anonymous listing"), () => as(ANN, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('roommate', $1, $2)", [ANON_R.id, ANN])), "your own anonymous listing");
  await expectRefused(t("…nor save it"), () => as(ANN, () => db.query("insert into public.saved_listings (target_type, target_id, user_id) values ('item', $1, $2)", [ANON_I.id, ANN])), "your own anonymous listing");
  await expectOk(t("profile_stats(): likes on anonymous listings never count toward the poster's total"), async () => {
    const s = await as(CARA, () => one(db.query("select likes_received::int as n from public.profile_stats($1)", [ANN])));
    check(s.n === 0, JSON.stringify(s));
  });
  await expectOk(t("reels_feed(): an anonymous roommate video is not in Reels, a named one is"), async () => {
    const named = await roommate(ANN, { title: "Named tour", videos: VIDEO });
    const got = (await as(CARA, () => db.query("select source_id from public.reels_feed(null, 30, 0) where source_type = 'roommate'"))).rows.map((r) => r.source_id);
    check(got.includes(named.id) && !got.includes(ANON_R.id), JSON.stringify(got));
  });
  await expectOk(t("the poster changes and deletes her anonymous listing; others cannot touch it"), async () => {
    const tmp = await item(ANN, { title: "Anon to sell", is_anonymous: true });
    const cara = await as(CARA, () => db.query("update public.items set price = 1 where id = $1", [tmp.id]));
    check(cara.affectedRows === 0, "Cara changed it");
    await as(ANN, () => db.query("update public.items set status = 'sold' where id = $1", [tmp.id]));
    check((await one(db.query("select status from public.items where id = $1", [tmp.id]))).status === "sold", "not sold");
    const r = await roommate(ANN, { title: "Anon inactive", is_anonymous: true });
    await as(ANN, () => db.query("update public.roommate_posts set is_active = false where id = $1", [r.id]));
    check((await as(ANN, () => db.query("select id from public.roommate_posts where id = $1", [r.id]))).rows.length === 1, "Ann lost her inactive post");
    check((await as(CARA, () => db.query("select id from public.roommate_posts where id = $1", [r.id]))).rows.length === 0, "Cara sees an inactive post");
    const del = await as(CARA, () => db.query("delete from public.items where id = $1", [tmp.id]));
    check(del.affectedRows === 0, "Cara deleted it");
    await as(ANN, () => db.query("delete from public.items where id = $1", [tmp.id]));
    await as(ANN, () => db.query("delete from public.roommate_posts where id = $1", [r.id]));
    check(!(await one(db.query("select exists (select 1 from public.anonymous_listing_owners where item_id = $1) as e", [tmp.id]))).e, "owner row left behind");
  });

  // --- Shared cards -------------------------------------------------------------------------------------------------
  const direct = (a, b) => as(a, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [b]))).then((r) => r.id);
  const card = (type, id, extra = {}) => ({ target_type: type, target_id: id, path: `${type === "item" ? "/marketplace/" : type === "roommate" ? "/roommates/" : "/posts/"}${id}`, kind: type === "post" ? "post" : "listing", title: "t", ...extra });
  const send = (who, conversation, cols = {}) => as(who, () => one(db.query(
    "insert into public.messages (conversation_id, sender_id, content, shared_post, attachments, image_url, snap) values ($1, $2, $3, $4, coalesce($5::jsonb, '[]'::jsonb), $6, $7) returning *",
    [conversation, who, cols.content ?? "", cols.shared_post ? JSON.stringify(cols.shared_post) : null, cols.attachments ? JSON.stringify(cols.attachments) : null, cols.image_url ?? null, cols.snap ? JSON.stringify(cols.snap) : null],
  )));
  await expectOk(t("a shared card of an anonymous listing loses the author its sender wrote into it"), async () => {
    const chat = await direct(CARA, OLI);
    const m = await send(CARA, chat, { shared_post: card("item", ANON_I.id, { author: { id: ANN, name: "Ann Poster", avatar_url: null } }) });
    check(same(m.shared_post.author, { name: "Anonymous" }), JSON.stringify(m.shared_post));
  });
  await expectRefused(t("a campus-only listing cannot be shared where someone is not at that campus"), async () => {
    const id = IDS[2 + 0]; // R named campus
    const chat = await direct(CARA, OLI);
    await send(CARA, chat, { shared_post: card("roommate", id) });
  }, "can't see this listing");

  // --- Inquiry chats ------------------------------------------------------------------------------------------------
  const start = (who, type, id) => run(who, () => one(db.query("select public.start_listing_inquiry($1, $2) as id", [type, id]))).then((r) => r.id);
  let CHAT;
  await expectOk(t("start_listing_inquiry(): Cara opens her chat with the anonymous poster; asking again gives the same chat"), async () => {
    CHAT = await start(CARA, "roommate", ANON_R.id);
    check(CHAT && (await start(CARA, "roommate", ANON_R.id)) === CHAT, "a second chat");
    const c = await as(CARA, () => one(db.query("select type, poster_hidden, inquiry_target_type, inquiry_target_id, direct_key, created_by from public.conversations where id = $1", [CHAT])));
    check(c.poster_hidden && c.inquiry_target_type === "roommate" && c.inquiry_target_id === ANON_R.id && c.created_by === CARA && !c.direct_key.includes(ANN), JSON.stringify(c));
  });
  await expectRefused(t("…not on her own listing"), () => start(ANN, "roommate", ANON_R.id), "your own listing", "22023");
  await expectRefused(t("…not on a listing that isn't anonymous"), () => start(CARA, "roommate", IDS[0]), "isn't anonymous", "22023");
  await expectRefused(t("…not on one the asker cannot see (campus, another campus)"), () => start(OLI, "item", IDS[3 + 6]), "no longer available", "P0002");
  await expectRefused(t("…not when the poster blocked the asker (the same answer as a listing that is gone)"), () => start(BO, "item", ANON_I.id), "no longer available", "P0002");
  await expectRefused(t("…not on a listing that does not exist"), () => start(CARA, "item", "00000000-0000-4000-8000-0000000000ee"), "no longer available", "P0002");
  await expectError(t("…not signed out"), () => start(null, "item", ANON_I.id), "permission denied");
  await expectOk(t("membership: Cara sees only her own row; Ann sees both"), async () => {
    const cara = (await as(CARA, () => db.query("select user_id from public.conversation_members where conversation_id = $1", [CHAT]))).rows.map((r) => r.user_id);
    const ann = (await as(ANN, () => db.query("select user_id from public.conversation_members where conversation_id = $1 order by user_id", [CHAT]))).rows.map((r) => r.user_id);
    check(same(cara, [CARA]) && same(ann, [ANN, CARA].sort()), JSON.stringify({ cara, ann }));
  });
  await expectOk(t("is_conversation_member(): Cara gets false asking about anyone but herself; Ann gets the truth"), async () => {
    const q = (who, about) => as(who, () => one(db.query("select public.is_conversation_member($1, $2) as m", [CHAT, about]))).then((r) => r.m);
    check((await q(CARA, ANN)) === false && (await q(CARA, OLI)) === false && (await q(CARA, CARA)) === true, "Cara");
    check((await q(ANN, ANN)) === true && (await q(ANN, CARA)) === true, "Ann");
  });
  await expectOk(t("anonymous_chat_posters: Ann reads her row, Cara nothing"), async () => {
    check((await as(ANN, () => db.query("select * from public.anonymous_chat_posters"))).rows.length === 1, "Ann");
    check((await as(CARA, () => db.query("select * from public.anonymous_chat_posters"))).rows.length === 0, "Cara");
  });
  await expectRefused(t("Ann cannot show who she is before Cara has written"), () => as(ANN, () => db.query("select public.reveal_listing_identity($1)", [CHAT])), "once they've messaged you");

  await expectOk(t("Cara writes: Ann is told by name, from Cara"), async () => {
    await send(CARA, CHAT, { content: "Hi! Is the room still free?" });
    const n = await one(db.query("select title, actor_id from public.notifications where user_id = $1 and type = 'message' and data ->> 'conversation_id' = $2", [ANN, CHAT]));
    check(n.title === "Cara Campus" && n.actor_id === CARA, JSON.stringify(n));
  });
  let ANN_MSG;
  await expectOk(t("Ann answers: stored without a sender; Cara reads no sender and is told by 'Anonymous poster' with no actor"), async () => {
    ANN_MSG = await send(ANN, CHAT, { content: "Yes, it is." });
    const raw = await one(db.query("select sender_id, anonymous from public.messages where id = $1", [ANN_MSG.id]));
    check(raw.sender_id === null && raw.anonymous === true, JSON.stringify(raw));
    const read = await as(CARA, () => one(db.query("select sender_id, anonymous, content from public.messages where id = $1", [ANN_MSG.id])));
    check(read.sender_id === null && read.anonymous && read.content === "Yes, it is.", JSON.stringify(read));
    const n = await one(db.query("select title, actor_id, body from public.notifications where user_id = $1 and type = 'message' and data ->> 'conversation_id' = $2", [CARA, CHAT]));
    check(n.title === "Anonymous poster" && n.actor_id === null, JSON.stringify(n));
    check(!(await db.query("select title from public.notifications where user_id = $1", [CARA])).rows.some((r) => r.title.includes("Ann")), "Ann's name reached Cara");
  });
  await expectOk(t("unread: Ann's own anonymous message is read for her, unread for Cara"), async () => {
    const u = async (who) => (await as(who, () => db.query("select unread_count::int as n from public.get_unread_counts() where conversation_id = $1", [CHAT]))).rows[0]?.n ?? 0;
    check((await u(ANN)) === 0 && (await u(CARA)) === 1, JSON.stringify([await u(ANN), await u(CARA)]));
  });
  await expectOk(t("nobody can forge an anonymous message: Cara's 'anonymous' is cleared, and a sender-less row of hers is refused"), async () => {
    const m = await as(CARA, () => one(db.query("insert into public.messages (conversation_id, sender_id, content, anonymous) values ($1, $2, 'me', true) returning anonymous, sender_id", [CHAT, CARA])));
    check(m.anonymous === false && m.sender_id === CARA, JSON.stringify(m));
    const o = await outcome(() => as(CARA, () => db.query("insert into public.messages (conversation_id, sender_id, content, anonymous) values ($1, null, 'ghost', true)", [CHAT])));
    check(o.includes("row-level security"), o);
  });
  await expectRefused(t("hidden, Ann cannot send files or voice (their path names her)"), () => send(ANN, CHAT, { attachments: [{ path: `${CHAT}/${ANN}/a.jpg`, kind: "image", name: "a.jpg", size: 10, mime: "image/jpeg" }] }), "once you show who you are");
  await expectRefused(t("…nor an image"), () => send(ANN, CHAT, { image_url: "https://example.com/a.jpg" }), "once you show who you are");
  await expectRefused(t("no Snaps either way while she is hidden"), () => send(CARA, CHAT, { snap: { id: "00000000-0000-4000-8000-000000000123" } }), "Snaps open once");
  await expectOk(t("cards: a public post or listing may be shared in the chat, a non-public one may not (either way)"), async () => {
    await send(CARA, CHAT, { shared_post: card("roommate", IDS[0]) }); // R named global
    const o1 = await outcome(() => send(CARA, CHAT, { shared_post: card("roommate", IDS[4]) })); // R named friends
    const o2 = await outcome(() => send(ANN, CHAT, { shared_post: card("item", IDS[3]) })); // I named campus
    check(o1.includes("Only public posts") && o2.includes("Only public posts"), JSON.stringify([o1, o2]));
  });
  await expectOk(t("calls: refused while the poster is hidden"), async () => {
    const o = await outcome(() => as(CARA, () => db.query("select public.start_call($1, 'audio')", [CHAT])));
    check(o.includes("Calls open once"), o);
  });
  await expectOk(t("Ann cannot leave the chat while hidden (a deleted membership row is announced with its ids)"), async () => {
    await as(ANN, () => db.query("delete from public.conversation_members where conversation_id = $1 and user_id = $2", [CHAT, ANN]));
    check((await one(db.query("select count(*)::int as n from public.conversation_members where conversation_id = $1", [CHAT]))).n === 2, "she left");
  });
  await expectOk(t("activity_status(): Ann's 'Active now' does not answer Cara through the anonymous chat"), async () => {
    await db.query("insert into public.user_activity (user_id, last_active_at) values ($1, now()), ($2, now()) on conflict (user_id) do update set last_active_at = now()", [ANN, CARA]);
    const got = (await as(CARA, () => db.query("select user_id from public.activity_status($1::uuid[])", [[ANN]]))).rows;
    check(got.length === 0, JSON.stringify(got));
  });
  await expectOk(t("Snap recipients: Ann is not among Cara's chats"), async () => {
    const got = (await as(CARA, () => db.query("select id from public.list_snap_recipients(null)"))).rows.map((r) => r.id);
    check(!got.includes(ANN), JSON.stringify(got));
  });
  await expectOk(t("blocks: Vic (who blocked Ann) can still write to her anonymously posted listing; Bo (whom she blocked) cannot"), async () => {
    const vchat = await start(VIC, "item", ANON_I.id);
    await send(VIC, vchat, { content: "Still available?" });
    // Oli's chat is there before Ann blocks him: then his messages are refused.
    const lchat = await start(OLI, "item", ANON_I.id);
    await send(OLI, lchat, { content: "Hello" });
    await as(ANN, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [ANN, OLI]));
    const o = await outcome(() => send(OLI, lchat, { content: "Hello again" }));
    check(o.includes("row-level security"), o);
    await as(ANN, () => db.query("delete from public.blocks where blocker_id = $1 and blocked_id = $2", [ANN, OLI]));
  });
  await expectOk(t("staff: ts_public_author_of() names Ann for her anonymous listing and her anonymous message"), async () => {
    const r = await one(db.query("select public.ts_public_author_of('roommate', $1) as r, public.ts_public_author_of('item', $2) as i, public.ts_public_author_of('message', $3) as m", [ANON_R.id, ANON_I.id, ANN_MSG.id]));
    check(r.r === ANN && r.i === ANN && r.m === ANN, JSON.stringify(r));
  });
  await expectError(t("…which no API role may call"), () => as(CARA, () => db.query("select public.ts_public_author_of('item', $1)", [ANON_I.id])), "permission denied");

  // --- Showing who she is, to Cara only --------------------------------------------------------------------------------
  await expectRefused(t("only the poster may show who she is"), () => as(CARA, () => db.query("select public.reveal_listing_identity($1)", [CHAT])), "Only the anonymous poster");
  let FAY_CHAT;
  await expectOk(t("reveal: Ann shows who she is to Cara; her earlier messages get their sender back; Cara is told by name"), async () => {
    FAY_CHAT = await start(FAY, "roommate", ANON_R.id);
    await send(FAY, FAY_CHAT, { content: "Hey" });
    await send(ANN, FAY_CHAT, { content: "Hi Fay-or-whoever" });
    const at = (await as(ANN, () => one(db.query("select public.reveal_listing_identity($1) as at", [CHAT])))).at;
    check(at, "no time");
    const again = (await as(ANN, () => one(db.query("select public.reveal_listing_identity($1) as at", [CHAT])))).at;
    check(String(again) === String(at), "a second reveal changed the time");
    const c = await as(CARA, () => one(db.query("select poster_hidden, poster_revealed_at from public.conversations where id = $1", [CHAT])));
    check(!c.poster_hidden && c.poster_revealed_at, JSON.stringify(c));
    const msg = await as(CARA, () => one(db.query("select sender_id, anonymous from public.messages where id = $1", [ANN_MSG.id])));
    check(msg.sender_id === ANN && !msg.anonymous, JSON.stringify(msg));
    const members = (await as(CARA, () => db.query("select user_id from public.conversation_members where conversation_id = $1 order by user_id", [CHAT]))).rows.map((r) => r.user_id);
    check(same(members, [ANN, CARA].sort()), JSON.stringify(members));
    const n = await one(db.query("select title, actor_id from public.notifications where user_id = $1 and data ->> 'conversation_id' = $2 and title like '%shared who they are'", [CARA, CHAT]));
    check(n?.title === "Ann Poster shared who they are" && n.actor_id === ANN, JSON.stringify(n));
  });
  await expectOk(t("…an ordinary chat now: membership answers, Snaps list her, 'Active now' answers, a new message of hers carries her"), async () => {
    check((await as(CARA, () => one(db.query("select public.is_conversation_member($1, $2) as m", [CHAT, ANN])))).m === true, "membership");
    await db.query("update public.user_activity set last_active_at = now() where user_id = $1", [ANN]);
    const active = (await as(CARA, () => db.query("select user_id from public.activity_status($1::uuid[])", [[ANN]]))).rows;
    check(active.length === 1, JSON.stringify(active));
    const m = await send(ANN, CHAT, { content: "I'm Ann, by the way." });
    check(m.sender_id === ANN && !m.anonymous, JSON.stringify(m));
    const got = (await as(CARA, () => db.query("select id from public.list_snap_recipients(null)"))).rows.map((r) => r.id);
    check(got.includes(ANN), JSON.stringify(got));
  });
  await expectOk(t("…to Cara only: the listing is still anonymous to her and everyone; Fay's chat still hides Ann"), async () => {
    const r = await as(CARA, () => one(db.query("select author_id from public.roommate_posts where id = $1", [ANON_R.id])));
    check(r.author_id === null, JSON.stringify(r));
    const fay = (await as(FAY, () => db.query("select user_id from public.conversation_members where conversation_id = $1", [FAY_CHAT]))).rows.map((x) => x.user_id);
    check(same(fay, [FAY]), JSON.stringify(fay));
    const fm = (await as(FAY, () => db.query("select sender_id from public.messages where conversation_id = $1 and sender_id is distinct from $2", [FAY_CHAT, FAY]))).rows;
    check(fm.length === 1 && fm[0].sender_id === null, JSON.stringify(fm));
  });

  // --- Rollback -----------------------------------------------------------------------------------------------------
  await expectError(t("the rollback refuses while anonymous listings or chats exist"), () => db.exec(read(ROLLBACK)), "remove them before rolling back");
  await expectOk(t("cleared, the rollback puts the schema back exactly as it was (also when run again)"), async () => {
    await db.exec(`
      delete from public.messages where conversation_id in (select id from public.conversations where inquiry_target_type in ('roommate', 'item'));
      delete from public.conversations where inquiry_target_type in ('roommate', 'item');
      delete from public.roommate_posts where is_anonymous or audience <> 'global';
      delete from public.items where is_anonymous or audience <> 'global';`);
    await db.exec(read(ROLLBACK));
    const after = await fingerprint(db);
    check(same(after, before), diff(before, after));
    const o = await outcome(() => db.exec(read(ROLLBACK)));
    check(o.includes("did not run"), o);
  });
  await expectOk(t("the migration applies again after the rollback"), () => db.exec(read(MIGRATION)));
}

await suite("repo", false);
await suite("production", true);
done("ANONYMOUS LISTINGS");
