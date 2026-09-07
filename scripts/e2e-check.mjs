#!/usr/bin/env node
/**
 * Live end-to-end check against your real Supabase project.
 * Creates two temporary users, exercises listings, chat (incl. realtime), storage,
 * then deletes everything it created.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=abcdefghij node scripts/e2e-check.mjs
 * or
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/e2e-check.mjs
 */
import { createClient } from "@supabase/supabase-js";

let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (process.env.SUPABASE_ACCESS_TOKEN) {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Could not fetch API keys: ${res.status} ${await res.text()}`);
  const keys = await res.json();
  url = `https://${ref}.supabase.co`;
  anonKey = (keys.find((k) => k.name === "anon") ?? keys.find((k) => /publishable/.test(k.name)))?.api_key;
  serviceKey = (keys.find((k) => k.name === "service_role") ?? keys.find((k) => /secret/.test(k.name)))?.api_key;
}
if (!url || !anonKey || !serviceKey) {
  console.error("Missing configuration. See the comment at the top of this file.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const password = `Test-${stamp}-pass!`;
const created = { users: [], conversations: [], files: [] };
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m, e) => { failures++; console.log(`  ✗ ${m}: ${e?.message ?? e}`); };
async function step(name, fn) { try { const r = await fn(); ok(name); return r; } catch (e) { bad(name, e); return undefined; } }

async function userClient(email, name) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw error;
  created.users.push(data.user.id);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, id: data.user.id };
}

