// Migration 36: push notifications. Every notification notify() makes goes to the person's phones through Expo's
// push service (pg_net, stood in for here by a table of the requests), and a call rings the phones of everyone it
// rings. Run: node supabase/tests/push.test.mjs
import { boot, expectError, expectOk, done } from "./harness.mjs";

const { db, mk, as } = await boot();
const rows = async (p) => (await p).rows;
const one = async (q, params) => (await db.query(q, params)).rows[0];

// Stand-ins for pg_net and Vault: requests written down instead of made; secrets in a plain table.
await db.exec(`create schema net;
  create table net.requests (id bigserial primary key, url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language sql as $$ insert into net.requests (url, body, headers) values (url, body, headers) returning id $$;`);
const requests = async () => rows(db.query("select url, body, headers from net.requests order by id"));
const clear = () => db.exec("delete from net.requests");

const A = await mk("alice@txstate.edu", "Alice Push");
const B = await mk("bob@txstate.edu", "Bob Push");
const C = await mk("carol@txstate.edu", "Carol Push");
const TOKEN_IOS = "ExponentPushToken[bob-iphone]";
const TOKEN_ANDROID = "ExponentPushToken[bob-pixel]";
await as(B, () => db.query("insert into public.device_push_tokens (user_id, token, platform) values ($1, $2, 'ios'), ($1, $3, 'android'), ($1, 'apns-raw-token-not-expo', 'ios')", [B, TOKEN_IOS, TOKEN_ANDROID]));
const AB = (await as(A, () => one("select public.get_or_create_direct_conversation($1) as id", [B]))).id;

await expectError("send_push() is not for the API", () => as(A, () => db.query("select public.send_push($1, 't', 'b', '{}'::jsonb)", [B])), "permission denied");

await expectOk("a message pushes to each of the recipient's Expo tokens (never a raw one), with its link and kind", async () => {
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'hello there')", [AB, A]));
  const r = await requests();
  if (r.length !== 1 || r[0].url !== "https://exp.host/--/api/v2/push/send") throw new Error(JSON.stringify(r));
  const msgs = r[0].body;
  if (msgs.length !== 2 || !msgs.every((m) => m.to.startsWith("ExponentPushToken["))) throw new Error(JSON.stringify(msgs));
  const ios = msgs.find((m) => m.to === TOKEN_IOS);
  const android = msgs.find((m) => m.to === TOKEN_ANDROID);
  if (ios.title !== "Alice Push" || ios.body !== "hello there" || ios.data.type !== "message" || ios.data.link !== `/messages/${AB}` || ios.priority !== "high" || ios.sound !== "default") throw new Error(JSON.stringify(ios));
  if (android.channelId !== "default" || "channelId" in ios || "interruptionLevel" in android) throw new Error(JSON.stringify(msgs));
  if (r[0].headers["Content-Type"] !== "application/json" || "Authorization" in r[0].headers) throw new Error(JSON.stringify(r[0].headers));
});
await expectOk("a second message in the chat refreshes the one notification row, and pushes again", async () => {
  await clear();
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'and again')", [AB, A]));
  const r = await requests();
  if (r.length !== 1 || r[0].body[0].body !== "and again") throw new Error(JSON.stringify(r));
  const n = await rows(db.query("select count(*)::int as c from public.notifications where user_id = $1 and type = 'message'", [B]));
  if (n[0].c !== 1) throw new Error(`${n[0].c} rows`);
});
await expectOk("a muted chat pushes nothing", async () => {
  await clear();
  await as(B, () => db.query("insert into public.notification_mutes (user_id, scope, target_id) values ($1, 'conversation', $2)", [B, AB]));
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'muted?')", [AB, A]));
  if ((await requests()).length !== 0) throw new Error("pushed");
  await as(B, () => db.query("delete from public.notification_mutes where user_id = $1", [B]));
});
await expectOk("someone with no phone registered: no request at all, and nothing fails", async () => {
  await clear();
  await as(B, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'to alice')", [AB, B]));
  if ((await requests()).length !== 0) throw new Error("pushed to nobody");
});

let call;
await expectOk("a call rings the phones: 'Incoming audio call', who is calling, the Calls channel and the ring, gone after 45 seconds", async () => {
  await clear();
  call = await as(A, () => one("select public.start_call($1, 'audio') as r", [AB]));
  const r = await requests();
  if (r.length !== 1) throw new Error(JSON.stringify(r));
  const android = r[0].body.find((m) => m.to === TOKEN_ANDROID);
  const ios = r[0].body.find((m) => m.to === TOKEN_IOS);
  if (android.title !== "Incoming audio call" || android.body !== "Alice Push is calling" || android.channelId !== "calls" || android.sound !== "ring.wav" || android.ttl !== 45) throw new Error(JSON.stringify(android));
  if (android.data.type !== "call_ring" || android.data.call_id !== call.r.call_id || android.data.conversation_id !== AB || android.data.kind !== "audio") throw new Error(JSON.stringify(android.data));
  if (ios.interruptionLevel !== "time-sensitive" || "channelId" in ios) throw new Error(JSON.stringify(ios));
});
await expectOk("the caller giving up: the other side's missed call is pushed too (its notification row's words)", async () => {
  await clear();
  await as(A, () => db.query("select public.leave_call($1)", [call.r.call_id]));
  const r = await requests();
  if (r.length !== 1 || r[0].body[0].title !== "Alice Push" || r[0].body[0].body !== "Missed audio call" || r[0].body[0].data.type !== "call") throw new Error(JSON.stringify(r));
});
await expectOk("a group video call rings everyone with a phone, naming the group", async () => {
  await clear();
  const G = (await as(A, () => one("select public.create_group_conversation('Study crew', $1::uuid[]) as id", [[B, C]]))).id;
  const c = await as(A, () => one("select public.start_call($1, 'video') as r", [G]));
  const r = await requests();
  // Carol has no phone registered: one request, Bob's two phones.
  if (r.length !== 1 || r[0].body.length !== 2 || r[0].body[0].title !== "Incoming video call" || r[0].body[0].body !== "Alice Push is calling Study crew") throw new Error(JSON.stringify(r));
  await as(A, () => db.query("select public.leave_call($1)", [c.r.call_id]));
});
await expectOk("with an Expo access token in Vault, the request carries it", async () => {
  await db.exec(`create schema vault; create table vault.secrets (name text, secret text); create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
    insert into vault.secrets values ('expo_push_token', 'expo-secret-token');`);
  await clear();
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'with token')", [AB, A]));
  const r = await requests();
  if (r.length !== 1 || r[0].headers.Authorization !== "Bearer expo-secret-token") throw new Error(JSON.stringify(r));
});
await expectOk("a push that cannot be sent never fails what it rides on", async () => {
  await db.exec("create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$ begin raise exception 'pg_net is down'; end $$;");
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'still sent')", [AB, A]));
  const m = await rows(db.query("select content from public.messages where conversation_id = $1 and content = 'still sent'", [AB]));
  if (m.length !== 1) throw new Error("the message was lost");
});

done("MIGRATION-36 PUSH");
