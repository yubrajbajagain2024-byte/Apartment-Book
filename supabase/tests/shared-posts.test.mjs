// Migration 17 (share into a chat) against PGlite: friends = mutual follows minus blocks, share messages with no words, previews, notifications.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the shared-posts migration re-runs cleanly", async () => { await db.exec(read("migrations/20260926000000_shared_posts.sql")); });
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol"), D = await mk("d@txstate.edu", "Dan");
const one = async (p) => (await p).rows[0];
const follow = (from, to) => as(from, () => db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [from, to]));
const friends = (viewer, q = null) => as(viewer, () => db.query("select id, full_name from public.list_friends($1)", [q])).then((r) => r.rows.map((x) => x.full_name));
const SHARE = { target_type: "post", target_id: "00000000-0000-4000-8000-000000000001", kind: "post", path: "/posts/00000000-0000-4000-8000-000000000001", title: null, caption: "Study group?", image_url: null, author: { id: B, name: "Bob", avatar_url: null } };

await expectOk("friends: only people who follow each other, in name order; a name filter narrows them; signed out there are none", async () => {
  await follow(A, B); await follow(B, A); // mutual
  await follow(A, C); await follow(C, A); // mutual
  await follow(A, D); // one way
  if ((await friends(A)).join("|") !== "Bob|Carol") throw new Error("friends of Alice: " + (await friends(A)).join("|"));
  if ((await friends(D)).length !== 0) throw new Error("Dan follows Alice but she does not follow back");
  if ((await friends(A, "car")).join("|") !== "Carol") throw new Error("filter: " + (await friends(A, "car")).join("|"));
  if ((await asAnon(() => db.query("select * from public.list_friends()"))).rows.length !== 0) throw new Error("signed out saw friends");
});
await expectOk("friends: blocking someone removes them from both people's lists", async () => {
  await as(A, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [A, C]));
  if ((await friends(A)).join("|") !== "Bob") throw new Error("after block: " + (await friends(A)).join("|"));
  if ((await friends(C)).length !== 0) throw new Error("Carol still sees Alice");
  await as(A, () => db.query("delete from public.blocks where blocker_id=$1 and blocked_id=$2", [A, C]));
});

let conv;
await expectOk("share: a message may carry a shared post and no words; the inbox preview and the notification read 'Sent a post'", async () => {
  conv = await as(A, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [B]))).then((r) => r.id);
  const m = await as(A, () => one(db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1,$2,'',$3::jsonb) returning id, shared_post", [conv, A, JSON.stringify(SHARE)])));
  if (m.shared_post.path !== SHARE.path) throw new Error("snapshot not stored: " + JSON.stringify(m.shared_post));
  const c = await one(db.query("select last_message_preview from public.conversations where id=$1", [conv]));
  if (c.last_message_preview !== "Sent a post") throw new Error("preview: " + c.last_message_preview);
  const n = await as(B, () => one(db.query("select body from public.notifications where user_id=$1 and type='message' order by created_at desc limit 1", [B])));
  if (!n || n.body !== "Sent a post") throw new Error("notification: " + JSON.stringify(n));
});
await expectOk("share: words with the share keep the words as the preview; a reel reads 'Sent a reel'", async () => {
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1,$2,'Look at this',$3::jsonb)", [conv, A, JSON.stringify(SHARE)]));
  let c = await one(db.query("select last_message_preview from public.conversations where id=$1", [conv])); if (c.last_message_preview !== "Look at this") throw new Error("preview with words: " + c.last_message_preview);
  await as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1,$2,'',$3::jsonb)", [conv, A, JSON.stringify({ ...SHARE, kind: "reel" })]));
  c = await one(db.query("select last_message_preview from public.conversations where id=$1", [conv])); if (c.last_message_preview !== "Sent a reel") throw new Error("reel preview: " + c.last_message_preview);
});
await expectError("share: an empty message without a share is still refused", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'')", [conv, A])), "messages_content_check");
await expectError("share: a snapshot without its target is refused", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1,$2,'',$3::jsonb)", [conv, A, JSON.stringify({ kind: "post" })])), "messages_shared_post_check");
await expectError("share: a card whose link points outside the site is refused", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1,$2,'',$3::jsonb)", [conv, A, JSON.stringify({ ...SHARE, path: "https://evil.example/login" })])), "messages_shared_post_check");
await expectError("share: a link that does not match the shared thing is refused", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1,$2,'',$3::jsonb)", [conv, A, JSON.stringify({ ...SHARE, path: "/apartments/" + SHARE.target_id })])), "messages_shared_post_check");
await expectError("share: an id that is not a UUID is refused", () => as(A, () => db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1,$2,'',$3::jsonb)", [conv, A, JSON.stringify({ ...SHARE, target_id: "../admin", path: "/posts/../admin" })])), "messages_shared_post_check");
await expectOk("share: plain messages still work exactly as before (inbox preview 120 characters, notification 140)", async () => {
  await as(B, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,'Nice!')", [conv, B]));
  let c = await one(db.query("select last_message_preview from public.conversations where id=$1", [conv])); if (c.last_message_preview !== "Nice!") throw new Error("plain preview: " + c.last_message_preview);
  const long = "x".repeat(200);
  await as(B, () => db.query("insert into public.messages (conversation_id, sender_id, content) values ($1,$2,$3)", [conv, B, long]));
  c = await one(db.query("select last_message_preview from public.conversations where id=$1", [conv])); if (c.last_message_preview.length !== 120) throw new Error("inbox preview length " + c.last_message_preview.length);
  const n = await as(A, () => one(db.query("select body from public.notifications where user_id=$1 and type='message' order by created_at desc limit 1", [A])));
  if (!n || n.body.length !== 140) throw new Error("notification length " + (n && n.body.length));
});
done("MIGRATION-17 SHARED POSTS");
