// Migration 40 (joining the presence channel) against PGlite and a stand-in realtime schema: Realtime's join check reads
// the topic with a broadcast message, so reading 'presence:active' is allowed for either kind to someone who shows their
// status; sending stays presence only; nothing on other topics; nothing for someone hiding their status, signed out, or
// a business account. The same against real Realtime: supabase/tests/staging/business-portal.mjs.
import { boot, read, expectOk, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await db.exec(`create schema realtime;
  create table realtime.messages (id bigserial primary key, topic text not null, extension text not null, event text, payload jsonb, private boolean not null default true, inserted_at timestamptz not null default now());
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '')::text $$;
  grant usage on schema realtime to anon, authenticated;
  grant select, insert on realtime.messages to anon, authenticated;
  grant usage on sequence realtime.messages_id_seq to anon, authenticated;`);
// Migration 22 makes its two policies once there is a realtime schema; 40 then corrects the read one.
await db.exec(read("migrations/20261011000000_activity_status.sql"));
await expectOk("the migration runs over migration 22's policies, twice", async () => {
  await db.exec(read("migrations/20261102000000_presence_channel_join.sql"));
  await db.exec(read("migrations/20261102000000_presence_channel_join.sql"));
  const p = (await db.query("select policyname from pg_policies where schemaname = 'realtime' order by 1")).rows.map((r) => r.policyname).join(",");
  if (p !== "presence_active_insert,presence_active_select") throw new Error(p);
});
const TOPIC = "presence:active";
for (const topic of [TOPIC, "online", "conversation:1"]) for (const extension of ["presence", "broadcast"]) {
  await db.query("insert into realtime.messages (topic, extension) values ($1, $2)", [topic, extension]);
}
const onTopic = async (who, topic, fn) => {
  const run = async () => {
    await db.query("select set_config('realtime.topic', $1, false)", [topic]);
    try { return await fn(); } finally { await db.query("select set_config('realtime.topic', '', false)"); }
  };
  return who ? as(who, run) : asAnon(run);
};
const reads = (who, topic, extension) => onTopic(who, topic, async () => (await db.query("select count(*)::int as n from realtime.messages where topic = $1 and extension = $2", [topic, extension])).rows[0].n > 0);
const sends = (who, topic, extension) => onTopic(who, topic, async () => {
  try { await db.query("insert into realtime.messages (topic, extension) values ($1, $2)", [topic, extension]); return true; } catch { return false; }
});

const vera = await mk("vera@txstate.edu", "Vera Shown"), hana = await mk("hana@txstate.edu", "Hana Hidden");
await db.query("update public.profiles set show_active_status = false where id = $1", [hana]);
const biz = (await db.query("insert into auth.users (email, raw_user_meta_data) values ('owner@shop.example', $1) returning id", [JSON.stringify({ account_type: "business", full_name: "Shop Owner", business_name: "Shop" })])).rows[0].id;

await expectOk("someone who shows their status passes Realtime's join check (a broadcast read) and reads and tracks presence", async () => {
  if (!(await reads(vera, TOPIC, "broadcast")) || !(await reads(vera, TOPIC, "presence")) || !(await sends(vera, TOPIC, "presence"))) throw new Error("shut out");
});
await expectOk("still no broadcasts sent on the topic, and nothing on any other topic", async () => {
  if (await sends(vera, TOPIC, "broadcast")) throw new Error("sent a broadcast");
  for (const topic of ["online", "conversation:1"]) for (const extension of ["presence", "broadcast"]) {
    if ((await reads(vera, topic, extension)) || (await sends(vera, topic, extension))) throw new Error(`${extension} on ${topic}`);
  }
});
await expectOk("nothing for someone hiding their status, a business account (always hidden) or a signed-out visitor", async () => {
  for (const [who, id] of [["hidden", hana], ["business", biz], ["signed out", null]]) {
    for (const extension of ["presence", "broadcast"]) {
      if (await reads(id, TOPIC, extension)) throw new Error(`${who} reads ${extension}`);
    }
    if (await sends(id, TOPIC, "presence")) throw new Error(`${who} tracks`);
  }
});
done("MIGRATION-40 PRESENCE CHANNEL JOIN");
