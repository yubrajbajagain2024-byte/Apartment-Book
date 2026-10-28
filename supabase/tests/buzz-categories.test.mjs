// A category on every new buzz (20261108000300_buzz_categories.sql) against PGlite, in production's order: every
// category the apps offer (BUZZ_CATEGORIES) is stored and shown on the buzz, in the feed and the thread; none leaves it
// null; anything else is refused, by buzz_v2_create in words and by the table's check. A placeholder shows none, and a
// day's prompt thread has none. Creating stays the website's write API's alone. buzz_v2.sql runs again over the file,
// the rollback keeps every category, and the migration applies again.
import { boot, read, expectOk, done } from "./harness.mjs";
import { BUZZ_CATEGORIES, BUZZ_GUIDELINES_VERSION as VERSION } from "../../packages/shared/src/buzz/constants.ts";

const MIGRATION = "migrations/20261108000300_buzz_categories.sql";
const ROLLBACK = "rollbacks/20261108000300_buzz_categories.down.sql";
const check = (cond, message) => { if (!cond) throw new Error(message); };

const { db, mk, as, asService } = await boot({ live: true });
const one = async (p) => (await p).rows[0];
const val = async (p) => {
  const row = (await p).rows[0];
  return row ? row[Object.keys(row)[0]] : undefined;
};
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, min_campus_size = 1");

const user = async (email, name) => {
  const uid = await mk(email, name);
  await db.query("update public.profiles set university_id = $2, created_at = now() - interval '30 days' where id = $1", [uid, TX]);
  await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [VERSION]));
  return uid;
};
const call = (uid, fn, args) => as(uid, () => val(db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)));
const fails = async (fn, code) => {
  try {
    await fn();
  } catch (e) {
    if (String(e.message).startsWith(`buzz:${code}:`)) return String(e.message);
    throw new Error(`expected ${code}, got ${e.message}`);
  }
  throw new Error(`expected ${code}, got no error`);
};
const create = async (uid, input) => {
  await db.query("delete from public.buzz_rate_log where user_id = $1", [uid]);
  return asService(() => val(db.query("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null) as r", [uid, JSON.stringify(input)])));
};
const feedItem = async (uid, id) => (await call(uid, "buzz_v2_feed", ["campus", "new", "day", null, 50, 0, null])).items.find((b) => b.id === id);
const stored = (id) => val(db.query("select category from public.buzz_posts where id = $1", [id]));

const ANA = await user("ana@txstate.edu", "Ana Alvarez");
const BO = await user("bo@txstate.edu", "Bo Brooks");
const VALUES = BUZZ_CATEGORIES.map((c) => c.value);
let picked;

await expectOk("the database has the apps' list, no more and no less", async () => {
  const def = await val(db.query("select pg_get_constraintdef(oid) as r from pg_constraint where conname = 'buzz_posts_category_check'"));
  const listed = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  check(JSON.stringify([...listed].sort()) === JSON.stringify([...VALUES].sort()), `check ${JSON.stringify(listed)} vs apps ${JSON.stringify(VALUES)}`);
  check(new Set(VALUES).size === VALUES.length && BUZZ_CATEGORIES.every((c) => c.label && c.emoji && c.hint), "each category once, named, with an emoji and a hint");
});

await expectOk("every category the apps offer is stored and shown on the buzz, in the feed and the thread", async () => {
  for (const category of VALUES) {
    const b = await create(ANA, { text: `about ${category}`, category });
    check(b.category === category, `${category}: the new buzz says ${b.category}`);
    check((await stored(b.id)) === category, `${category}: stored`);
    if (category === "hot_take") picked = b;
  }
  check((await feedItem(BO, picked.id)).category === "hot_take", "the feed shows it to others");
  check((await call(BO, "buzz_v2_thread", [picked.id, 50])).root.category === "hot_take", "so does the thread");
});

await expectOk("none picked (left out or null) leaves it null", async () => {
  const left = await create(ANA, { text: "no category" });
  const nulled = await create(ANA, { text: "null category", category: null });
  check(left.category === null && nulled.category === null, `${left.category} / ${nulled.category}`);
  check((await stored(left.id)) === null && (await stored(nulled.id)) === null, "stored as null");
  check((await feedItem(BO, left.id)).category === null, "the feed says null");
});

await expectOk("anything else is refused in words, and the table refuses it too", async () => {
  for (const category of ["gossip", "Hot_take", "", 7, true, ["rant"], { value: "rant" }]) {
    const message = await fails(() => create(ANA, { text: "wrong category", category }), "validation_failed");
    check(message === "buzz:validation_failed:Pick a category from the list.", `${JSON.stringify(category)}: ${message}`);
  }
  let refused = false;
  try {
    await db.query("update public.buzz_posts set category = 'gossip' where id = $1", [picked.id]);
  } catch (e) {
    refused = /buzz_posts_category_check/.test(String(e.message));
  }
  check(refused, "the check refuses a value outside the list");
});

await expectOk("a placeholder shows no category to others; its author still sees it", async () => {
  const b = await create(ANA, { text: "soon removed", category: "rant" });
  await db.query("update public.buzz_posts set status = 'removed' where id = $1", [b.id]);
  const json = (viewer) => val(db.query("select public.buzz_root_json(b, $2) as r from public.buzz_posts b where b.id = $1", [b.id, viewer]));
  check((await json(BO)).category === null, "others: none, like its words");
  check((await json(ANA)).category === "rant", "its author: the category");
});

await expectOk("a day's prompt thread has no category", async () => {
  const prompt = await one(db.query("select * from public.buzz_v2_today_prompt()"));
  const thread = await call(ANA, "buzz_v2_prompt_thread", [prompt.prompt_id, "campus"]);
  check((await stored(thread)) === null, "none");
});

await expectOk("creating stays the website's write API's alone", async () => {
  const sig = "public.buzz_v2_create(uuid, jsonb, text, boolean, jsonb)";
  for (const [role, allowed] of [["anon", false], ["authenticated", false], ["service_role", true]]) {
    check((await val(db.query("select has_function_privilege($1, $2, 'execute') as r", [role, sig]))) === allowed, `${role}: ${allowed}`);
  }
  check(!(await val(db.query("select has_function_privilege('authenticated', 'public.buzz_root_json(public.buzz_posts, uuid, boolean)', 'execute') as r"))), "the serializer is internal");
});

await expectOk("it applies again over itself, and 20261103000100_buzz_v2.sql runs again over it", async () => {
  await db.exec(read(MIGRATION));
  check((await feedItem(BO, picked.id)).category === "hot_take", "applied twice: unchanged");
  await db.exec(read("migrations/20261103000100_buzz_v2.sql"));
  check(!("category" in (await feedItem(BO, picked.id))), "buzz_v2.sql's buzz has no category");
  check((await stored(picked.id)) === "hot_take", "but it is still stored");
  await db.exec(read(MIGRATION));
  check((await feedItem(BO, picked.id)).category === "hot_take", "and this file brings it back");
});

await expectOk("the rollback keeps every category; applying the migration again shows them again", async () => {
  await db.exec(read(ROLLBACK));
  const after = await create(ANA, { text: "posted while rolled back", category: "rant" });
  check(!("category" in after) && (await stored(after.id)) === null, "rolled back: the category is not read");
  check((await stored(picked.id)) === "hot_take", "the ones already picked stay");
  check(!("category" in (await feedItem(BO, picked.id))), "and are not shown");
  await db.exec(read(MIGRATION));
  check((await feedItem(BO, picked.id)).category === "hot_take", "shown again");
});

done("BUZZ CATEGORIES");
