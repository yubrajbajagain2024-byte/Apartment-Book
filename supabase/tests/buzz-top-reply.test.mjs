// The top reply on a Buzz feed card (20261108000100_buzz_top_reply.sql) against PGlite, in production's order: the feed
// and Buzz search carry each buzz's most upvoted reply that anyone may read, with at least 3 upvotes and more up than
// down, ties to the earlier reply; never one that touched on self-harm, nor a hidden one; per viewer, never one they
// reported or from an anon they hid. It keeps its thread alias and says nothing about who wrote it. The function
// stays internal, buzz_v2.sql runs again over the file, the rollback takes topReply away, and it applies again.
import { boot, read, expectOk, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION as VERSION, BUZZ_TOP_REPLY_MIN_UPVOTES } from "../../packages/shared/src/buzz/constants.ts";

const MIGRATION = "migrations/20261108000100_buzz_top_reply.sql";
const ROLLBACK = "rollbacks/20261108000100_buzz_top_reply.down.sql";
const TOP_KEYS = ["alias", "createdAt", "id", "isMine", "isOp", "score", "text"];
const check = (cond, message) => { if (!cond) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { db, mk, as, asAnon, asService } = await boot({ live: true });
const one = async (p) => (await p).rows[0];
const val = async (p) => {
  const row = (await p).rows[0];
  return row ? row[Object.keys(row)[0]] : undefined;
};
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, min_campus_size = 1");

const people = [];
const user = async (email, name) => {
  const uid = await mk(email, name);
  await db.query("update public.profiles set university_id = $2, created_at = now() - interval '30 days' where id = $1", [uid, TX]);
  await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [VERSION]));
  people.push({ uid, email, name });
  return uid;
};
const call = (uid, fn, args) => as(uid, () => val(db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)));
const unrated = (uid) => db.query("delete from public.buzz_rate_log where user_id = $1", [uid]);
const create = async (uid, text) => {
  await unrated(uid);
  return asService(() => val(db.query("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null) as r", [uid, JSON.stringify({ text })])));
};
const reply = async (uid, thread, text, { parentId = null, support = false } = {}) => {
  await unrated(uid);
  return asService(() => val(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', $4, null) as r", [uid, thread, JSON.stringify(parentId ? { text, parentId } : { text }), support])));
};
const vote = async (voters, id, value = 1) => {
  for (const v of voters) {
    await unrated(v);
    await call(v, "buzz_v2_vote", [id, value]);
  }
};
const feed = (uid, q = null) => call(uid, "buzz_v2_feed", ["campus", "new", "day", q, 50, 0, null]);
const topOf = async (uid, threadId, q = null) => (await feed(uid, q)).items.find((b) => b.id === threadId)?.topReply;

const OP = await user("olive@txstate.edu", "Olive Poster");
const A = await user("ada@txstate.edu", "Ada Adams");
const B = await user("bo@txstate.edu", "Bo Brooks");
const C = await user("cy@txstate.edu", "Cy Chen");
const D = await user("dee@txstate.edu", "Dee Diaz");
const V = await user("val@txstate.edu", "Val Viewer");
const VOTERS = [];
for (let i = 0; i < 8; i++) VOTERS.push(await user(`voter${i}@txstate.edu`, `Voter Number${i}`));

const t = await create(OP, "Who else heard the fire alarm at 3am?");
const quiet = await create(OP, "Nobody has replied to this one yet");

await expectOk("the shared minimum and the database's agree (3 upvotes)", async () => {
  const sql = read(MIGRATION);
  check(BUZZ_TOP_REPLY_MIN_UPVOTES === 3, `BUZZ_TOP_REPLY_MIN_UPVOTES is ${BUZZ_TOP_REPLY_MIN_UPVOTES}`);
  check((sql.match(/upvotes >= 3/g) ?? []).length === 2, "the index and the function both ask for 3 upvotes");
});

await expectOk("no reply, or none with 3 upvotes yet: topReply is null, and every buzz in the feed has the key", async () => {
  const r1 = await reply(A, t.id, "Me, I'm in Tower Hall");
  await vote(VOTERS.slice(0, 2), r1.id);
  const items = (await feed(V)).items;
  for (const b of items) check("topReply" in b, `buzz ${b.id} has no topReply key`);
  check(items.find((b) => b.id === t.id).topReply === null, "two upvotes are not enough");
  check(items.find((b) => b.id === quiet.id).topReply === null, "a buzz without replies has none");
});

let r2, r3;
await expectOk("the most upvoted reply wins; a tie goes to the earlier one", async () => {
  r2 = await reply(B, t.id, "Same, second time this week");
  r3 = await reply(C, t.id, "Third for me");
  await vote(VOTERS.slice(0, 4), r2.id);
  await vote(VOTERS.slice(0, 4), r3.id);
  const top = await topOf(V, t.id);
  check(top?.id === r2.id && top.score === 4, `top is ${top?.id} (${top?.score}), expected r2 with 4`);
  check(same(Object.keys(top).sort(), TOP_KEYS), `keys ${Object.keys(top)}`);
  check(top.text === "Same, second time this week" && top.isOp === false && top.isMine === false, "words and flags");
  check(top.createdAt % 60_000 === 0, "the time is floored to the minute");
});

await expectOk("it keeps the alias it has in the thread, and says nothing about who wrote it", async () => {
  const top = await topOf(V, t.id);
  const inThread = (await call(V, "buzz_v2_thread", [t.id, 50])).replies.items.find((r) => r.id === r2.id);
  check(same(top.alias, inThread.alias), `feed ${JSON.stringify(top.alias)}, thread ${JSON.stringify(inThread.alias)}`);
  const text = JSON.stringify(top).toLowerCase();
  for (const p of people) for (const s of [p.uid, p.email, p.name, ...p.name.split(" ")]) check(!text.includes(s.toLowerCase()), `the top reply mentions ${s}`);
  check(top.isMine === false && (await topOf(B, t.id)).isMine === true, "isMine for its author only");
});

await expectOk("more up than down: a reply at 5 up and 5 down is passed over", async () => {
  const tied = await reply(D, t.id, "Controversial take: the alarm is fine");
  await vote(VOTERS.slice(0, 5), tied.id, 1);
  await vote([A, B, C, V, OP], tied.id, -1);
  check((await topOf(V, t.id)).id === r2.id, "the 0-score reply is not the top reply");
});

await expectOk("never a reply that touched on self-harm, nor one moderators hid", async () => {
  const support = await reply(D, t.id, "honestly this week I keep thinking about not being here", { support: true });
  await vote(VOTERS.slice(0, 7), support.id);
  check((await topOf(V, t.id)).id === r2.id, "the support-flagged reply stays in its thread");
  const hidden = await reply(A, t.id, "a reply moderators will hide");
  await vote(VOTERS.slice(0, 7), hidden.id);
  check((await topOf(V, t.id)).id === hidden.id, "while it is active it is the top reply");
  await asService(() => db.query("select public.buzz_v2_set_status('buzz_reply', $1, 'hidden')", [hidden.id]));
  check((await topOf(V, t.id)).id === r2.id, "hidden, it leaves the card");
});

await expectOk("per viewer: never one they reported, nor from an anon they hid in that thread", async () => {
  const r5 = await reply(D, t.id, "It's the toaster in the 3rd floor kitchen");
  await vote(VOTERS.slice(0, 6), r5.id);
  check((await topOf(A, t.id)).id === r5.id, "r5 is the top reply for everyone");
  await call(V, "buzz_v2_report", [r5.id, "spam_scam", null]);
  check((await topOf(V, t.id)).id === r2.id && (await topOf(A, t.id)).id === r5.id, "Val reported it: Val sees r2, Ada still r5");
  await call(V, "buzz_v2_hide_author", [r2.id]);
  check((await topOf(V, t.id)).id === r3.id, "Val hid r2's anon: the tie goes to r3 for Val");
});

await expectOk("the poster's own reply shows as OP; Buzz search carries topReply too; the thread's root does not", async () => {
  const op = await reply(OP, t.id, "Update: it was a burnt bagel", { parentId: r2.id });
  await vote(VOTERS.slice(0, 8), op.id);
  const top = await topOf(V, t.id);
  check(top.id === op.id && top.isOp === true, "the OP's reply, at any depth, as OP");
  check((await topOf(V, t.id, "fire alarm"))?.id === op.id, "search results carry it");
  check(!("topReply" in (await call(V, "buzz_v2_thread", [t.id, 50])).root), "a thread's root has no topReply");
});

await expectOk("the top reply's function is internal; the feed stays for signed-in people only", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    check(!(await val(db.query("select has_function_privilege($1, 'public.buzz_v2_top_reply(public.buzz_posts, uuid)', 'execute') as r", [role]))), `${role} may run buzz_v2_top_reply`);
  }
  const sig = "public.buzz_v2_feed(text, text, text, text, integer, integer, timestamp with time zone)";
  check(await val(db.query("select has_function_privilege('authenticated', $1, 'execute') as r", [sig])), "signed-in people read the feed");
  check(!(await val(db.query("select has_function_privilege('anon', $1, 'execute') as r", [sig]))), "signed-out visitors do not");
  let denied = false;
  try {
    await asAnon(() => db.query("select public.buzz_v2_feed('campus', 'new', 'day', null, 50, 0, null)"));
  } catch (e) {
    denied = /permission denied/.test(String(e.message));
  }
  check(denied, "anon is refused");
});

