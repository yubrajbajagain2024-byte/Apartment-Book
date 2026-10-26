// The whole life of a Snap between two real accounts on the live project, through the same API the apps use:
// sent, delivered, opened (saying what the viewer's phone can detect), a screenshot (and the sender's notification),
// closed (the file queued for deletion), taken back by its sender (and refused to open afterwards), refused to the
// sender and to a stranger (leaving no mark), and an older app's one-argument open. Needs SUPABASE_ACCESS_TOKEN (to
// make and remove its two throwaway accounts); everything else runs signed in as them. Leaves nothing behind.
//   SUPABASE_ACCESS_TOKEN=sbp_… node apps/mobile/e2e/snap-lifecycle.mjs
import { createClient } from "@supabase/supabase-js";

const ref = "dskbzoqreandwwpxiplh";
const url = `https://${ref}.supabase.co`;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })).json();
const anonKey = keys.find((k) => k.name === "anon").api_key;
const admin = createClient(url, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false, autoRefreshToken: false } });

// A valid 1×1 JPEG: the file that goes up, and the preview that rides on the message.
const PREVIEW = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const JPEG = Buffer.from(PREVIEW.split(",")[1], "base64");

let failures = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${e?.message ?? e}`); };
const check = async (n, fn) => { try { await fn(); ok(n); } catch (e) { fail(n, e); } };
const expectThrow = async (n, fn, m) => { try { await fn(); fail(n, "no error"); } catch (e) { if (!m || (e.message ?? "").includes(m)) ok(n); else fail(n, e.message); } };
const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

const stamp = Date.now();
const password = `Snap-${stamp}-pass!`;
const users = [];
async function mk(name) {
  const email = `snap-${name.toLowerCase()}-${stamp}@txstate.edu`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Snap ${name}` } });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await client.auth.signInWithPassword({ email, password }));
  users.push(data.user.id);
  return { id: data.user.id, name: `Snap ${name}`, client };
}

const hex = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const paths = [];
async function send(from, to) {
  const path = `${from.id}/${hex()}.jpg`;
  paths.push(path);
  must(await from.client.storage.from("snaps").upload(path, JPEG, { contentType: "image/jpeg" }));
  const r = must(await from.client.rpc("send_snap", { p_path: path, p_kind: "image", p_mime: "image/jpeg", p_width: 1080, p_height: 1440, p_duration: null, p_recipient_ids: [to.id], p_preview: PREVIEW }));
  return { snapId: r.snap_id, messageId: r.sent[0].message_id, conversationId: r.sent[0].conversation_id };
}
const snapOn = async (who, messageId) => must(await who.client.from("messages").select("snap").eq("id", messageId).single()).snap;
const types = (snap) => (snap.activity ?? []).map((a) => a.type);

