// Buzz replies at any depth (20261108000000_buzz_reply_tree.sql) against PGlite, in production's order: every reply of
// a page says which reply it answers (treeParentId), stepping over what the viewer may not see (someone else's held
// reply, one they reported) and pointing at a deleted reply only while it stays as a placeholder, exactly as the
// two-level shape does; parentId, depth and replyingTo stay as they were. The function behind it stays internal, its
// other callers still work, the rollback puts the two-level readers back, and the migration applies again.
import { boot, read, expectOk, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION as VERSION } from "../../packages/shared/src/buzz/constants.ts";

const MIGRATION = "migrations/20261108000000_buzz_reply_tree.sql";
const ROLLBACK = "rollbacks/20261108000000_buzz_reply_tree.down.sql";
const OLD_KEYS = ["alias", "collapsed", "createdAt", "depth", "id", "isMine", "isOp", "kind", "myVote", "parentId", "replyingTo", "score", "status", "supportLink", "text", "threadId"];
const NEW_KEYS = [...OLD_KEYS, "treeParentId"].sort();
const check = (cond, message) => { if (!cond) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { db, mk, as, asService } = await boot({ live: true });
const one = async (p) => (await p).rows[0];
const val = async (p) => {
  const row = (await p).rows[0];
  return row ? row[Object.keys(row)[0]] : undefined;
};
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");

const user = async (email, name) => {
  const uid = await mk(email, name);
  await db.query("update public.profiles set university_id = $2, created_at = now() - interval '30 days' where id = $1", [uid, TX]);
  await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [VERSION]));
  return uid;
};
const call = (uid, fn, args) => as(uid, () => val(db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)));
const unrated = (uid) => db.query("delete from public.buzz_rate_log where user_id = $1", [uid]);
const create = async (uid, text) => {
  await unrated(uid);
  return asService(() => val(db.query("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null) as r", [uid, JSON.stringify({ text })])));
};
const reply = async (uid, thread, text, parentId = null, status = "active") => {
  await unrated(uid);
  return asService(() => val(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, $4, false, null) as r", [uid, thread, JSON.stringify(parentId ? { text, parentId } : { text }), status])));
};
const thread = (uid, id) => call(uid, "buzz_v2_thread", [id, 50]);
const byId = (items) => Object.fromEntries(items.map((r) => [r.id, r]));

const OP = await user("olive@txstate.edu", "Olive Poster");
const B = await user("bo@txstate.edu", "Bo Brooks");
const C = await user("cy@txstate.edu", "Cy Chen");
const D = await user("dee@txstate.edu", "Dee Diaz");
const V = await user("val@txstate.edu", "Val Viewer");

// The conversation: a chain five deep under r1, a second branch, a held reply with an answer under it, and a deleted
// reply that stays as a placeholder because an answer under it still shows.
const t = await create(OP, "Who else heard the fire alarm at 3am?");
const r1 = await reply(B, t.id, "Me, I'm in Tower Hall");
const r2 = await reply(C, t.id, "Same, second time this week", r1.id);
const r3 = await reply(D, t.id, "Third for me", r2.id);
const r4 = await reply(OP, t.id, "Who keeps pulling it?", r3.id);
const r5 = await reply(B, t.id, "Rumor is it's a toaster", r4.id);
const r6 = await reply(C, t.id, "Tower Hall gang", r1.id);
const h = await reply(C, t.id, "held for review", r3.id, "held");
const r7 = await reply(C, t.id, "an answer under the held one", h.id);
const r8 = await reply(B, t.id, "soon deleted", r1.id);
const r9 = await reply(D, t.id, "an answer under the deleted one", r8.id);
await call(B, "buzz_v2_delete", [r8.id]);
await call(V, "buzz_v2_report", [r2.id, "spam_scam", null]);

// What each viewer should read: reply → the reply it answers (t.id = the thread itself).
const BASE = { [r1.id]: t.id, [r2.id]: r1.id, [r3.id]: r2.id, [r4.id]: r3.id, [r5.id]: r4.id, [r6.id]: r1.id, [r7.id]: r3.id, [r8.id]: r1.id, [r9.id]: r8.id };
const EXPECTED = {
  // Bo cannot see Cy's held reply: Cy's answer under it hangs from r3, the nearest reply Bo sees.
  bo: [B, BASE],
  // Cy sees their own held reply, so their answer hangs from it.
  cy: [C, { ...BASE, [h.id]: r3.id, [r7.id]: h.id }],
  // Val reported r2: it is gone for them, and r3 answers r1 instead.
  val: [V, Object.fromEntries(Object.entries({ ...BASE, [r3.id]: r1.id }).filter(([id]) => id !== r2.id))],
};

const treeOf = async (uid) => {
  const page = (await thread(uid, t.id)).replies;
  check(page.nextOffset === null, "one page holds the thread");
  return page.items;
};

await expectOk("before: the two-level readers send no treeParentId", async () => {
  // The migration is already in the folder, so boot applied it: take it back first to see the readers as they were.
  await db.exec(read(ROLLBACK));
  for (const r of await treeOf(B)) check(same(Object.keys(r).sort(), OLD_KEYS), `keys ${Object.keys(r)}`);
});

await expectOk("the migration applies (and again, over itself)", async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read(MIGRATION));
});

