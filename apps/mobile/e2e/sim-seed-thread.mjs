// Adds a conversation (nested replies and votes) to the seeded Buzz thread, as the website's write API would: the guidelines
// gate first, then replies through the service-role write function (SUPABASE_ACCESS_TOKEN env, like sim-seed.mjs) and votes
// as each person. A reply to a reply to a reply comes back flattened under its depth-1 ancestor, with "replying to".
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { e2eRef } from "../../../scripts/e2e-target.mjs";
const s = JSON.parse(fs.readFileSync(new URL(".sim-state.json", import.meta.url), "utf8"));
const ref = s.ref ?? (await e2eRef(process.env.SUPABASE_ACCESS_TOKEN)); // the project sim-seed.mjs used
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })).json();
const admin = createClient(`https://${ref}.supabase.co`, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const anonKey = keys.find((k) => k.name === "anon").api_key;
const BUZZ_GUIDELINES_VERSION = "2026-10-21"; // packages/shared/src/buzz/constants.ts
const as = async (u) => {
  const c = createClient(`https://${ref}.supabase.co`, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await c.auth.signInWithPassword({ email: u.email, password: s.password });
  if (r.error) throw r.error;
  const g = await c.rpc("buzz_v2_accept_gate", { p_version: BUZZ_GUIDELINES_VERSION });
  if (g.error) throw g.error;
  return c;
};
const me = await as(s.me), op = await as(s.other);
const reply = async (author, text, parentId = undefined) => {
  const r = await admin.rpc("buzz_v2_reply", { p_author: author.id, p_thread: s.buzzId, p_input: parentId ? { text, parentId } : { text }, p_status: "active", p_support_link: false, p_moderation: { events: [], queue: null } });
  if (r.error) throw r.error;
  return r.data.id;
};
const a = await reply(s.me, "As a tenant in Texas you can send a demand letter. If they do not return it or give an itemised list within 30 days, you can sue for three times the deposit plus $100.");
const b = await reply(s.other, "I did not know about the 30 days. They sent nothing itemised, just an email.", a);
await reply(s.me, "Then you are in a strong spot. Keep that email and your move-out photos.", b);
const c2 = await reply(s.me, "Also check the Attorney for Students office on campus. It is free.");
await reply(s.other, "Booked an appointment, thank you!", c2);
// Nobody votes on their own words (the database refuses it): Maya on the test account's replies, the test account on hers and on the thread.
for (const [cl, id] of [[op, a], [op, c2], [me, b], [me, s.buzzId]]) {
  const v = await cl.rpc("buzz_v2_vote", { p_id: id, p_value: 1 });
  if (v.error) throw v.error;
}
console.log("conversation seeded");
