// Someone to call while testing calls on your own phone, on the live project:
//
//   SUPABASE_ACCESS_TOKEN=sbp_… node apps/mobile/e2e/call-partners.mjs make [--with you@txstate.edu]
//     Makes three throwaway accounts (one to sign in with on your phone, two for the simulators), friends with each
//     other, with a direct chat between the phone's account and the first simulator's, and a group of all three.
//     --with adds your own account to both chats instead of the phone account, so you can test signed in as yourself.
//     Writes the logins to apps/mobile/e2e/.call-partners.json (git-ignored) and prints them.
//
//   SUPABASE_ACCESS_TOKEN=sbp_… node apps/mobile/e2e/call-partners.mjs bot <direct|group> [seconds]
//     A partner with a camera: answers the call ringing (or going on) in that chat as the first simulator account and
//     joins it from a headless Chrome with a fake camera and microphone (a moving test picture and a tone), for 60
//     seconds by default. Start the call from your phone first.
//
//   SUPABASE_ACCESS_TOKEN=sbp_… node apps/mobile/e2e/call-partners.mjs clean
//     Deletes the chats and the accounts it made (never your own account).
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ref = process.env.SUPABASE_PROJECT_REF ?? "dskbzoqreandwwpxiplh";
const url = `https://${ref}.supabase.co`;
const stateFile = new URL("./.call-partners.json", import.meta.url);
if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error("Set SUPABASE_ACCESS_TOKEN (a Supabase personal access token, sbp_…).");
  process.exit(1);
}
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })).json();
const anonKey = keys.find((k) => k.name === "anon").api_key;
const admin = createClient(url, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
async function signedIn(email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await client.auth.signInWithPassword({ email, password }));
  return client;
}

const [command, ...args] = process.argv.slice(2);

if (command === "make") {
  if (fs.existsSync(stateFile)) throw new Error("Partners already exist (apps/mobile/e2e/.call-partners.json): run clean first.");
  const withEmail = args[0] === "--with" ? args[1] : null;
  const tag = String(Math.floor(10000 + Math.random() * 90000));
  const password = `Call-${tag}-test`;
  const accounts = [];
  const names = withEmail ? ["Maya", "Leo"] : ["Phone", "Maya", "Leo"];
  for (const name of names) {
    const email = `cc-${name.toLowerCase()}-${tag}@txstate.edu`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name} Test` } });
    if (error) throw error;
    accounts.push({ role: name === "Phone" ? "phone" : "simulator", id: data.user.id, name: `${name} Test`, email, password });
  }
  let you = null;
  if (withEmail) {
    let id = null;
    for (let page = 1; page < 50 && !id; page++) {
      const list = must(await admin.auth.admin.listUsers({ page, perPage: 200 }));
      id = list.users.find((u) => (u.email ?? "").toLowerCase() === withEmail.toLowerCase())?.id ?? null;
      if (list.users.length < 200) break;
    }
    if (!id) throw new Error(`No account with the email ${withEmail}.`);
    you = { role: "you", id, email: withEmail };
  }
  const caller = you ?? accounts[0];
  const sims = accounts.filter((a) => a.role === "simulator");
  // Friends with each other (as follows both ways), so nothing lands in message requests.
  const everyone = [caller, ...sims];
  const follows = [];
  for (const a of everyone) for (const b of everyone) if (a.id !== b.id) follows.push({ follower_id: a.id, followee_id: b.id });
  must(await admin.from("follows").upsert(follows, { onConflict: "follower_id,followee_id", ignoreDuplicates: true }));
  // The chats are made by the first simulator account, so your own account is only ever added to them.
  const maker = await signedIn(sims[0].email, password);
  const direct = must(await maker.rpc("get_or_create_direct_conversation", { p_other_user_id: caller.id }));
  const group = must(await maker.rpc("create_group_conversation", { p_name: `Call test ${tag}`, p_member_ids: [caller.id, sims[1].id] }));
  fs.writeFileSync(stateFile, JSON.stringify({ tag, accounts, you, direct, group }, null, 2));
  console.log(`Made the call partners (tag ${tag}). Password for every test account: ${password}`);
  if (!you) console.log(`  Your phone:  ${accounts[0].email}`);
  else console.log(`  Your phone:  sign in as yourself (${you.email})`);
  console.log(`  Simulator 1: ${sims[0].email}   (${sims[0].name}, in the direct chat and the group)`);
  console.log(`  Simulator 2: ${sims[1].email}   (${sims[1].name}, in the group)`);
  console.log(`  Chats: "${sims[0].name}" (direct) and "Call test ${tag}" (group)`);
} else if (command === "bot") {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const which = args[0] === "group" ? state.group : state.direct;
  const seconds = Number(args[1] ?? 60);
  const sim = state.accounts.find((a) => a.role === "simulator");
  const client = await signedIn(sim.email, sim.password);
  const current = must(await client.rpc("current_call", { p_conversation_id: which }));
  if (!current) throw new Error("No call is ringing or going on in that chat: start one from your phone first.");
  const call = must(await client.rpc("answer_call", { p_call_id: current.id }));
  if (call.status === "ended") throw new Error("That call has ended.");
  const { data, error } = await client.functions.invoke("livekit-token", { body: { call_id: current.id } });
  if (error) throw error;
  console.log(`${sim.name} answered; joining from Chrome with a fake camera for ${seconds} s…`);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage();
    await page.goto("https://example.com");
    await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.js" });
    const seen = await page.evaluate(
      async ({ url, token, seconds }) => {
        // eslint-disable-next-line no-undef
        const room = new LivekitClient.Room();
        await room.connect(url, token);
        await room.localParticipant.enableCameraAndMicrophone();
        await new Promise((r) => setTimeout(r, seconds * 1000));
        const others = [...room.remoteParticipants.values()].map((p) => `${p.name || p.identity}: ${[...p.trackPublications.values()].map((t) => t.kind).join(", ") || "nothing"}`);
        await room.disconnect();
        return others;
      },
      { url: data.url, token: data.token, seconds },
    );
    console.log(`In the call it heard and saw: ${seen.join(" | ") || "nobody"}`);
  } finally {
    await browser.close();
    await client.rpc("leave_call", { p_call_id: current.id });
    console.log(`${sim.name} left the call.`);
  }
} else if (command === "clean") {
  if (!fs.existsSync(stateFile)) {
    console.log("Nothing to clean.");
    process.exit(0);
  }
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  for (const id of [state.direct, state.group]) await admin.from("conversations").delete().eq("id", id);
  const made = state.accounts.map((a) => a.id);
  if (state.you) await admin.from("follows").delete().or(made.map((id) => `and(follower_id.eq.${state.you.id},followee_id.eq.${id})`).join(","));
  for (const id of made) await admin.auth.admin.deleteUser(id);
  fs.unlinkSync(stateFile);
  console.log("Deleted the test chats and accounts.");
} else {
  console.log("Usage: node apps/mobile/e2e/call-partners.mjs make [--with you@txstate.edu] | bot <direct|group> [seconds] | clean");
}
