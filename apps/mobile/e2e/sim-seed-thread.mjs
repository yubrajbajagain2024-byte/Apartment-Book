// Adds a Reddit-like conversation (nested replies + votes) to the seeded Buzz thread, through the real API.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const s = JSON.parse(fs.readFileSync(new URL(".sim-state.json", import.meta.url), "utf8"));
const as = async (u) => { const c = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); const r = await c.auth.signInWithPassword({ email: u.email, password: s.password }); if (r.error) throw r.error; return c; };
const me = await as(s.me), op = await as(s.other);
const reply = async (c, body, parent = null) => { const r = await c.rpc("buzz_reply", { p_post_id: s.buzzId, p_body: body, p_parent_id: parent }); if (r.error) throw r.error; return r.data; };
const a = await reply(me, "As a tenant in Texas you can send a demand letter. If they do not return it or give an itemised list within 30 days, you can sue for three times the deposit plus $100.");
const b = await reply(op, "I did not know about the 30 days. They sent nothing itemised, just an email.", a);
await reply(me, "Then you are in a strong spot. Keep that email and your move-out photos.", b);
const c2 = await reply(me, "Also check the Attorney for Students office on campus. It is free.");
await reply(op, "Booked an appointment, thank you!", c2);
for (const [cl, id, v] of [[op, a, 1], [op, c2, 1], [me, b, 1]]) await cl.rpc("buzz_comment_vote", { p_comment_id: id, p_value: v });
await op.rpc("buzz_vote", { p_post_id: s.buzzId, p_value: 0 }); await me.rpc("buzz_vote", { p_post_id: s.buzzId, p_value: 1 });
console.log("conversation seeded");