console.log(`Checking ${url}\n`);
try {
  console.log("Auth & profiles");
  const alice = await step("create + sign in user A", () => userClient(`e2e-alice-${stamp}@txstate.edu`, "E2E Alice"));
  const bob = await step("create + sign in user B", () => userClient(`e2e-bob-${stamp}@txstate.edu`, "E2E Bob"));
  if (!alice || !bob) throw new Error("cannot continue without users");

  await step("profile rows were auto-created", async () => {
    const { data, error } = await alice.client.from("profiles").select("id, full_name").in("id", [alice.id, bob.id]);
    if (error) throw error;
    if (data.length !== 2 || !data.some((p) => p.full_name === "E2E Alice")) throw new Error(JSON.stringify(data));
  });
  const uni = await step("universities are seeded", async () => {
    const { data, error } = await alice.client.from("universities").select("id, name").limit(1);
    if (error) throw error;
    if (!data.length) throw new Error("no universities; run the seed");
    return data[0];
  });
  await step("A sets her university", async () => {
    const { error } = await alice.client.from("profiles").update({ university_id: uni?.id ?? null, bio: "e2e" }).eq("id", alice.id);
    if (error) throw error;
  });
  await step("B cannot edit A's profile", async () => {
    const { data, error } = await bob.client.from("profiles").update({ bio: "hacked" }).eq("id", alice.id).select();
    if (error) throw error;
    if (data.length) throw new Error("update leaked");
  });
  await step("sign-ups from other domains are rejected", async () => {
    const { error } = await admin.auth.admin.createUser({ email: `e2e-outsider-${stamp}@gmail.com`, password, email_confirm: true });
    if (!error) throw new Error("gmail user was created");
  });
  await step("txstate.edu users are attached to Texas State automatically", async () => {
    const { data, error } = await alice.client.from("profiles").select("university:universities(name, email_domain)").eq("id", alice.id).single();
    if (error) throw error;
    if (data.university?.email_domain !== "txstate.edu") throw new Error(JSON.stringify(data));
  });
  await step("allowed_email_domains() lists txstate.edu", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await anon.rpc("allowed_email_domains");
    if (error) throw error;
    if (!data.includes("txstate.edu")) throw new Error(JSON.stringify(data));
  });

  console.log("\nListings");
  const apt = await step("A posts an apartment", async () => {
    const { data, error } = await alice.client.from("apartments").insert({
      owner_id: alice.id, university_id: uni?.id ?? null, title: "E2E sunny room", description: "Automated test listing, will be deleted.",
      price_per_month: 650, address: "1 Test Street", amenities: ["wifi"], images: [],
    }).select("id").single();
    if (error) throw error;
    return data;
  });
  await step("anonymous visitor sees it with the owner name (nested select)", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await anon.from("apartments").select("id, title, owner:profiles!apartments_owner_id_fkey(full_name), university:universities(name)").eq("id", apt.id).single();
    if (error) throw error;
    if (data.owner?.full_name !== "E2E Alice") throw new Error(JSON.stringify(data));
  });
  await step("B cannot edit A's listing", async () => {
    const { data, error } = await bob.client.from("apartments").update({ title: "pwned" }).eq("id", apt.id).select();
    if (error) throw error;
    if (data.length) throw new Error("update leaked");
  });
  await step("a pinned listing gets its distance to campus computed, and radius search finds it", async () => {
    const { data: tx } = await alice.client.from("universities").select("id").eq("email_domain", "txstate.edu").single();
    const { data: near, error } = await alice.client.from("apartments").insert({
      owner_id: alice.id, university_id: tx.id, title: "E2E pinned room", description: "Automated test listing with a map pin.",
      price_per_month: 600, address: "Near campus", latitude: 29.8899, longitude: -97.94,
    }).select("id, distance_km").single();
    if (error) throw error;
    if (!(near.distance_km > 0.05 && near.distance_km < 0.5)) throw new Error(`distance_km = ${near.distance_km}`);
    const { data: within, error: e2 } = await alice.client.rpc("apartments_within", { p_university_id: tx.id, p_radius_m: 3218 }).select("id, title, owner:profiles!apartments_owner_id_fkey(full_name)");
    if (e2) throw e2;
    if (!within.some((a) => a.id === near.id)) throw new Error("pinned listing not found within 2 miles");
    if (within.some((a) => a.id === apt.id)) throw new Error("unpinned listing wrongly included");
  });
  await step("B registers a push token; A cannot see it", async () => {
    const { error } = await bob.client.from("device_push_tokens").upsert({ user_id: bob.id, token: `ExponentPushToken[e2e-${stamp}]`, platform: "ios" }, { onConflict: "token" });
    if (error) throw error;
    const { data } = await alice.client.from("device_push_tokens").select("id");
    if (data.length) throw new Error("token visible to another user");
  });
  await step("B posts a marketplace item and a roommate post", async () => {
    const { error: e1 } = await bob.client.from("items").insert({ seller_id: bob.id, title: "E2E mattress", description: "test item", price: 20, category: "mattress_bedding" });
    if (e1) throw e1;
    const { error: e2 } = await bob.client.from("roommate_posts").insert({ author_id: bob.id, post_type: "needs_room", title: "E2E roommate post", description: "test roommate post" });
    if (e2) throw e2;
  });
  await step("A saves B's item and reads it back", async () => {
    const { data: item } = await bob.client.from("items").select("id").eq("seller_id", bob.id).single();
    const { error } = await alice.client.from("saved_listings").insert({ user_id: alice.id, target_type: "item", target_id: item.id });
    if (error) throw error;
    const { data } = await alice.client.from("saved_listings").select("target_id").eq("user_id", alice.id);
    if (data.length !== 1) throw new Error("saved row missing");
  });

  console.log("\nMessaging");
  const dm = await step("A opens a direct chat with B (RPC)", async () => {
    const { data, error } = await alice.client.rpc("get_or_create_direct_conversation", { p_other_user_id: bob.id });
    if (error) throw error;
    created.conversations.push(data);
    return data;
  });
  await step("B gets the same conversation id", async () => {
    const { data, error } = await bob.client.rpc("get_or_create_direct_conversation", { p_other_user_id: alice.id });
    if (error) throw error;
    if (data !== dm) throw new Error("ids differ");
  });

  let resolveEvent, rejectEvent;
  const realtimeReceived = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject; });
  await step("B subscribes to the conversation in realtime", () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("subscription not confirmed within 15s")), 15000);
    bob.client
      .channel(`e2e:${dm}`, { config: { postgres_changes_options: { wait: true } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${dm}` }, (payload) => resolveEvent(payload.new))
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); const e = new Error(`realtime ${status} ${err?.message ?? ""}`); reject(e); rejectEvent(e); }
      });
  }));
  setTimeout(() => rejectEvent(new Error("no realtime event within 15s")), 15000);

  await step("A sends a message", async () => {
    const { error } = await alice.client.from("messages").insert({ conversation_id: dm, sender_id: alice.id, content: "Hello from the e2e test" });
    if (error) throw error;
  });
  await step("B receives it in realtime", async () => {
    const row = await realtimeReceived;
    if (row.content !== "Hello from the e2e test") throw new Error(JSON.stringify(row));
  });
  await step("conversation preview + unread count updated for B", async () => {
    const { data: conv } = await bob.client.from("conversations").select("last_message_preview").eq("id", dm).single();
    if (!conv?.last_message_preview?.startsWith("Hello")) throw new Error("preview not set");
    const { data: unread, error } = await bob.client.rpc("get_total_unread");
    if (error) throw error;
    if (Number(unread) !== 1) throw new Error(`unread = ${unread}`);
    await bob.client.rpc("mark_conversation_read", { p_conversation_id: dm });
    const { data: after } = await bob.client.rpc("get_total_unread");
    if (Number(after) !== 0) throw new Error(`still ${after}`);
  });
  await step("A cannot spoof a message from B", async () => {
    const { error } = await alice.client.from("messages").insert({ conversation_id: dm, sender_id: bob.id, content: "spoof" });
    if (!error) throw new Error("insert was allowed");
  });
  await step("B creates a group with A; both are members", async () => {
    const { data: groupId, error } = await bob.client.rpc("create_group_conversation", { p_name: "E2E group", p_member_ids: [alice.id] });
    if (error) throw error;
    created.conversations.push(groupId);
    const { data: members } = await alice.client.from("conversation_members").select("user_id").eq("conversation_id", groupId);
    if (members.length !== 2) throw new Error(`members = ${members.length}`);
  });

  console.log("\nStorage");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await step("A uploads a photo to her folder and gets a public URL", async () => {
    const path = `apartments/${alice.id}/e2e-${stamp}.png`;
    const { error } = await alice.client.storage.from("uploads").upload(path, png, { contentType: "image/png" });
    if (error) throw error;
    created.files.push(path);
    const publicUrl = alice.client.storage.from("uploads").getPublicUrl(path).data.publicUrl;
    const res = await fetch(publicUrl);
    if (!res.ok) throw new Error(`public URL returned ${res.status}`);
  });
  await step("A cannot upload into B's folder", async () => {
    const { error } = await alice.client.storage.from("uploads").upload(`apartments/${bob.id}/e2e-${stamp}.png`, png, { contentType: "image/png" });
    if (!error) { created.files.push(`apartments/${bob.id}/e2e-${stamp}.png`); throw new Error("upload was allowed"); }
  });
  await Promise.all([alice.client.removeAllChannels(), bob.client.removeAllChannels()]);
} catch (e) {
  bad("aborted", e);
} finally {
  console.log("\nCleanup");
  if (created.files.length) await admin.storage.from("uploads").remove(created.files);
  for (const id of created.conversations) await admin.from("conversations").delete().eq("id", id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  ok(`removed ${created.users.length} test users, ${created.conversations.length} conversations, ${created.files.length} files`);
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL LIVE CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}
