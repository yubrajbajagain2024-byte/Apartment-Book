// Migration 35 against PGlite: calls in direct and group chats: starting (the row in the chat, the ring, no message
// notification), answering, hanging up, declining, cancelling (missed, with its notification), a ring that runs out,
// late joins, and what is refused.
import { randomUUID } from "node:crypto";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { callOf, callPreview, callRowText, missedCallBody } from "../../packages/shared/src/calls.ts";

const MIGRATION = "migrations/20261028000000_calls.sql";
const { db, mk, as } = await boot();
await expectOk("the migration re-runs cleanly", () => db.exec(read(MIGRATION)));

const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol"), D = await mk("d@txstate.edu", "Dave");
for (const [x, y] of [[A, B], [B, A], [A, C], [C, A]]) await db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [x, y]);
const AB = (await as(A, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [B])))).id;
const GROUP = (await as(A, () => one(db.query("select public.create_group_conversation('Study group', $1::uuid[]) as id", [[B, C]])))).id;

const start = (uid, conv, kind = "audio") => as(uid, async () => (await one(db.query("select public.start_call($1, $2) as r", [conv, kind]))).r);
const answer = (uid, id) => as(uid, async () => (await one(db.query("select public.answer_call($1) as r", [id]))).r);
const decline = (uid, id) => as(uid, () => db.query("select public.decline_call($1)", [id]));
const leave = (uid, id) => as(uid, () => db.query("select public.leave_call($1)", [id]));
const get = (uid, id) => as(uid, async () => (await one(db.query("select public.get_call($1) as r", [id]))).r);
const callRow = async (uid, messageId) => callOf((await as(uid, () => one(db.query("select call from public.messages where id = $1", [messageId])))).call);
const preview = async (conv) => (await one(db.query("select last_message_preview from public.conversations where id = $1", [conv]))).last_message_preview;
const states = async (id) => Object.fromEntries((await rows(db.query("select user_id, state from public.call_participants where call_id = $1", [id]))).map((r) => [r.user_id, r.state]));
const notifications = (uid, type) => as(uid, () => rows(db.query("select title, body, data from public.notifications where user_id = $1 and type = $2 order by created_at", [uid, type])));

// --- a direct call, answered and hung up ---------------------------------------------------------------------------
let first;
await expectOk("start: the call rings the other person, with its row in the chat and the inbox line, and no message notification", async () => {
  first = await start(A, AB);
  if (first.joined !== false || !first.call_id || !first.message_id) throw new Error(JSON.stringify(first));
  const s = await states(first.call_id);
  if (s[A] !== "joined" || s[B] !== "ringing") throw new Error(JSON.stringify(s));
  const row = await callRow(B, first.message_id);
  if (!row || row.status !== "ringing" || row.kind !== "audio" || row.started_by !== A) throw new Error(JSON.stringify(row));
  if ((await preview(AB)) !== "Audio call" || callPreview(row) !== "Audio call") throw new Error(await preview(AB));
  if ((await notifications(B, "message")).length !== 0) throw new Error("a call must not notify as a message");
  const text = callRowText(row, B);
  if (text.detail !== "Ringing") throw new Error(JSON.stringify(text));
});
await expectOk("get_call: both people read it with everyone it rang; a stranger reads nothing", async () => {
  const c = await get(B, first.call_id);
  if (c.status !== "ringing" || c.participants.length !== 2 || !c.participants.find((p) => p.user_id === B && p.profile.full_name === "Bob")) throw new Error(JSON.stringify(c));
  if ((await get(D, first.call_id)) !== null) throw new Error("a stranger read the call");
});
await expectOk("current_call: the chat's call going on now, or null", async () => {
  const c = await as(B, async () => (await one(db.query("select public.current_call($1) as r", [AB]))).r);
  if (c?.id !== first.call_id) throw new Error(JSON.stringify(c));
  const none = await as(A, async () => (await one(db.query("select public.current_call($1) as r", [GROUP]))).r);
  if (none !== null) throw new Error(JSON.stringify(none));
});
await expectOk("start again: a second tap joins the call going on rather than starting another", async () => {
  const again = await start(A, AB);
  if (again.joined !== true || again.call_id !== first.call_id) throw new Error(JSON.stringify(again));
});
await expectOk("answer: the call is active, the row and the inbox line follow", async () => {
  const c = await answer(B, first.call_id);
  if (c.status !== "active" || !c.answered_at) throw new Error(JSON.stringify(c));
  const s = await states(first.call_id);
  if (s[B] !== "joined") throw new Error(JSON.stringify(s));
  const row = await callRow(A, first.message_id);
  if (row.status !== "active" || callRowText(row, A).detail !== "In progress") throw new Error(JSON.stringify(row));
});
await expectOk("hang up: one leaving keeps the call going; the last one ends it, completed, with its length", async () => {
  await leave(B, first.call_id);
  if ((await get(A, first.call_id)).status !== "active") throw new Error("ended too early");
  await db.query("update public.calls set answered_at = answered_at - interval '3 minutes 24 seconds' where id = $1", [first.call_id]);
  await leave(A, first.call_id);
  const c = await get(A, first.call_id);
  if (c.status !== "ended" || c.ended_reason !== "completed") throw new Error(JSON.stringify(c));
  const row = await callRow(B, first.message_id);
  if (row.status !== "ended" || row.ended_reason !== "completed" || row.duration < 204 || row.duration > 206) throw new Error(JSON.stringify(row));
  if (callRowText(row, B).detail !== "3:24" || (await preview(AB)) !== "Audio call") throw new Error(JSON.stringify(row));
  if ((await notifications(B, "call")).length !== 0) throw new Error("a completed call must not notify");
});
await expectOk("over: answering it again only hands it back, ended", async () => {
  const c = await answer(B, first.call_id);
  if (c.status !== "ended") throw new Error(JSON.stringify(c));
});