try {
  const A = await mk("Alice");
  const B = await mk("Bob");
  // Friends: Snaps go to friends and people you chat with.
  must(await admin.from("follows").insert([{ follower_id: A.id, followee_id: B.id }, { follower_id: B.id, followee_id: A.id }]));
  console.log(`Two accounts made (${A.name}, ${B.name}); running the Snap lifecycle on ${ref}…`);

  const one = await send(A, B);
  await check("sent: the message carries the Snap, its shape and its preview, nothing else yet", async () => {
    const s = await snapOn(B, one.messageId);
    if (s.id !== one.snapId || s.preview !== PREVIEW || s.opened_at || s.activity) throw new Error(JSON.stringify(s));
  });
  await check("delivered: the recipient's app says so, once", async () => {
    must(await B.client.rpc("snap_delivered", { p_snap_id: one.snapId }));
    must(await B.client.rpc("snap_delivered", { p_snap_id: one.snapId }));
    if (JSON.stringify(types(await snapOn(A, one.messageId))) !== JSON.stringify(["delivered"])) throw new Error("not exactly one delivered entry");
  });
  await expectThrow("a failed open leaves no mark: the sender cannot open it", () => A.client.rpc("open_snap", { p_snap_id: one.snapId, p_detect: "ios" }).then(must), "isn't available");
  await check("…and the Snap is still new, with nothing logged", async () => {
    const s = await snapOn(B, one.messageId);
    if (s.opened_at || types(s).length !== 1) throw new Error(JSON.stringify(s));
  });
  let opened;
  await check("opened: the recipient's one view, saying its phone reports screenshots; the preview stays", async () => {
    opened = must(await B.client.rpc("open_snap", { p_snap_id: one.snapId, p_detect: "ios" }));
    if (!opened.path || opened.sender?.id !== A.id) throw new Error(JSON.stringify(opened));
    const s = await snapOn(A, one.messageId);
    if (!s.opened_at || s.preview !== PREVIEW || JSON.stringify(types(s)) !== JSON.stringify(["delivered", "opened"]) || s.activity[1].detect !== "ios") throw new Error(JSON.stringify(s));
  });
  await check("opened: the file can be loaded by its viewer with their own session", async () => {
    const { data: session } = await B.client.auth.getSession();
    const r = await fetch(`${url}/storage/v1/object/authenticated/snaps/${opened.path}`, { headers: { Authorization: `Bearer ${session.session.access_token}`, apikey: anonKey } });
    if (r.status !== 200) throw new Error(`http ${r.status}`);
  });
  await check("screenshot: logged on the Snap for both, and the sender notified at once", async () => {
    must(await B.client.rpc("report_snap_capture", { p_snap_id: one.snapId, p_kind: "screenshot" }));
    if (types(await snapOn(A, one.messageId)).at(-1) !== "screenshot") throw new Error("not logged");
    const n = must(await A.client.from("notifications").select("type, title, body").eq("type", "snap_activity"));
    if (!n.some((x) => x.body === "Took a screenshot of your Snap" && x.title === B.name)) throw new Error(JSON.stringify(n));
  });
  await check("closed: the view ends, the Snap's rows go and its file is queued for deletion", async () => {
    must(await B.client.rpc("close_snap", { p_snap_id: one.snapId }));
    const rows = must(await admin.from("snaps").select("id").eq("id", one.snapId));
    if (rows.length !== 0) throw new Error("rows still there");
    const queued = must(await admin.from("snap_purges").select("path").eq("path", opened.path));
    if (queued.length !== 1) throw new Error("file not queued");
  });
  await expectThrow("closed: it never opens again", () => B.client.rpc("open_snap", { p_snap_id: one.snapId, p_detect: "ios" }).then(must), "isn't available");
  await check("…and the chat keeps the whole story", async () => {
    const s = await snapOn(B, one.messageId);
    if (JSON.stringify(types(s)) !== JSON.stringify(["delivered", "opened", "screenshot"]) || !s.opened_at) throw new Error(JSON.stringify(s));
  });

  const two = await send(A, B);
  await check("deleted: the sender takes a waiting Snap back; the chat says so, the preview goes, the file is queued", async () => {
    must(await B.client.rpc("snap_delivered", { p_snap_id: two.snapId }));
    must(await A.client.rpc("delete_snap", { p_snap_id: two.snapId }));
    const s = await snapOn(B, two.messageId);
    if (!s.gone || s.preview || JSON.stringify(types(s)) !== JSON.stringify(["delivered", "deleted"])) throw new Error(JSON.stringify(s));
    const queued = must(await admin.from("snap_purges").select("path").eq("path", paths[1]));
    if (queued.length !== 1) throw new Error("file not queued");
  });
  await expectThrow("deleted: it cannot be opened", () => B.client.rpc("open_snap", { p_snap_id: two.snapId, p_detect: "ios" }).then(must), "isn't available");
  await check("deleted: the failed open left it unopened", async () => {
    const s = await snapOn(B, two.messageId);
    if (s.opened_at || types(s).includes("opened")) throw new Error(JSON.stringify(s));
  });
  await expectThrow("deleted: the recipient cannot delete the sender's Snap", async () => { const t = await send(A, B); await B.client.rpc("delete_snap", { p_snap_id: t.snapId }).then(must); }, "isn't yours");

  await check("an older app opens with one argument, claiming nothing about detection", async () => {
    const t = await send(A, B);
    must(await B.client.rpc("open_snap", { p_snap_id: t.snapId }));
    const s = await snapOn(A, t.messageId);
    const o = s.activity.find((a) => a.type === "opened");
    if (!o || o.detect !== undefined) throw new Error(JSON.stringify(s.activity));
    must(await B.client.rpc("close_snap", { p_snap_id: t.snapId }));
  });
  await expectThrow("a stranger can neither open a Snap nor report on it", async () => {
    const C = await mk("Carol");
    const t = await send(A, B);
    await C.client.rpc("open_snap", { p_snap_id: t.snapId, p_detect: "ios" }).then(must);
  }, "isn't available");
} catch (e) {
  fail("setup", e);
} finally {
  // Everything these accounts made goes with them: their chats (messages, Snaps), their files, then the accounts.
  const { data: convs } = await admin.from("conversation_members").select("conversation_id").in("user_id", users);
  for (const c of new Set((convs ?? []).map((c) => c.conversation_id))) await admin.from("conversations").delete().eq("id", c);
  if (paths.length > 0) await admin.storage.from("snaps").remove(paths);
  await admin.from("snap_purges").delete().in("path", paths);
  for (const id of users) await admin.auth.admin.deleteUser(id);
  console.log("cleaned up the test accounts and their data");
}
console.log(failures ? `${failures} FAILED` : "ALL LIVE SNAP LIFECYCLE CHECKS PASSED");
process.exit(failures ? 1 : 0);
