// The whole life of a call between real accounts on the live project, through the same API the apps use: a direct
// call rung, seen by both as a row in the chat, answered, hung up with its duration; one declined; one that the
// caller gives up on (missed, with the other side's notification); a group call that some decline and some join
// late; a stranger refused; and the token function's answer (a token once LiveKit is set up on the server, otherwise
// its "not set up yet" refusal). Needs SUPABASE_ACCESS_TOKEN (to make and remove its throwaway accounts); everything
// else runs signed in as them. Leaves nothing behind.
//   SUPABASE_ACCESS_TOKEN=sbp_… node apps/mobile/e2e/call-lifecycle.mjs
import { createClient } from "@supabase/supabase-js";

const ref = "dskbzoqreandwwpxiplh";
const url = `https://${ref}.supabase.co`;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })).json();
const anonKey = keys.find((k) => k.name === "anon").api_key;
const admin = createClient(url, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${e?.message ?? e}`); };
const check = async (n, fn) => { try { await fn(); ok(n); } catch (e) { fail(n, e); } };
const expectThrow = async (n, fn, m) => { try { await fn(); fail(n, "no error"); } catch (e) { if (!m || (e.message ?? "").includes(m)) ok(n); else fail(n, e.message); } };
const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

const stamp = Date.now();
const password = `Call-${stamp}-pass!`;
const users = [];
async function mk(name) {
  const email = `call-${name.toLowerCase()}-${stamp}@txstate.edu`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Call ${name}` } });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await client.auth.signInWithPassword({ email, password }));
  users.push(data.user.id);
  return { id: data.user.id, name: `Call ${name}`, client };
}
const start = async (who, conversationId, kind) => must(await who.client.rpc("start_call", { p_conversation_id: conversationId, p_kind: kind }));
const get = async (who, callId) => must(await who.client.rpc("get_call", { p_call_id: callId }));
const answer = async (who, callId) => must(await who.client.rpc("answer_call", { p_call_id: callId }));
const decline = async (who, callId) => must(await who.client.rpc("decline_call", { p_call_id: callId }));
const leave = async (who, callId) => must(await who.client.rpc("leave_call", { p_call_id: callId }));
const rowOf = async (who, messageId) => must(await who.client.from("messages").select("call").eq("id", messageId).single()).call;
const stateOf = (call, userId) => call.participants.find((p) => p.user_id === userId)?.state;