await expectOk("it applies again over itself, and 20261103000100_buzz_v2.sql runs again over it", async () => {
  await db.exec(read(MIGRATION));
  check((await topOf(V, t.id)) !== undefined, "topReply still there");
  await db.exec(read("migrations/20261103000100_buzz_v2.sql"));
  check(!("topReply" in (await feed(V)).items[0]), "buzz_v2.sql's feed has no topReply");
  await db.exec(read(MIGRATION));
  check("topReply" in (await feed(V)).items[0], "and this file brings it back");
});

await expectOk("the rollback takes topReply, its function and its index away; the migration applies again", async () => {
  await db.exec(read(ROLLBACK));
  check(!("topReply" in (await feed(V)).items[0]), "no topReply after the rollback");
  check((await val(db.query("select to_regprocedure('public.buzz_v2_top_reply(public.buzz_posts, uuid)') as r"))) === null, "the function is gone");
  check((await val(db.query("select to_regclass('public.buzz_comments_top_idx') as r"))) === null, "the index is gone");
  check(await val(db.query("select has_function_privilege('authenticated', 'public.buzz_v2_feed(text, text, text, text, integer, integer, timestamp with time zone)', 'execute') as r")), "the feed is still granted");
  await db.exec(read(MIGRATION));
  check((await topOf(V, t.id))?.isOp === true, "back again");
});

done("BUZZ TOP REPLY");
