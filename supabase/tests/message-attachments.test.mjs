// Migration 20 (photos, videos and files in chats) against PGlite: the private bucket and its policies, the attachments
// check, previews and notifications, search, and the Media / Files / Links queries behind a chat's info screen.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
// The wording and the accepted file types must stay the same in the apps and in the database.
import { MESSAGE_ATTACHMENT_MIME_TYPES, attachmentPreview, sharedItemsFromMessages } from "../../packages/shared/src/message-media.ts";
import { sharedPostOf } from "../../packages/shared/src/share.ts";

const MIGRATION = "migrations/20260929000000_message_attachments.sql";
const { db, mk, as, asAnon } = await boot();
await expectOk("the attachments migration re-runs cleanly", async () => { await db.exec(read(MIGRATION)); });

const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
const direct = async (me, other) => (await as(me, () => one(db.query("select public.get_or_create_direct_conversation($1) as id", [other])))).id;
const AB = await direct(A, B), BC = await direct(B, C);
const GROUP = (await as(A, () => one(db.query("select public.create_group_conversation('Study group', $1::uuid[]) as id", [[B, C]])))).id;

const object = (conv, uid, file) => `${conv}/${uid}/${file}`;
const upload = (uid, name) => as(uid, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('message-media',$1,$2)", [name, uid]));
const canRead = async (uid, name) => (await as(uid, () => rows(db.query("select name from storage.objects where bucket_id = 'message-media' and name = $1", [name])))).length > 0;
const removeAs = async (uid, name) => (await as(uid, () => rows(db.query("delete from storage.objects where bucket_id = 'message-media' and name = $1 returning name", [name])))).length > 0;

let n = 0;
const photo = (conv, uid, extra = {}) => ({ kind: "image", path: object(conv, uid, `p${++n}-photo.jpg`), name: "photo.jpg", size: 2048, mime: "image/jpeg", width: 1200, height: 900, ...extra });
const video = (conv, uid) => ({ kind: "video", path: object(conv, uid, `v${++n}-clip.mov`), name: "clip.mov", size: 9_000_000, mime: "video/quicktime", width: 1080, height: 1920, duration: 12.5 });
const file = (conv, uid) => ({ kind: "file", path: object(conv, uid, `f${++n}-lease.pdf`), name: "Lease (final).pdf", size: 345_678, mime: "application/pdf" });
// PGlite's clock ticks in milliseconds, so messages sent back to back could share a time: each one gets its own second.
let clock = Date.parse("2026-10-01T09:00:00Z");
const send = (uid, conv, content, attachments = [], extra = {}) =>
  as(uid, () => one(db.query(
    "insert into public.messages (conversation_id, sender_id, content, attachments, image_url, shared_post, created_at) values ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7) returning *",
    [conv, uid, content, JSON.stringify(attachments), extra.imageUrl ?? null, extra.sharedPost ? JSON.stringify(extra.sharedPost) : null, new Date((clock += 1000)).toISOString()],
  )));
const preview = async (conv) => (await one(db.query("select last_message_preview from public.conversations where id = $1", [conv]))).last_message_preview;
const lastNotification = (uid) => as(uid, () => one(db.query("select title, body from public.notifications where user_id = $1 and type = 'message' order by created_at desc limit 1", [uid])));

// --- the bucket -------------------------------------------------------------------------------------------------
await expectOk("bucket: message-media is private, 50 MB, and takes exactly the types the apps check (no SVG, no HTML)", async () => {
  const b = await one(db.query("select * from storage.buckets where id = 'message-media'"));
  if (!b || b.public !== false || Number(b.file_size_limit) !== 52428800) throw new Error("bucket: " + JSON.stringify(b));
  if ([...b.allowed_mime_types].sort().join() !== [...MESSAGE_ATTACHMENT_MIME_TYPES].sort().join()) throw new Error("the apps and the bucket disagree: " + b.allowed_mime_types.join());
  for (const t of ["image/heic", "video/quicktime", "video/mp4", "application/pdf", "application/zip", "text/csv"]) if (!b.allowed_mime_types.includes(t)) throw new Error("missing " + t);
  for (const t of ["image/svg+xml", "text/html", "application/javascript"]) if (b.allowed_mime_types.includes(t)) throw new Error("allows " + t);
});

// --- storage policies -------------------------------------------------------------------------------------------
const alicePhoto = object(AB, A, "k1-photo.jpg");
await expectOk("storage: a member uploads into their own folder of the chat; the other member reads it, an outsider and a signed-out visitor cannot", async () => {
  await upload(A, alicePhoto);
  if (!(await canRead(B, alicePhoto))) throw new Error("Bob cannot read Alice's photo in their chat");
  if (await canRead(C, alicePhoto)) throw new Error("Carol, who is not in the chat, can read it");
  if ((await asAnon(() => rows(db.query("select name from storage.objects where bucket_id = 'message-media'")))).length) throw new Error("signed out sees chat files");
});
await expectError("storage: someone outside the chat cannot upload into it", () => upload(C, object(AB, C, "k2-x.jpg")), "row-level security");
await expectError("storage: a member cannot write into another member's folder", () => upload(B, object(AB, A, "k3-x.jpg")), "row-level security");
await expectError("storage: a first folder that is not a chat id is refused (no cast error)", () => upload(A, `not-a-chat/${A}/k4-x.jpg`), "row-level security");
await expectError("storage: a file straight in the chat folder is refused", () => upload(A, `${AB}/k5-x.jpg`), "row-level security");
await expectError("storage: deeper folders are refused", () => upload(A, `${AB}/${A}/extra/k6-x.jpg`), "row-level security");
await expectError("storage: signed out cannot upload", () => asAnon(() => db.query("insert into storage.objects (bucket_id, name) values ('message-media',$1)", [object(AB, A, "k7-x.jpg")])), "row-level security");
await expectError("storage: no uploads into a chat with someone who blocked you", async () => {
  await as(B, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1,$2)", [B, A]));
  try { await upload(A, object(AB, A, "k8-x.jpg")); } finally { await as(B, () => db.query("delete from public.blocks where blocker_id = $1 and blocked_id = $2", [B, A])); }
}, "row-level security");
await expectOk("storage: only the uploader deletes a file", async () => {
  const name = object(AB, A, "k9-delete-me.jpg");
  await upload(A, name);
  if (await removeAs(B, name)) throw new Error("Bob deleted Alice's file");
  if (!(await removeAs(A, name))) throw new Error("Alice cannot delete her own file");
});
await expectOk("storage: after leaving a group you keep your own files but lose the others' and cannot upload", async () => {
  const mine = object(GROUP, A, "k10-mine.jpg"), bobs = object(GROUP, B, "k11-bobs.jpg");
  await upload(A, mine); await upload(B, bobs);
  if (!(await canRead(A, bobs)) || !(await canRead(C, mine))) throw new Error("group members cannot read each other's files");
  const D = await mk("d@txstate.edu", "Dan");
  const DG = (await as(D, () => one(db.query("select public.create_group_conversation('Leavers', $1::uuid[]) as id", [[A]])))).id;
  const dans = object(DG, D, "k12-dans.jpg"), alices = object(DG, A, "k13-alices.jpg");
  await upload(D, dans); await upload(A, alices);
  await as(A, () => db.query("delete from public.conversation_members where conversation_id = $1 and user_id = $2", [DG, A]));
  if (!(await canRead(A, alices))) throw new Error("Alice lost her own file after leaving");
  if (await canRead(A, dans)) throw new Error("Alice still reads Dan's file after leaving");
  let refused = false;
  try { await upload(A, object(DG, A, "k14-late.jpg")); } catch { refused = true; }
  if (!refused) throw new Error("Alice uploaded into a group she left");
  if (!(await removeAs(A, alices))) throw new Error("Alice cannot clean up her own file after leaving");
});

// --- the attachments column -------------------------------------------------------------------------------------
await expectOk("attachments: a photo with no words is a message; each entry is rebuilt from the known keys only", async () => {
  const m = await send(A, AB, "", [photo(AB, A, { evil: "x".repeat(5000), width: 1200, height: null })]);
  const [a] = m.attachments;
  if (m.attachments.length !== 1 || Object.keys(a).sort().join() !== "kind,mime,name,path,size,width") throw new Error("stored: " + JSON.stringify(m.attachments));
  if (a.width !== 1200 || a.size !== 2048 || !a.path.startsWith(`${AB}/${A}/`)) throw new Error("stored values: " + JSON.stringify(a));
});
await expectOk("attachments: plain text messages still get an empty list", async () => {
  const m = await send(B, AB, "hey");
  if (JSON.stringify(m.attachments) !== "[]") throw new Error("default: " + JSON.stringify(m.attachments));
});
await expectError("attachments: a file in someone else's folder is refused", () => send(A, AB, "", [photo(AB, B)]), "own folder");
await expectError("attachments: a file from another chat is refused", () => send(B, AB, "", [photo(BC, B)]), "own folder");
await expectError("attachments: a path that climbs out of the folder is refused", () => send(A, AB, "", [photo(AB, A, { path: `${AB}/${A}/../${B}/x.jpg` })]), "own folder");
await expectError("attachments: a path that is just the folder is refused", () => send(A, AB, "", [photo(AB, A, { path: `${AB}/${A}/` })]), "own folder");
await expectError("attachments: more than 10 are refused", () => send(A, AB, "", Array.from({ length: 11 }, () => photo(AB, A))), "at most 10");
await expectError("attachments: an unknown kind is refused", () => send(A, AB, "", [photo(AB, A, { kind: "audio" })]), "kind must be");
await expectError("attachments: an entry that is not an object is refused", () => send(A, AB, "", ["photo.jpg"]), "expected an object");
await expectError("attachments: a list is required", () => send(A, AB, "", photo(AB, A)), "expected a list");
await expectError("attachments: an empty file is refused", () => send(A, AB, "", [photo(AB, A, { size: 0 })]), "50 MB");
await expectError("attachments: a file over 50 MB is refused", () => send(A, AB, "", [photo(AB, A, { size: 52428801 })]), "50 MB");
await expectError("attachments: a size that is not a number is refused", () => send(A, AB, "", [photo(AB, A, { size: "2048" })]), "number of bytes");
await expectError("attachments: a missing file type is refused", () => send(A, AB, "", [photo(AB, A, { mime: " " })]), "file type");
await expectError("attachments: a name over 255 characters is refused", () => send(A, AB, "", [photo(AB, A, { name: "x".repeat(256) })]), "name");
await expectError("attachments: a width that is not a number is refused", () => send(A, AB, "", [photo(AB, A, { width: "wide" })]), "must be a number");
await expectError("attachments: a negative duration is refused", () => send(A, AB, "", [photo(AB, A, { duration: -1 })]), "negative");
await expectError("attachments: an empty message without files or a share is still refused", () => send(A, AB, ""), "messages_content_check");
await expectError("attachments: text over 4000 characters is still refused, files or not", () => send(A, AB, "x".repeat(4001), [photo(AB, A)]), "messages_content_check");
await expectError("attachments: a message with files needs a sender", () => db.query("insert into public.messages (conversation_id, sender_id, content, attachments) values ($1, null, '', $2::jsonb)", [AB, JSON.stringify([photo(AB, A)])]), "needs a sender");
await expectError("attachments: changing them later goes through the same check", async () => {
  const m = await send(A, AB, "", [photo(AB, A)]);
  await db.query("update public.messages set attachments = $2::jsonb where id = $1", [m.id, JSON.stringify([photo(AB, B)])]);
}, "own folder");

// --- previews and notifications ---------------------------------------------------------------------------------
const PREVIEWS = [
  ["one photo", () => [photo(AB, A)], "Sent a photo"],
  ["three photos", () => [photo(AB, A), photo(AB, A), photo(AB, A)], "Sent 3 photos"],
  ["one video", () => [video(AB, A)], "Sent a video"],
  ["two videos", () => [video(AB, A), video(AB, A)], "Sent 2 videos"],
  ["one file", () => [file(AB, A)], "Sent a file"],
  ["two files", () => [file(AB, A), file(AB, A)], "Sent 2 files"],
  ["a mix", () => [photo(AB, A), video(AB, A), file(AB, A), photo(AB, A)], "Sent 4 attachments"],
];
for (const [label, make, expected] of PREVIEWS) {
  await expectOk(`previews: ${label} reads "${expected}" in the inbox, in Bob's notification and in the apps`, async () => {
    const list = make();
    await send(A, AB, "", list);
    if ((await preview(AB)) !== expected) throw new Error("inbox: " + (await preview(AB)));
    const note = await lastNotification(B);
    if (!note || note.body !== expected || note.title !== "Alice") throw new Error("notification: " + JSON.stringify(note));
    if (attachmentPreview(list) !== expected) throw new Error("apps: " + attachmentPreview(list));
  });
}
await expectOk("previews: words sent with files win; a shared post still reads 'Sent a post'", async () => {
  await send(A, AB, "Here is the lease", [file(AB, A)]);
  if ((await preview(AB)) !== "Here is the lease") throw new Error("with words: " + (await preview(AB)));
  if ((await lastNotification(B)).body !== "Here is the lease") throw new Error("notification with words");
  const shared = { target_type: "post", target_id: "00000000-0000-4000-8000-000000000001", kind: "post", path: "/posts/00000000-0000-4000-8000-000000000001", title: null, caption: null, image_url: null, author: { id: B, name: "Bob", avatar_url: null } };
  await send(A, AB, "", [], { sharedPost: shared });
  if ((await preview(AB)) !== "Sent a post") throw new Error("share: " + (await preview(AB)));
});
await expectOk("previews: a group notification names the sender and the group", async () => {
  await send(B, GROUP, "", [photo(GROUP, B)]);
  const note = await lastNotification(C);
  if (note.title !== "Bob in Study group" || note.body !== "Sent a photo") throw new Error("group notification: " + JSON.stringify(note));
});
await expectOk("accounts: deleting an account keeps its messages valid (the sender is cleared, the files stay listed)", async () => {
  const E = await mk("e@txstate.edu", "Eve");
  const AE = await direct(E, A);
  const m = await send(E, AE, "", [photo(AE, E)]);
  await as(E, () => db.query("select public.delete_my_account()"));
  const after = await one(db.query("select sender_id, attachments from public.messages where id = $1", [m.id]));
  if (!after || after.sender_id !== null || after.attachments.length !== 1) throw new Error("after deletion: " + JSON.stringify(after));
});

// --- search ------------------------------------------------------------------------------------------------------
const search = (uid, q, conv = null, limit = 30) => as(uid, () => rows(db.query("select id, conversation_id, content from public.search_messages($1, $2, $3)", [q, conv, limit])));
await expectOk("search: any case, newest first, in every chat I am in and nowhere else", async () => {
  await send(A, AB, "Lease PDF attached");
  await send(B, BC, "lease for Carol only");
  await send(C, GROUP, "Group LEASE meeting");
  await send(B, AB, "Lease renewal next week");
  const got = await search(A, "lease");
  const texts = got.map((r) => r.content);
  // "Here is the lease" was sent with a file in the previews above.
  if (texts.join("|") !== "Lease renewal next week|Group LEASE meeting|Lease PDF attached|Here is the lease") throw new Error("Alice's results: " + texts.join("|"));
  if (got.some((r) => r.conversation_id === BC)) throw new Error("Alice found a message in a chat she is not in");
  const inChat = await search(A, "LEASE", AB);
  if (inChat.map((r) => r.content).join("|") !== "Lease renewal next week|Lease PDF attached|Here is the lease") throw new Error("one chat: " + inChat.map((r) => r.content).join("|"));
  if ((await search(A, "lease", null, 1)).length !== 1) throw new Error("limit ignored");
});
await expectOk("search: % and _ are plain characters", async () => {
  await send(A, AB, "50% off rent this month");
  await send(A, AB, "file_name.pdf is the one");
  await send(A, AB, "filexname nope");
  const pct = (await search(A, "50%", AB)).map((r) => r.content);
  if (pct.join("|") !== "50% off rent this month") throw new Error("% search: " + pct.join("|"));
  const under = (await search(A, "file_name", AB)).map((r) => r.content);
  if (under.join("|") !== "file_name.pdf is the one") throw new Error("_ search: " + under.join("|"));
  const backslash = await search(A, "\\", AB);
  if (backslash.length !== 0) throw new Error("a lone backslash matched: " + backslash.length);
});
await expectOk("search: blank words find nothing; someone outside a chat finds nothing in it", async () => {
  if ((await search(A, "   ")).length || (await search(A, "")).length || (await search(A, null)).length) throw new Error("blank search returned rows");
  if ((await search(C, "lease", AB)).length) throw new Error("Carol searched Alice and Bob's chat");
});
await expectError("search: signed out it cannot be called", () => asAnon(() => db.query("select * from public.search_messages('lease')")), "permission denied");

// --- Media, Files, Links -----------------------------------------------------------------------------------------
const AC = await direct(A, C);
const SHARE = { target_type: "apartment", target_id: "00000000-0000-4000-8000-000000000002", kind: "listing", path: "/apartments/00000000-0000-4000-8000-000000000002", title: "Sunny 2-bed", caption: null, image_url: null, author: { id: C, name: "Carol", avatar_url: null } };
const legacy = await send(A, AC, "📷 Photo", [], { imageUrl: "https://dskbzoqreandwwpxiplh.supabase.co/storage/v1/object/public/uploads/messages/a/1.jpg" });
const media = await send(A, AC, "", [photo(AC, A), video(AC, A)]);
const files = await send(C, AC, "the lease", [file(AC, C)]);
const links = await send(C, AC, "see https://example.com/a, and (https://en.wikipedia.org/wiki/Lease_(law)).");
const shared = await send(A, AC, "", [], { sharedPost: SHARE });
await send(A, AC, "no links here");
const tab = (uid, kind, before = null, limit = 30) => as(uid, () => rows(db.query("select * from public.conversation_shared_messages($1, $2, $3, $4)", [AC, kind, before, limit])));
await expectOk("shared: Media lists photos and videos (website photos too), newest first, never files", async () => {
  const got = await tab(A, "media");
  if (got.map((r) => r.id).join() !== [media.id, legacy.id].join()) throw new Error("media: " + got.map((r) => r.content).join("|"));
  const items = sharedItemsFromMessages(got, "media", sharedPostOf);
  if (items.map((i) => i.kind).join() !== "image,video,image" || items[2].legacyImageUrl !== legacy.image_url || items[0].attachment.path !== media.attachments[0].path) throw new Error("items: " + JSON.stringify(items));
});
await expectOk("shared: Files lists the other files; Links lists messages with addresses and shared posts", async () => {
  const f = await tab(C, "files");
  if (f.map((r) => r.id).join() !== files.id) throw new Error("files: " + f.map((r) => r.content).join("|"));
  const fileItems = sharedItemsFromMessages(f, "files", sharedPostOf);
  if (fileItems.length !== 1 || fileItems[0].kind !== "file" || fileItems[0].attachment.name !== "Lease (final).pdf") throw new Error("file items: " + JSON.stringify(fileItems));
  const l = await tab(C, "links");
  if (l.map((r) => r.id).join() !== [shared.id, links.id].join()) throw new Error("links: " + l.map((r) => r.content).join("|"));
  const linkItems = sharedItemsFromMessages(l, "links", sharedPostOf);
  const urls = linkItems.map((i) => i.url);
  if (urls.join(" ") !== `${SHARE.path} https://example.com/a https://en.wikipedia.org/wiki/Lease_(law)`) throw new Error("link items: " + urls.join(" "));
  if (linkItems[0].sharedPost?.title !== "Sunny 2-bed") throw new Error("the shared listing is not attached to its link");
});
await expectOk("shared: pages continue from the last message's time; someone outside the chat gets nothing", async () => {
  const first = await tab(A, "media", null, 1);
  if (first.length !== 1 || first[0].id !== media.id) throw new Error("first page: " + JSON.stringify(first.map((r) => r.id)));
  const second = await tab(A, "media", first[0].created_at, 1);
  if (second.length !== 1 || second[0].id !== legacy.id) throw new Error("second page: " + JSON.stringify(second.map((r) => r.id)));
  const third = await tab(A, "media", second[0].created_at, 1);
  if (third.length !== 0) throw new Error("a third page");
  if ((await tab(B, "media")).length || (await tab(B, "links")).length) throw new Error("Bob sees Alice and Carol's media");
});
await expectError("shared: an unknown tab is an error", () => tab(A, "photos"), "Unknown kind");
await expectError("shared: signed out it cannot be called", () => asAnon(() => db.query("select * from public.conversation_shared_messages($1, 'media')", [AC])), "permission denied");
await expectOk("indexes: the Media/Files and Links queries read their partial indexes in order, with no sort", async () => {
  await db.exec("set enable_seqscan = off");
  try {
    const plan = async (where) => (await rows(db.query(`explain select * from public.messages m where m.conversation_id = '${AC}' and m.created_at < 'infinity' and ${where} order by m.created_at desc, m.id desc limit 30`))).map((r) => r["QUERY PLAN"]).join("\n");
    const mediaPlan = await plan("(m.attachments <> '[]'::jsonb or m.image_url is not null) and m.attachments @> '[{\"kind\": \"file\"}]'::jsonb");
    if (!mediaPlan.includes("messages_media_idx") || /Sort/.test(mediaPlan)) throw new Error("media plan:\n" + mediaPlan);
    const linksPlan = await plan("(m.content ~* 'https?://' or m.shared_post is not null)");
    if (!linksPlan.includes("messages_links_idx") || /Sort/.test(linksPlan)) throw new Error("links plan:\n" + linksPlan);
  } finally {
    await db.exec("reset enable_seqscan");
  }
});
await expectOk("the attachments migration re-runs cleanly with files already sent", async () => {
  await db.exec(read(MIGRATION));
  const c = await one(db.query("select count(*)::int as n from public.messages where attachments <> '[]'::jsonb"));
  if (c.n < 10) throw new Error("messages with files: " + c.n);
});
done("MIGRATION-20 MESSAGE ATTACHMENTS");