// --- declined and cancelled ---------------------------------------------------------------------------------------------
await expectOk("decline: the only person rung declining ends the call, declined", async () => {
  const c = await start(A, AB, "video");
  await decline(B, c.call_id);
  const row = await callRow(A, c.message_id);
  if (row.status !== "ended" || row.ended_reason !== "declined" || (await preview(AB)) !== "Video call declined") throw new Error(JSON.stringify(row) + " " + (await preview(AB)));
  if (callRowText(row, B).detail !== "Declined" || callRowText(row, A).detail !== "Declined") throw new Error("row text");
  if ((await notifications(B, "call")).length !== 0) throw new Error("a declined call must not notify");
});
await expectOk("cancel: the caller hanging up before an answer makes it a missed call, with its notification", async () => {
  const c = await start(A, AB);
  await leave(A, c.call_id);
  const s = await states(c.call_id);
  if (s[B] !== "missed" || s[A] !== "left") throw new Error(JSON.stringify(s));
  const row = await callRow(B, c.message_id);
  if (row.status !== "ended" || row.ended_reason !== "missed" || (await preview(AB)) !== "Missed audio call") throw new Error(JSON.stringify(row));
  if (callRowText(row, B).title !== "Missed audio call" || callRowText(row, A).detail !== "No answer") throw new Error("row text");
  const n = await notifications(B, "call");
  if (n.length !== 1 || n[0].title !== "Alice" || n[0].body !== missedCallBody("audio") || n[0].data.call_id !== c.call_id) throw new Error(JSON.stringify(n));
});
await expectOk("a ring that runs out is missed too, closed by the next call anyone makes", async () => {
  const c = await start(A, AB);
  await db.query("update public.calls set started_at = started_at - interval '2 minutes' where id = $1", [c.call_id]);
  const late = await answer(B, c.call_id);
  if (late.status !== "ended" || late.ended_reason !== "missed") throw new Error("answering a ring that ran out: " + JSON.stringify(late));
  const row = await callRow(B, c.message_id);
  if (row.status !== "ended" || row.ended_reason !== "missed") throw new Error(JSON.stringify(row));
  if ((await notifications(B, "call")).length !== 2) throw new Error("the missed call should notify");
});