for (const [who, [uid, expected]] of Object.entries(EXPECTED)) {
  await expectOk(`${who}: every reply says which reply it answers, at any depth, stepping over what ${who} may not see`, async () => {
    const items = await treeOf(uid);
    const got = Object.fromEntries(items.map((r) => [r.id, r.treeParentId]));
    check(same(Object.keys(got).sort(), Object.keys(expected).sort()), `${who} sees ${Object.keys(got).length} replies, expected ${Object.keys(expected).length}`);
    for (const [id, parent] of Object.entries(expected)) check(got[id] === parent, `${who}: ${id} answers ${got[id]}, expected ${parent}`);
    for (const r of items) check(same(Object.keys(r).sort(), NEW_KEYS), `keys ${Object.keys(r)}`);
  });
}

await expectOk("parentId, depth and replyingTo are the two-level shape, as before", async () => {
  const items = byId(await treeOf(B));
  const alias = (id) => items[id].alias;
  check(items[r1.id].depth === 1 && items[r1.id].parentId === t.id && items[r1.id].replyingTo === null, "r1 is depth 1 under the thread");
  check(items[r2.id].depth === 2 && items[r2.id].parentId === r1.id && items[r2.id].replyingTo === null, "r2 is depth 2 under r1");
  for (const [id, answered] of [[r3.id, r2.id], [r4.id, r3.id], [r5.id, r4.id]]) {
    check(items[id].depth === 2 && items[id].parentId === r1.id, `${id} is flattened under r1`);
    check(same(items[id].replyingTo, alias(answered)), `${id} says it replies to ${alias(answered).label}`);
  }
  check(items[r8.id].status === "deleted" && items[r8.id].text === "", "the deleted reply stays as a placeholder");
});

await expectOk("later pages carry treeParentId too (buzz_v2_replies)", async () => {
  const page = await call(B, "buzz_v2_replies", [t.id, 3, 3]);
  check(page.items.length === 3 && page.nextOffset === 6, `page of ${page.items.length}, next ${page.nextOffset}`);
  for (const r of page.items) check(r.treeParentId === BASE[r.id], `${r.id} answers ${r.treeParentId}`);
});

await expectOk("the other callers still work: the website's reply, My buzzes, the staff context", async () => {
  const fresh = await reply(D, t.id, "one more, deep down", r5.id);
  check(fresh && fresh.kind === "reply" && fresh.depth === 2 && fresh.parentId === r1.id, "buzz_v2_reply answers with the two-level shape");
  const mine = await call(D, "buzz_v2_mine", ["replies", 0, 20]);
  check(mine.items.some((x) => x.id === fresh.id || x.reply?.id === fresh.id || JSON.stringify(x).includes(fresh.id)), "My buzzes lists the new reply");
  const ctx = await val(db.query("select public.buzz_v2_staff_context('buzz_reply', $1) as r", [r9.id]));
  check(ctx?.item?.id === r9.id && same(ctx.parents.map((p) => p.id), [r1.id, r8.id]), "the staff context still shows a reply with the replies above it");
  const items = byId(await treeOf(B));
  check(items[fresh.id].treeParentId === r5.id, "the new reply answers r5, six deep");
});

await expectOk("the shaping function stays internal: no API role may run it", async () => {
  for (const fn of ["public.buzz_v2_visible_replies(uuid, uuid, boolean)", "public.buzz_v2_reply_page(public.buzz_posts, uuid, integer, integer, boolean)"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      check(!(await val(db.query("select has_function_privilege($1, $2, 'execute') as r", [role, fn]))), `${role} may run ${fn}`);
    }
  }
  let denied = false;
  try {
    await as(V, () => db.query("select * from public.buzz_v2_visible_replies($1, $2, true)", [t.id, V]));
  } catch (e) {
    denied = /permission denied/.test(String(e.message));
  }
  check(denied, "a signed-in person cannot ask for the staff view");
});

await expectOk("20261103000100_buzz_v2.sql still runs again over it (and this file after it)", async () => {
  await db.exec(read("migrations/20261103000100_buzz_v2.sql"));
  for (const r of await treeOf(B)) check(same(Object.keys(r).sort(), OLD_KEYS), `keys after buzz_v2.sql ${Object.keys(r)}`);
  await db.exec(read(MIGRATION));
  check(byId(await treeOf(B))[r5.id].treeParentId === r4.id, "treeParentId is back");
});

await expectOk("the rollback puts the two-level readers back, and the migration applies again", async () => {
  await db.exec(read(ROLLBACK));
  for (const r of await treeOf(B)) check(same(Object.keys(r).sort(), OLD_KEYS), `keys after rollback ${Object.keys(r)}`);
  for (const role of ["anon", "authenticated", "service_role"]) {
    check(!(await val(db.query("select has_function_privilege($1, 'public.buzz_v2_visible_replies(uuid, uuid, boolean)', 'execute') as r", [role]))), `${role} may run it after the rollback`);
  }
  await db.exec(read(MIGRATION));
  const items = byId(await treeOf(B));
  check(items[r5.id].treeParentId === r4.id, "treeParentId is back");
});

done("BUZZ REPLY TREE");