try {
  const A = await mk("Alice");
  const B = await mk("Bob");
  const C = await mk("Carol");
  const S = await mk("Sam");
  console.log(`Accounts made (${A.name}, ${B.name}, ${C.name}, ${S.name}); running the call lifecycle on ${ref}…`);
  const AB = must(await A.client.rpc("get_or_create_direct_conversation", { p_other_user_id: B.id }));

  let first;
  await check("a direct audio call rings the other person, and is a row in the chat on both sides", async () => {
    first = await start(A, AB, "audio");
    const c = await get(B, first.call_id);
    if (c.status !== "ringing" || c.kind !== "audio" || stateOf(c, A.id) !== "joined" || stateOf(c, B.id) !== "ringing") throw new Error(JSON.stringify(c));
    const row = await rowOf(B, first.message_id);
    if (row.status !== "ringing" || row.id !== first.call_id) throw new Error(JSON.stringify(row));
    const inbox = must(await B.client.from("conversations").select("last_message_preview").eq("id", AB).single());
    if (inbox.last_message_preview !== "Audio call") throw new Error(inbox.last_message_preview);
  });
  await check("current_call() finds it for the chat; nothing rings the caller back", async () => {
    const c = must(await B.client.rpc("current_call", { p_conversation_id: AB }));
    if (c?.id !== first.call_id) throw new Error(JSON.stringify(c));
    const n = must(await B.client.from("notifications").select("type").eq("type", "message"));
    if (n.length !== 0) throw new Error("the call's row sent a message notification");
  });
  await check("answered: the call is active, the row follows", async () => {
    const c = await answer(B, first.call_id);
    if (c.status !== "active" || !c.answered_at || stateOf(c, B.id) !== "joined") throw new Error(JSON.stringify(c));
    if ((await rowOf(A, first.message_id)).status !== "active") throw new Error("row not active");
  });
  await check("the server's LiveKit key pair opens its project (once the secrets are set)", async () => {
    const { data, error } = await B.client.functions.invoke("livekit-token", { body: { check: true } });
    const body = error && error.context ? await error.context.json().catch(() => null) : data;
    if (body?.error === "Calls aren't set up on the server yet.") return ok("  (no LiveKit secrets yet)");
    if (body?.ok === true) return ok(`  LiveKit accepted the key pair for ${body.url_shape}`);
    throw new Error(`LiveKit refused the server's key pair (${body?.status} ${body?.detail}); key ${body?.key_shape}, secret ${body?.secret_shape}, url ${body?.url_shape}. Set LIVEKIT_API_KEY / LIVEKIT_API_SECRET again from the LiveKit Cloud project at that URL (Settings → Keys).`);
  });
  await check("the token function answers: a token (LiveKit set up) or its refusal (not yet)", async () => {
    const { data, error } = await B.client.functions.invoke("livekit-token", { body: { call_id: first.call_id } });
    const body = error && error.context ? await error.context.json().catch(() => null) : data;
    if (data?.token && data?.url) return ok(`  LiveKit is set up: token for ${data.url}`);
    if (body?.error === "Calls aren't set up on the server yet.") return ok("  (no LiveKit secrets yet: the function refuses as designed)");
    throw new Error(JSON.stringify(body ?? error?.message));
  });
  await check("a stranger gets no token for it", async () => {
    const { data, error } = await C.client.functions.invoke("livekit-token", { body: { call_id: first.call_id } });
    const body = error && error.context ? await error.context.json().catch(() => null) : data;
    if (data?.token) throw new Error("a token was minted for a stranger");
    if (!body?.error) throw new Error(JSON.stringify(body ?? error?.message));
  });
  await check("hung up by both: completed, with its duration on the row for both", async () => {
    await leave(B, first.call_id);
    await leave(A, first.call_id);
    const c = await get(A, first.call_id);
    if (c.status !== "ended" || c.ended_reason !== "completed") throw new Error(JSON.stringify(c));
    const row = await rowOf(B, first.message_id);
    if (row.status !== "ended" || row.ended_reason !== "completed" || typeof row.duration !== "number") throw new Error(JSON.stringify(row));
  });

  await check("declined: the row says so, and the call is over", async () => {
    const c = await start(A, AB, "video");
    await decline(B, c.call_id);
    const row = await rowOf(A, c.message_id);
    if (row.status !== "ended" || row.ended_reason !== "declined") throw new Error(JSON.stringify(row));
    const inbox = must(await A.client.from("conversations").select("last_message_preview").eq("id", AB).single());
    if (inbox.last_message_preview !== "Video call declined") throw new Error(inbox.last_message_preview);
  });
  await check("given up on: the caller hangs up while it rings, the other side has a missed call and its notification", async () => {
    const c = await start(A, AB, "audio");
    await leave(A, c.call_id);
    const row = await rowOf(B, c.message_id);
    if (row.status !== "ended" || row.ended_reason !== "missed") throw new Error(JSON.stringify(row));
    const n = must(await B.client.from("notifications").select("type, body, link").eq("type", "call"));
    if (!n.some((x) => x.body === "Missed audio call" && x.link === `/messages/${AB}`)) throw new Error(JSON.stringify(n));
  });
  await expectThrow("a stranger cannot call into a chat", () => start(C, AB, "audio"), "your own chats");
  await expectThrow("nobody can write a call's row by hand", () => A.client.from("messages").insert({ conversation_id: AB, content: "", call: { id: first.call_id, kind: "audio", status: "active" } }).then(must), "start_call()");

  const G = must(await A.client.rpc("create_group_conversation", { p_name: `Calls ${stamp}`, p_member_ids: [B.id, C.id, S.id] }));
  await check("a group call rings everyone; one declines, one answers, one joins late, the last to leave ends it", async () => {
    const c = await start(A, G, "video");
    const rung = await get(B, c.call_id);
    if (rung.participants.filter((p) => p.state === "ringing").length !== 3) throw new Error(JSON.stringify(rung));
    await decline(C, c.call_id);
    if ((await get(A, c.call_id)).status !== "ringing") throw new Error("a decline should not end a group call that still rings others");
    await answer(B, c.call_id);
    if ((await get(A, c.call_id)).status !== "active") throw new Error("not active after an answer");
    await leave(A, c.call_id);
    if ((await get(B, c.call_id)).status !== "active") throw new Error("the call should go on while someone is in it");
    const late = await answer(S, c.call_id);
    if (stateOf(late, S.id) !== "joined") throw new Error("late join refused");
    await leave(B, c.call_id);
    await leave(S, c.call_id);
    const over = await get(A, c.call_id);
    if (over.status !== "ended" || over.ended_reason !== "completed") throw new Error(JSON.stringify(over));
  });
  await check("a group call everyone declines is declined", async () => {
    const c = await start(A, G, "audio");
    await decline(B, c.call_id);
    await decline(C, c.call_id);
    await decline(S, c.call_id);
    const row = await rowOf(A, c.message_id);
    if (row.status !== "ended" || row.ended_reason !== "declined") throw new Error(JSON.stringify(row));
  });
} catch (e) {
  fail("setup", e);
} finally {
  const { data: convs } = await admin.from("conversation_members").select("conversation_id").in("user_id", users);
  for (const c of new Set((convs ?? []).map((c) => c.conversation_id))) await admin.from("conversations").delete().eq("id", c);
  for (const id of users) await admin.auth.admin.deleteUser(id);
  console.log("cleaned up the test accounts and their data");
}
console.log(failures ? `${failures} FAILED` : "ALL LIVE CALL LIFECYCLE CHECKS PASSED");
process.exit(failures ? 1 : 0);