// --- a group call --------------------------------------------------------------------------------------------------------
await expectOk("group: everyone else rings; one declining and one answering makes it active; the decliner can still join late", async () => {
  const c = await start(A, GROUP, "video");
  let s = await states(c.call_id);
  if (s[A] !== "joined" || s[B] !== "ringing" || s[C] !== "ringing") throw new Error(JSON.stringify(s));
  await decline(C, c.call_id);
  if ((await get(A, c.call_id)).status !== "ringing") throw new Error("one decline must not end a group call still ringing someone");
  await answer(B, c.call_id);
  s = await states(c.call_id);
  if (s[C] !== "declined" || s[B] !== "joined" || (await get(A, c.call_id)).status !== "active") throw new Error(JSON.stringify(s));
  await answer(C, c.call_id);
  if ((await states(c.call_id))[C] !== "joined") throw new Error("late join failed");
  await leave(A, c.call_id);
  await leave(B, c.call_id);
  if ((await get(C, c.call_id)).status !== "active") throw new Error("the call must go on while Carol is in it");
  await leave(C, c.call_id);
  const row = await callRow(A, c.message_id);
  if (row.status !== "ended" || row.ended_reason !== "completed" || (await preview(GROUP)) !== "Video call") throw new Error(JSON.stringify(row));
});
await expectOk("group: everyone declining ends it declined; nobody is notified of a missed call", async () => {
  const c = await start(A, GROUP);
  await decline(B, c.call_id);
  await decline(C, c.call_id);
  const row = await callRow(A, c.message_id);
  if (row.status !== "ended" || row.ended_reason !== "declined") throw new Error(JSON.stringify(row));
  if ((await notifications(C, "call")).length !== 0) throw new Error("declining is not missing");
});

// --- refused ---------------------------------------------------------------------------------------------------------------
await expectError("a stranger cannot start a call in a chat", () => start(D, AB), "your own chats");
await expectError("nor answer one", async () => { const c = await start(A, AB); try { await answer(D, c.call_id); } finally { await leave(A, c.call_id); } }, "isn't available");
await expectError("a call is audio or video", () => start(A, AB, "hologram"), "audio or video");
await expectError("nobody writes a call row from the API", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, call) values ($1,$2,'',$3::jsonb)", [AB, A, JSON.stringify({ id: randomUUID(), kind: "audio", status: "ringing" })])), "start_call()");
await expectError("nobody changes one from the API either (an update finds no row)", async () => {
  const c = await start(A, AB);
  try {
    const r = await as(B, () => db.query("update public.messages set call = null where id = $1 returning id", [c.message_id]));
    if (r.rows.length === 0) throw new Error("no row");
  } finally {
    await leave(A, c.call_id);
  }
}, "no row");
await expectOk("the API reads calls only in its own chats", async () => {
  const mine = await as(B, () => rows(db.query("select id from public.calls")));
  const theirs = await as(D, () => rows(db.query("select id from public.calls")));
  if (mine.length === 0 || theirs.length !== 0) throw new Error(`${mine.length} / ${theirs.length}`);
  await expectError("…and never writes them", () => as(B, () => db.query("insert into public.calls (conversation_id, started_by, kind) values ($1,$2,'audio')", [AB, B])), "permission denied");
});
await expectOk("the inbox line: words win, a call reads as callPreview() says, and the older preview forms still answer", async () => {
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'words')", [AB, A]));
  if ((await preview(AB)) !== "words") throw new Error(await preview(AB));
  const p = await one(db.query("select public.call_preview($1::jsonb) as a, public.call_preview($2::jsonb) as b, public.call_preview($3::jsonb) as c, public.call_preview(null) as d, public.message_preview('', null, '[]'::jsonb, null::jsonb) as e, public.message_preview('', null, '[{\"kind\":\"image\"}]'::jsonb, 140) as f", [JSON.stringify({ kind: "audio", status: "ringing" }), JSON.stringify({ kind: "video", status: "ended", ended_reason: "missed" }), JSON.stringify({ kind: "video", status: "ended", ended_reason: "declined" })]));
  if (p.a !== "Audio call" || p.b !== "Missed video call" || p.c !== "Video call declined" || p.d !== null || p.e !== null || p.f !== "Sent a photo") throw new Error(JSON.stringify(p));
  for (const [call, want] of [[{ kind: "audio", status: "ringing", ended_reason: null }, p.a], [{ kind: "video", status: "ended", ended_reason: "missed" }, p.b], [{ kind: "video", status: "ended", ended_reason: "declined" }, p.c]]) if (callPreview(call) !== want) throw new Error("apps and database disagree on " + want);
});
await expectOk("the migration re-runs cleanly with data in place", () => db.exec(read(MIGRATION)));
done("MIGRATION-35 CALLS");
