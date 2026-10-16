// Live check of the Home-feed backend (posts, following, Buzz) and of activity status through the real API (PostgREST + Storage) with throwaway users.
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
const uploaded = []; const conversations = [];
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
  await step("follows: B follows A, follow_stats and following_posts answer, A is notified, only the two of them can read the follow (mutual friends only list friends of both); self-follow and forged follows are refused; unfollow", async () => {
    if (!(await A.client.from("follows").insert({ follower_id: A.id, followee_id: A.id })).error) throw new Error("self-follow accepted");
    if (!(await A.client.from("follows").insert({ follower_id: B.id, followee_id: A.id })).error) throw new Error("a follow on someone else's behalf was accepted");
    let r = await B.client.from("follows").insert({ follower_id: B.id, followee_id: A.id }); if (r.error) throw r.error;
    const mine = await B.client.rpc("follow_stats", { p_user_ids: [A.id] }); if (mine.error || Number(mine.data[0].followers) !== 1 || mine.data[0].followed_by_me !== true) throw new Error("A as seen by B: " + JSON.stringify(mine));
    const theirs = await A.client.rpc("follow_stats", { p_user_ids: [B.id] }); if (theirs.error || Number(theirs.data[0].following) !== 1 || theirs.data[0].follows_me !== true) throw new Error("B as seen by A: " + JSON.stringify(theirs));
    // Migration 21: a follow is readable only by the two people in it; signed out reads nothing, and B is no friend of A yet.
    const seen = await anon.from("follows").select("follower_id").eq("followee_id", A.id); if (seen.error || seen.data.length !== 0) throw new Error("signed out read the follow: " + JSON.stringify(seen));
    for (const [who, c] of [["A", A.client], ["B", B.client]]) { const own = await c.from("follows").select("follower_id").eq("followee_id", A.id); if (own.error || own.data.length !== 1 || own.data[0].follower_id !== B.id) throw new Error(`${who} cannot read the follow: ` + JSON.stringify(own)); }
    const mutual = await B.client.rpc("mutual_friends", { p_user_id: A.id }).select("id"); if (mutual.error || mutual.data.length !== 0) throw new Error("mutual_friends: " + JSON.stringify(mutual));
    const feed = await B.client.rpc("following_posts", { p_kind: "post", p_university_id: null }).select("id, author:profiles!feed_posts_author_id_fkey(full_name)"); if (feed.error || !feed.data.some((p) => p.id === post && p.author.full_name === "E2E Alice")) throw new Error("following_posts: " + JSON.stringify(feed));
    const nobody = await anon.rpc("following_posts", { p_kind: "post", p_university_id: null }); if (nobody.error || nobody.data.length !== 0) throw new Error("signed out got rows: " + JSON.stringify(nobody));
    const n = await A.client.from("notifications").select("type, link").eq("type", "follow"); if (n.error || n.data.length !== 1 || n.data[0].link !== `/profile/${B.id}`) throw new Error("follow notification " + JSON.stringify(n));
    r = await B.client.from("follows").delete().eq("follower_id", B.id).eq("followee_id", A.id); if (r.error) throw r.error;
    const after = await anon.rpc("follow_stats", { p_user_ids: [A.id] }); if (after.error || Number(after.data[0].followers) !== 0) throw new Error("after unfollow: " + JSON.stringify(after));
  });
  await step("follows stay private: an outsider reads none of A's (rows, an embed through profiles, an exact count) and cannot ask are_friends, nor can a signed-out visitor; Carol, a friend of both, still cannot read B → A and is B's one mutual friend with A", async () => {
    const C = await makeUser("Carol");
    let r = await B.client.from("follows").insert({ follower_id: B.id, followee_id: A.id }); if (r.error) throw r.error;
    const rows = await C.client.from("follows").select("follower_id").eq("followee_id", A.id); if (rows.error || rows.data.length !== 0) throw new Error("an outsider read A's followers: " + JSON.stringify(rows));
    const embed = await C.client.from("profiles").select("id, follows!follows_followee_id_fkey(follower_id)").eq("id", A.id).single(); if (embed.error || embed.data.follows.length !== 0) throw new Error("an outsider read A's followers through profiles: " + JSON.stringify(embed));
    const head = await C.client.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", A.id); if (head.error || head.count !== 0) throw new Error("an outsider counted A's followers: " + JSON.stringify(head));
    for (const [who, c] of [["an outsider", C.client], ["signed out", anon]]) { const f = await c.rpc("are_friends", { p_a: A.id, p_b: B.id }); if (!f.error) throw new Error(`${who} could call are_friends: ` + JSON.stringify(f.data)); }
    for (const [c, from, to] of [[C.client, C.id, A.id], [A.client, A.id, C.id], [C.client, C.id, B.id], [B.client, B.id, C.id]]) { r = await c.from("follows").insert({ follower_id: from, followee_id: to }); if (r.error) throw r.error; }
    const still = await C.client.from("follows").select("follower_id").eq("followee_id", A.id); if (still.error || still.data.some((x) => x.follower_id === B.id)) throw new Error("a friend of both read B → A: " + JSON.stringify(still));
    const mutual = await B.client.rpc("mutual_friends", { p_user_id: A.id }).select("id"); if (mutual.error || mutual.data.map((x) => x.id).join() !== C.id) throw new Error("B's mutual friends with A: " + JSON.stringify(mutual));
    const counts = await C.client.rpc("follow_stats", { p_user_ids: [A.id] }); if (counts.error || Number(counts.data[0].followers) !== 2) throw new Error("A's followers as Carol (B and her): " + JSON.stringify(counts));
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
  await step("activity status (migration 22): user_activity is closed to the API; signed out, activity_status, blocked_either_way_ids and the heartbeats are refused; signed in, activity_status answers only between people who show their status and have not blocked each other: 'recent' for people who share a chat, the time (to the minute) once the other has written there; profiles' and notifications' system columns are closed; only set_show_active_status shows a hidden status again; hiding stops 'Delivered'; 'Seen' moves only for something new (a message sent dated ahead is dated when it was sent); members change only their receipts and a group's name; touch_presence (old builds) is still accepted and leaves no public trail", async () => {
    for (const [who, c] of [["signed in", A.client], ["signed out", anon]]) {
      const r = await c.from("user_activity").select("*").limit(1); if (!r.error) throw new Error(`${who} read user_activity: ` + JSON.stringify(r.data));
      const w = await c.from("user_activity").insert({ user_id: A.id, last_active_at: new Date().toISOString() }); if (!w.error) throw new Error(`${who} wrote user_activity`);
      for (const col of ["xmin", "xmax"]) { const x = await c.from("profiles").select(`id,${col}`).limit(1); if (!x.error) throw new Error(`${who} read profiles.${col}: ` + JSON.stringify(x.data)); }
      const nx = await c.from("notifications").select("id,xmin").limit(1); if (!nx.error) throw new Error(`${who} read notifications.xmin: ` + JSON.stringify(nx.data));
    }
    const all = await anon.from("profiles").select("*").eq("id", A.id).single(); if (all.error || all.data.id !== A.id) throw new Error("select * on profiles broke: " + JSON.stringify(all.error));
    const bell = await A.client.from("notifications").select("*, actor:profiles!notifications_actor_id_fkey(id, full_name, avatar_url)").limit(5); if (bell.error) throw new Error("select * on notifications broke: " + bell.error.message);
    const early = await A.client.from("notifications").update({ visible_at: new Date().toISOString() }).eq("user_id", A.id); if (!early.error) throw new Error("a notification's visible_at could be moved");
    for (const [f, args] of [["activity_status", { p_user_ids: [A.id] }], ["touch_activity", {}], ["touch_presence", {}], ["blocked_either_way_ids", {}], ["set_show_active_status", { p_show: true }]]) { const r = await anon.rpc(f, args); if (!r.error) throw new Error(`${f} answered signed out: ` + JSON.stringify(r.data)); }
    const status = async (c, ids) => { const r = await c.rpc("activity_status", { p_user_ids: ids }); if (r.error) throw r.error; return r.data; };
    const blockedIds = async (c) => { const r = await c.rpc("blocked_either_way_ids"); if (r.error) throw r.error; return r.data; };
    for (const c of [A.client, B.client]) { const t = await c.rpc("touch_activity"); if (t.error || t.data !== true) throw new Error("touch_activity: " + JSON.stringify(t)); }
    if ((await status(B.client, [A.id])).length !== 0) throw new Error("answered without a shared chat");
    const dm = await A.client.rpc("get_or_create_direct_conversation", { p_other_user_id: B.id }); if (dm.error) throw dm.error; conversations.push(dm.data);
    // Both just stamped, an empty chat between them: "Active now" may show (recent), but no time.
    for (const [c, id] of [[B.client, A.id], [A.client, B.id]]) { const e = await status(c, [id]); if (e.length !== 1 || e[0].last_active_at !== null || e[0].recent !== true) throw new Error("an empty chat: " + JSON.stringify(e)); }
    const say = async (who, text) => { const m = await who.client.from("messages").insert({ conversation_id: dm.data, sender_id: who.id, content: text }); if (m.error) throw m.error; };
    await say(A, "hi from A");
    const seen = await status(B.client, [A.id]); const at = seen.length === 1 ? new Date(seen[0].last_active_at).getTime() : NaN;
    if (seen[0]?.user_id !== A.id || at % 60000 !== 0 || Math.abs(Date.now() - at) > 10 * 60000 || seen[0].recent !== true) throw new Error("B about A, who wrote to B: " + JSON.stringify(seen));
    const notYet = await status(A.client, [B.id]); if (notYet.length !== 1 || notYet[0].last_active_at !== null) throw new Error("A got a time for B, who has not written to A: " + JSON.stringify(notYet));
    await say(B, "hi from B");
    const both = await status(A.client, [B.id]); if (both.length !== 1 || both[0].last_active_at === null) throw new Error("A does not see B's time after B wrote: " + JSON.stringify(both));
    if ((await status(A.client, [A.id])).length !== 0) throw new Error("A got her own time");
    // Members change their receipts and nothing else; a direct chat stays one.
    const moved = await B.client.from("conversation_members").update({ joined_at: "2000-01-01T00:00:00Z" }).eq("conversation_id", dm.data).eq("user_id", B.id); if (!moved.error) throw new Error("B rewrote joined_at");
    const grouped = await A.client.from("conversations").update({ type: "group" }).eq("id", dm.data); if (!grouped.error) throw new Error("A turned the direct chat into a group");
    // "Seen" moves for something new, not for opening the chat again.
    const readAt = async () => { const d = await A.client.from("conversation_members").select("last_read_at").eq("conversation_id", dm.data).eq("user_id", B.id).single(); if (d.error) throw d.error; return d.data.last_read_at; };
    const read1 = await readAt();
    const again = await B.client.rpc("mark_conversation_read", { p_conversation_id: dm.data }); if (again.error) throw again.error;
    if ((await readAt()) !== read1) throw new Error("opening the chat again with nothing new moved B's last_read_at");
    // A message sent dated ahead is dated when it was sent: it cannot stay "new" and keep moving "Seen" on every open.
    const planted = await A.client.from("messages").insert({ conversation_id: dm.data, sender_id: A.id, content: "from the future", created_at: new Date(Date.now() + 365 * 86400000).toISOString() }).select("created_at").single();
    if (planted.error) throw planted.error;
    if (new Date(planted.data.created_at).getTime() > Date.now() + 60000) throw new Error("a message kept the date ahead it was sent with: " + planted.data.created_at);
    const opened = await B.client.rpc("mark_conversation_read", { p_conversation_id: dm.data }); if (opened.error) throw opened.error;
    const read2 = await readAt();
    const reopened = await B.client.rpc("mark_conversation_read", { p_conversation_id: dm.data }); if (reopened.error) throw reopened.error;
    if ((await readAt()) !== read2) throw new Error("after a message sent dated ahead, opening the chat again moved B's last_read_at");
    let r = await A.client.from("profiles").update({ show_active_status: false }).eq("id", A.id); if (r.error) throw r.error;
    if ((await status(B.client, [A.id])).length !== 0) throw new Error("B sees A, who hides her status");
    if ((await status(A.client, [B.id])).length !== 0) throw new Error("A, hiding hers, sees B's");
    const hidden = await A.client.rpc("touch_activity"); if (hidden.error || hidden.data !== false) throw new Error("touch_activity while hidden: " + JSON.stringify(hidden));
    const deliveredOf = async () => { const d = await B.client.from("conversation_members").select("last_delivered_at").eq("conversation_id", dm.data).eq("user_id", A.id).single(); if (d.error) throw d.error; return d.data.last_delivered_at; };
    const before0 = await deliveredOf();
    await say(B, "are you there?");
    r = await A.client.rpc("mark_delivered_all"); if (r.error) throw r.error;
    if ((await deliveredOf()) !== before0) throw new Error("A's app marked a message delivered while she hides her status");
    // A stale save (an installed old build) cannot show it again; the switch (set_show_active_status) can.
    r = await A.client.from("profiles").update({ show_active_status: true, bio: "saved from an old build" }).eq("id", A.id).select("show_active_status, bio").single(); if (r.error) throw r.error;
    if (r.data.show_active_status !== false || r.data.bio !== "saved from an old build") throw new Error("a stale save: " + JSON.stringify(r.data));
    r = await A.client.rpc("set_show_active_status", { p_show: true }); if (r.error) throw r.error;
    if ((await status(B.client, [A.id])).length !== 0) throw new Error("hiding did not delete A's time");
    await A.client.rpc("touch_activity"); if ((await status(B.client, [A.id])).length !== 1) throw new Error("A's next heartbeat did not bring her time back");
    r = await A.client.rpc("mark_delivered_all"); if (r.error) throw r.error;
    if ((await deliveredOf()) === before0) throw new Error("A's app no longer marks messages delivered after showing her status again");
    r = await B.client.from("blocks").insert({ blocker_id: B.id, blocked_id: A.id }); if (r.error) throw r.error;
    const across = [...(await status(B.client, [A.id])), ...(await status(A.client, [B.id]))];
    const lists = [await blockedIds(A.client), await blockedIds(B.client)];
    r = await B.client.from("blocks").delete().eq("blocker_id", B.id).eq("blocked_id", A.id); if (r.error) throw r.error;
    if (across.length !== 0) throw new Error("answered across a block: " + JSON.stringify(across));
    if (JSON.stringify(lists) !== JSON.stringify([[B.id], [A.id]])) throw new Error("blocked_either_way_ids: " + JSON.stringify(lists));
    if ((await blockedIds(A.client)).length !== 0) throw new Error("blocked_either_way_ids after the unblock");
    if ((await status(A.client, [B.id])).length !== 1) throw new Error("A does not see B again after the unblock");
    const before = await anon.from("profiles").select("last_seen_at, updated_at").eq("id", A.id).single(); if (before.error) throw before.error;
    r = await A.client.rpc("touch_presence"); if (r.error) throw new Error("touch_presence refused: " + r.error.message);
    const after = await anon.from("profiles").select("last_seen_at, updated_at").eq("id", A.id).single(); if (after.error) throw after.error;
    if (after.data.last_seen_at !== null || after.data.updated_at !== before.data.updated_at) throw new Error("touch_presence left a public trail: " + JSON.stringify(after.data));
  });
} catch (e) { bad("aborted", e); } finally {
  await admin.from("buzz_secrets").update({ thread_jitter_seconds: 180, reply_jitter_seconds: 45 }).eq("id", 1);
  if (uploaded.length) await admin.storage.from("uploads").remove(uploaded);
  for (const id of conversations) await admin.from("conversations").delete().eq("id", id);
  for (const id of users) await admin.auth.admin.deleteUser(id);
  ok(`removed ${users.length} test users and ${conversations.length} conversation(s); jitter restored`);
  console.log(failures ? `\n${failures} LIVE CHECK(S) FAILED` : "\nALL LIVE HOME-FEED CHECKS PASSED"); process.exit(failures ? 1 : 0);
}
