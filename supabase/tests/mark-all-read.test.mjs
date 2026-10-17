// Migration 27 ("Mark all as read" in Messages) against PGlite: one call moves your receipts in the chats you name
// (every chat of yours when none are named), only where someone else wrote something new and only in your own rows;
// it says how many chats changed, and the unread counts and "Seen" follow.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the mark-all-read migration re-runs cleanly", async () => { await db.exec(read("migrations/20261020000000_mark_all_read.sql")); });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;

const A = await mk("a@txstate.edu", "Ada Adams"), B = await mk("b@txstate.edu", "Bo Bright"), C = await mk("c@txstate.edu", "Cy Cole"), D = await mk("d@txstate.edu", "Di Dunn");
const direct = async (from, to) => (await as(from, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [to])))).id;
const AB = await direct(A, B), AC = await direct(A, C), AD = await direct(A, D), BC = await direct(B, C);
const G = (await as(A, () => one(db.query("select public.create_group_conversation('Study group', array[$1, $2]::uuid[]) as id", [B, C])))).id;
const say = (who, conversation, text) => as(who, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3)", [conversation, who, text]));
const markAll = async (who, ids) => Number((await as(who, () => one(db.query("select public.mark_conversations_read($1::uuid[]) as n", [ids])))).n);
const unread = async (who) => Object.fromEntries((await as(who, () => rows(db.query("select conversation_id, unread_count from public.get_unread_counts()")))).map((r) => [r.conversation_id, Number(r.unread_count)]));
const total = async (who) => Number((await as(who, () => one(db.query("select public.get_total_unread() as n")))).n);
const receipt = (who, conversation) => one(db.query("select last_read_at, last_delivered_at from public.conversation_members where user_id = $1 and conversation_id = $2", [who, conversation]));
const same = (a, b) => +a.last_read_at === +b.last_read_at && +a.last_delivered_at === +b.last_delivered_at;
const can = async (role, fn) => (await one(db.query("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))).ok;
const tick = () => new Promise((r) => setTimeout(r, 5));

await say(A, AD, "hi Di"); // only Ada wrote here: nothing for her to read
await say(B, AB, "hi Ada"); await say(B, AB, "you there?");
await say(C, AC, "hey");
await say(B, G, "hi all"); await say(C, G, "hello");
await say(B, BC, "no Ada in here");

await expectOk("before: Ada's unread chats are the two direct ones and the group, five messages in all", async () => {
  const u = await unread(A);
  if (u[AB] !== 2 || u[AC] !== 1 || u[G] !== 2 || u[AD] !== undefined || (await total(A)) !== 5) throw new Error(JSON.stringify(u));
});
await expectOk("naming chats clears those alone, says how many changed, and moves nobody else's receipts", async () => {
  const bo = await receipt(B, AB), ac = await receipt(A, AC);
  await tick();
  const n = await markAll(A, [AB, G]);
  if (n !== 2) throw new Error(`expected 2 chats changed, got ${n}`);
  const u = await unread(A);
  if (u[AB] !== undefined || u[G] !== undefined || u[AC] !== 1 || (await total(A)) !== 1) throw new Error(JSON.stringify(u));
  if (!same(bo, await receipt(B, AB))) throw new Error("Bo's receipt moved");
  if (!same(ac, await receipt(A, AC))) throw new Error("a chat not named moved");
});
await expectOk("Bo now sees Ada's 'Seen' past the last message, as after she opened the chat", async () => {
  const r = await receipt(A, AB);
  const last = await one(db.query("select max(created_at) as at from public.messages where conversation_id = $1", [AB]));
  if (!(r.last_read_at >= last.at) || !(r.last_delivered_at >= last.at)) throw new Error("receipt not moved past the last message");
});
await expectOk("with nothing new a call changes nothing (opening or clearing chats tells nobody when the app was open)", async () => {
  const ab = await receipt(A, AB), g = await receipt(A, G);
  await tick();
  if ((await markAll(A, [AB, G])) !== 0) throw new Error("expected 0");
  if (!same(ab, await receipt(A, AB)) || !same(g, await receipt(A, G))) throw new Error("receipts moved with nothing to read");
});
await expectOk("a chat you are not in, one where only you wrote, or no chats at all: nothing moves", async () => {
  const bc = await receipt(B, BC), cbc = await receipt(C, BC), ad = await receipt(A, AD);
  await tick();
  if ((await markAll(A, [BC, AD])) !== 0 || (await markAll(A, [])) !== 0) throw new Error("expected 0");
  if (!same(bc, await receipt(B, BC)) || !same(cbc, await receipt(C, BC)) || !same(ad, await receipt(A, AD))) throw new Error("a row moved");
});
await expectOk("naming no chats means every chat of yours; other people's counts are untouched", async () => {
  await say(B, AB, "one more"); await tick();
  const cy = await unread(C);
  if ((await markAll(A, null)) !== 2) throw new Error("expected the direct chats with Bo and Cy");
  if ((await total(A)) !== 0) throw new Error("Ada still has unread");
  if (JSON.stringify(await unread(C)) !== JSON.stringify(cy)) throw new Error("Cy's counts changed");
});
await expectOk("signed-in people may call it, anonymous visitors may not", async () => {
  if (!(await can("authenticated", "public.mark_conversations_read(uuid[])"))) throw new Error("authenticated cannot call it");
  if (await can("anon", "public.mark_conversations_read(uuid[])")) throw new Error("anon can call it");
});
await expectError("anonymous: permission denied", () => asAnon(() => db.query("select public.mark_conversations_read(null::uuid[])")), "permission denied");
done("MIGRATION-27 MARK ALL READ");
