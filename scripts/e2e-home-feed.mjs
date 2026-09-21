// Live check of the Home-feed backend through the real API (PostgREST + Storage) with throwaway users.
// Usage: SUPABASE_ACCESS_TOKEN=sbp_... node scripts/e2e-home-feed.mjs
import { createClient } from "@supabase/supabase-js";
const ref = "dskbzoqreandwwpxiplh"; const url = `https://${ref}.supabase.co`;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })).json();
if (!Array.isArray(keys)) { console.error("Could not read API keys:", keys); process.exit(1); }
const anonKey = keys.find((k) => k.name === "anon").api_key; const serviceKey = keys.find((k) => k.name === "service_role").api_key;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now(); const password = `E2e-${stamp}-pass!`; const users = []; let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`); const bad = (m, e) => { failures++; console.log(`  ✗ ${m}: ${e?.message ?? e}`); };
const step = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };
async function makeUser(name) {
  const email = `e2e-${name.toLowerCase()}-${stamp}@txstate.edu`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `E2E ${name}` } }); if (error) throw error;
  users.push(data.user.id);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password }); if (e2) throw e2;
  return { id: data.user.id, client };
}
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
// 1x1 JPEG
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const uploaded = [];
const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
try {
  const A = await makeUser("Alice"), B = await makeUser("Bob");
  await admin.from("buzz_secrets").update({ thread_jitter_seconds: 0, reply_jitter_seconds: 0 }).eq("id", 1);
  let post, thread, photoUrl;
  await step("posts: create, read signed out, like + comment as someone else, engagement counts", async () => {
    const { data, error } = await A.client.from("feed_posts").insert({ author_id: A.id, body: `e2e post ${stamp}` }).select("id").single(); if (error) throw error; post = data.id;
    const seen = await anon.from("feed_posts").select("id, author:profiles!feed_posts_author_id_fkey(full_name)").eq("id", post).single(); if (seen.error || seen.data.author.full_name !== "E2E Alice") throw new Error(JSON.stringify(seen));
    let r = await B.client.from("post_likes").insert({ target_type: "post", target_id: post, user_id: B.id }); if (r.error) throw r.error;
    r = await B.client.from("post_comments").insert({ target_type: "post", target_id: post, user_id: B.id, body: "nice" }); if (r.error) throw r.error;
    const e = await B.client.rpc("post_engagement", { p_target_type: "post", p_target_id: post }); if (e.error || Number(e.data[0].likes) !== 1 || Number(e.data[0].comments) !== 1) throw new Error(JSON.stringify(e));
    const n = await A.client.from("notifications").select("type, link").eq("link", `/posts/${post}`); if (n.error || n.data.length !== 2) throw new Error("notifications " + JSON.stringify(n));
  });
  await step("reels_feed answers for signed-out visitors", async () => { const r = await anon.rpc("reels_feed", { p_limit: 5 }); if (r.error) throw r.error; });
  await step("forged notifications are refused", async () => {
    const r = await B.client.rpc("notify", { p_user_id: A.id, p_actor_id: null, p_type: "system", p_title: "You won", p_body: null, p_link: "https://evil.example", p_data: {}, p_dedupe: null });
    if (!r.error) throw new Error("notify() is callable");
  });
  await step("buzz storage: upload to buzz/anon with a random name works; the folder cannot be listed by others", async () => {
    const name = `buzz/anon/${hex(48)}.jpg`;
    const up = await A.client.storage.from("uploads").upload(name, JPEG, { contentType: "image/jpeg" }); if (up.error) throw up.error; uploaded.push(name);
    photoUrl = A.client.storage.from("uploads").getPublicUrl(name).data.publicUrl;
    const res = await fetch(photoUrl); if (!res.ok) throw new Error("public URL " + res.status);
    const list = await B.client.storage.from("uploads").list("buzz/anon"); if (list.error) throw list.error; if (list.data.some((f) => name.endsWith(f.name))) throw new Error("someone else can list the file");
    const wrong = await A.client.storage.from("uploads").upload(`buzz/${A.id}/x.jpg`, JPEG, { contentType: "image/jpeg" }); if (!wrong.error) { uploaded.push(`buzz/${A.id}/x.jpg`); throw new Error("upload outside buzz/anon accepted"); }
    const normal = await A.client.storage.from("uploads").upload(`posts/${A.id}/${hex(16)}.jpg`, JPEG, { contentType: "image/jpeg" }); if (normal.error) throw new Error("normal uploads broke: " + normal.error.message); uploaded.push(normal.data.path);
  });
  await step("buzz: create with that photo; others and signed-out visitors read it with an alias and no author", async () => {
    const c = await A.client.rpc("buzz_create", { p_topic: "advice", p_title: `e2e thread ${stamp}`, p_body: "hello", p_images: [photoUrl], p_image_meta: [{ url: photoUrl, width: 1, height: 1, blur: null }], p_videos: [] }); if (c.error) throw c.error; thread = c.data;
    for (const [who, cl, mine] of [["author", A.client, true], ["other", B.client, false], ["anon", anon, false]]) {
      const g = await cl.rpc("buzz_get", { p_id: thread }); if (g.error || g.data.length !== 1) throw new Error(`${who}: ${JSON.stringify(g)}`);
      const row = g.data[0]; if (row.is_mine !== mine || !/^Student \d{5}$/.test(row.alias) || JSON.stringify(row).includes(A.id) || Object.keys(row).some((k) => /author|user|visible/.test(k))) throw new Error(`${who}: ${JSON.stringify(row)}`);
    }
    const notMine = await B.client.rpc("buzz_create", { p_topic: "other", p_title: "stealing a photo", p_images: [photoUrl] }); if (!notMine.error) throw new Error("someone else's photo accepted");
  });
  await step("buzz: tables are closed to the API", async () => {
    for (const t of ["buzz_posts", "buzz_comments", "buzz_votes", "buzz_mutes", "buzz_secrets", "buzz_rate_log"]) { const r = await A.client.from(t).select("*").limit(1); if (!r.error) throw new Error(`${t} readable: ${JSON.stringify(r.data)}`); }
    for (const f of ["buzz_alias", "buzz_hidden", "buzz_can_see", "buzz_reply_count"]) { const r = await B.client.rpc(f, { p_author: A.id, p_post: thread }); if (!r.error) throw new Error(`${f} callable`); }
  });
  await step("buzz: vote, reply, anonymous notification; blocking the author changes nothing; hide + undo", async () => {
    const v = await B.client.rpc("buzz_vote", { p_post_id: thread, p_value: 1 }); if (v.error || v.data[0].score !== 1) throw new Error(JSON.stringify(v));
    const r = await B.client.rpc("buzz_reply", { p_post_id: thread, p_body: "good luck" }); if (r.error) throw r.error;
    const list = await A.client.rpc("buzz_comments_list", { p_post_id: thread }); if (list.error || list.data.length !== 1 || list.data[0].is_op || JSON.stringify(list.data).includes(B.id)) throw new Error(JSON.stringify(list));
    const n = await A.client.from("notifications").select("actor_id, title").eq("link", `/buzz/${thread}`); if (n.error || n.data.length !== 1 || n.data[0].actor_id !== null) throw new Error(JSON.stringify(n));
    await B.client.from("blocks").insert({ blocker_id: B.id, blocked_id: A.id });
    const still = await B.client.rpc("buzz_get", { p_id: thread }); if (still.data.length !== 1) throw new Error("blocking hid the thread: author oracle");
    await B.client.from("blocks").delete().eq("blocker_id", B.id);
    await B.client.rpc("buzz_mute", { p_post_id: thread }); if ((await B.client.rpc("buzz_get", { p_id: thread })).data.length !== 0) throw new Error("hide did nothing");
    await B.client.rpc("buzz_unmute", { p_post_id: thread }); if ((await B.client.rpc("buzz_get", { p_id: thread })).data.length !== 1) throw new Error("undo did nothing");
  });
  await step("buzz: only the author can delete; feed search finds it", async () => {
    const f = await anon.rpc("buzz_feed", { p_q: String(stamp), p_sort: "new" }); if (f.error || f.data.length !== 1) throw new Error(JSON.stringify(f));
    const no = await B.client.rpc("buzz_delete", { p_id: thread }); if (!no.error) throw new Error("someone else deleted it");
    const yes = await A.client.rpc("buzz_delete", { p_id: thread }); if (yes.error) throw yes.error;
  });
  await step("last seen is coarse (ten-minute steps)", async () => {
    await A.client.rpc("touch_presence"); const p = await anon.from("profiles").select("last_seen_at").eq("id", A.id).single();
    if (new Date(p.data.last_seen_at).getTime() % 600000 !== 0) throw new Error(p.data.last_seen_at);
  });
} catch (e) { bad("aborted", e); } finally {
  await admin.from("buzz_secrets").update({ thread_jitter_seconds: 180, reply_jitter_seconds: 45 }).eq("id", 1);
  if (uploaded.length) await admin.storage.from("uploads").remove(uploaded);
  for (const id of users) await admin.auth.admin.deleteUser(id);
  ok(`removed ${users.length} test users; jitter restored`);
  console.log(failures ? `\n${failures} LIVE CHECK(S) FAILED` : "\nALL LIVE HOME-FEED CHECKS PASSED"); process.exit(failures ? 1 : 0);
}
