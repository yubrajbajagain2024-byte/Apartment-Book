// Migration 26 (muting message notifications) against PGlite: a muted person, chat or all group chats withhold the
// message notice for the muter alone, a lapsed mute no longer does, and mutes are each person's own to see and set.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as } = await boot();
await expectOk("the mutes migration re-runs cleanly", async () => { await db.exec(read("migrations/20261019000000_notification_mutes.sql")); });
const one = async (p) => (await p).rows[0];
const count = async (sql, params) => Number((await one(db.query(sql, params))).n);

const A = await mk("a@txstate.edu", "Ada Adams"), B = await mk("b@txstate.edu", "Bo Bright"), C = await mk("c@txstate.edu", "Cy Cole");
const direct = async (from, to) => (await as(from, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [to])))).id;
const AB = await direct(A, B), AC = await direct(A, C);
const G = (await as(A, () => one(db.query("select public.create_group_conversation('Study group', array[$1, $2]::uuid[]) as id", [B, C])))).id;
const say = (who, conversation, text) => as(who, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3)", [conversation, who, text]));
const notices = (who, conversation) => count("select count(*)::int as n from public.notifications where user_id = $1 and type = 'message' and data ->> 'conversation_id' = $2", [who, conversation]);
const clearNotices = () => db.query("delete from public.notifications where type = 'message'");
const mute = (who, scope, target, until) => as(who, () => db.query("insert into public.notification_mutes (user_id, scope, target_id, until) values ($1, $2, $3, $4)", [who, scope, target, until]));
const unmute = (who) => as(who, () => db.query("delete from public.notification_mutes where user_id = $1", [who]));

await expectOk("unmuted, a message notifies the other members", async () => {
  await say(A, AB, "hi B"); await say(A, G, "hi all");
  if ((await notices(B, AB)) !== 1 || (await notices(B, G)) !== 1 || (await notices(C, G)) !== 1) throw new Error("notices missing");
});
await expectOk("muting a person withholds their messages' notices everywhere, for the muter alone", async () => {
  await clearNotices(); await mute(B, "user", A, null);
  await say(A, AB, "again"); await say(A, G, "again all");
  if ((await notices(B, AB)) !== 0 || (await notices(B, G)) !== 0) throw new Error("B was notified while A is muted");
  if ((await notices(C, G)) !== 1) throw new Error("C should still be notified");
  if ((await count("select count(*)::int as n from public.messages where conversation_id = $1", [AB])) !== 2) throw new Error("the messages themselves must still land");
});
await expectOk("unmuting brings the notices back", async () => {
  await clearNotices(); await unmute(B);
  await say(A, AB, "back"); if ((await notices(B, AB)) !== 1) throw new Error("B not notified after unmuting");
});
await expectOk("muting one chat withholds that chat's notices only", async () => {
  await clearNotices(); await mute(C, "conversation", G, null);
  await say(A, G, "group talk"); await say(A, AC, "just you");
  if ((await notices(C, G)) !== 0) throw new Error("C notified by the muted group");
  if ((await notices(C, AC)) !== 1) throw new Error("C should hear the direct chat");
  await unmute(C);
});
await expectOk("muting all group chats leaves direct chats alone", async () => {
  await clearNotices(); await mute(C, "all_groups", null, null);
  await say(A, G, "group again"); await say(A, AC, "direct again");
  if ((await notices(C, G)) !== 0) throw new Error("C notified by a group while all groups are muted");
  if ((await notices(C, AC)) !== 1) throw new Error("C should hear the direct chat");
  await unmute(C);
});
await expectOk("a mute with an end lifts by itself", async () => {
  await clearNotices();
  await mute(B, "user", A, new Date(Date.now() - 60_000).toISOString());
  await say(A, AB, "after the mute"); if ((await notices(B, AB)) !== 1) throw new Error("a lapsed mute still muted");
  await unmute(B);
  await mute(B, "user", A, new Date(Date.now() + 3_600_000).toISOString());
  await clearNotices(); await say(A, AB, "within the hour"); if ((await notices(B, AB)) !== 0) throw new Error("a live timed mute did not mute");
  await unmute(B);
});
await expectError("a mute for someone else cannot be written", () => mute(B, "user", A, null).then(() => as(C, () => db.query("insert into public.notification_mutes (user_id, scope, target_id) values ($1, 'user', $2)", [B, A]))));
await expectOk("mutes are their owner's to see", async () => {
  const seen = await as(C, () => db.query("select id from public.notification_mutes where user_id = $1", [B]));
  if (seen.rows.length !== 0) throw new Error("C can read B's mutes");
  const mine = await as(B, () => db.query("select id from public.notification_mutes where user_id = $1", [B]));
  if (mine.rows.length !== 1) throw new Error("B cannot read their own mute");
});
await expectError("'all_groups' takes no target and the others need one", () => mute(B, "all_groups", A, null), "notification_mutes_target_check");
done("MIGRATION-26 NOTIFICATION MUTES");
