// Unit tests for photos, videos and files in chats (src/message-media.ts). Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_ATTACHMENT_LIMITS,
  MESSAGE_ATTACHMENT_MIME_TYPES,
  MESSAGE_MEDIA_BUCKET,
  attachmentKindOf,
  attachmentMimeType,
  attachmentPreview,
  extractLinks,
  formatFileSize,
  messageAttachmentPath,
  parseAttachments,
  sharedItemsFromMessages,
} from "../src/message-media.ts";
import { sharedPostOf } from "../src/share.ts";

const CONV = "6d074520-5a10-43ee-903a-35779a1a1fcc";
const USER = "a1a1a1a1-0000-4000-8000-000000000001";
const att = (kind, extra = {}) => ({ kind, path: `${CONV}/${USER}/k-${kind}.bin`, name: `${kind}.bin`, size: 10, mime: kind === "image" ? "image/jpeg" : kind === "video" ? "video/mp4" : "application/pdf", ...extra });

test("the bucket and the limits match the database: message-media, 10 files, 50 MB each", () => {
  assert.equal(MESSAGE_MEDIA_BUCKET, "message-media");
  assert.deepEqual({ ...MESSAGE_ATTACHMENT_LIMITS }, { maxItems: 10, maxBytes: 52428800 });
  assert.ok(MESSAGE_ATTACHMENT_MIME_TYPES.includes("image/heic"));
  assert.ok(!MESSAGE_ATTACHMENT_MIME_TYPES.includes("image/svg+xml"), "no SVG");
  assert.ok(!MESSAGE_ATTACHMENT_MIME_TYPES.includes("text/html"), "no HTML");
});

test("attachmentKindOf: photos, videos, and everything else is a file (SVG too)", () => {
  assert.equal(attachmentKindOf("image/jpeg"), "image");
  assert.equal(attachmentKindOf("IMAGE/HEIC"), "image");
  assert.equal(attachmentKindOf("video/quicktime"), "video");
  assert.equal(attachmentKindOf("application/pdf"), "file");
  assert.equal(attachmentKindOf("image/svg+xml"), "file");
  assert.equal(attachmentKindOf(""), "file");
  assert.equal(attachmentKindOf(undefined), "file");
});

test("attachmentMimeType: the picker's type when the bucket takes it, else a guess from the name, else null", () => {
  assert.equal(attachmentMimeType("image/jpeg", "a.jpg"), "image/jpeg");
  assert.equal(attachmentMimeType("image/jpg"), "image/jpeg", "the common misspelling");
  assert.equal(attachmentMimeType("text/plain; charset=utf-8"), "text/plain");
  assert.equal(attachmentMimeType(null, "Lease.PDF"), "application/pdf");
  assert.equal(attachmentMimeType("application/octet-stream", "notes.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(attachmentMimeType(undefined, "IMG_0001.MOV"), "video/quicktime");
  assert.equal(attachmentMimeType("image/svg+xml", "logo.svg"), null, "SVG is never sent");
  assert.equal(attachmentMimeType("text/html", "page.html"), null);
  assert.equal(attachmentMimeType(undefined, "no-extension"), null);
});

test("messageAttachmentPath: chat folder, my folder, then id-safe name; the id defaults to a random one", () => {
  assert.equal(messageAttachmentPath(CONV, USER, "photo.jpg", "abc123"), `${CONV}/${USER}/abc123-photo.jpg`);
  assert.equal(messageAttachmentPath(CONV, USER, "My Résumé (final) v2.PDF", "x"), `${CONV}/${USER}/x-My-Resume-final-v2.PDF`);
  assert.equal(messageAttachmentPath(CONV, USER, "../../etc/passwd", "x"), `${CONV}/${USER}/x-passwd`, "folders in the name are dropped");
  assert.equal(messageAttachmentPath(CONV, USER, "照片.jpg", "x"), `${CONV}/${USER}/x-file.jpg`, "a name with nothing Storage accepts");
  assert.equal(messageAttachmentPath(CONV, USER, "", "x"), `${CONV}/${USER}/x-file`);
  assert.equal(messageAttachmentPath(CONV, USER, ".env", "x"), `${CONV}/${USER}/x-env`);
  assert.equal(messageAttachmentPath(CONV, USER, "a.jpg", "../evil/id-1"), `${CONV}/${USER}/evilid1-a.jpg`, "the id cannot add folders or dashes");
  const long = messageAttachmentPath(CONV, USER, `${"x".repeat(300)}.jpeg`, "x");
  assert.ok(long.endsWith(".jpeg") && long.length < 200, long);
  const a = messageAttachmentPath(CONV, USER, "a.jpg");
  const b = messageAttachmentPath(CONV, USER, "a.jpg");
  assert.notEqual(a, b, "two uploads of the same name get different paths");
  assert.match(a, new RegExp(`^${CONV}/${USER}/[a-z0-9]{20,}-a\\.jpg$`));
});

test("parseAttachments: tolerant; skips anything without a known kind or a path, fills harmless defaults", () => {
  assert.deepEqual(parseAttachments(null), []);
  assert.deepEqual(parseAttachments({ kind: "image" }), []);
  assert.deepEqual(parseAttachments("not json"), []);
  const full = { kind: "video", path: `${CONV}/${USER}/k-clip.mov`, name: "clip.mov", size: 2048, mime: "video/quicktime", width: 1080, height: 1920, duration: 12.5 };
  assert.deepEqual(parseAttachments([full]), [full]);
  assert.deepEqual(parseAttachments(JSON.stringify([full])), [full], "a JSON string is read too");
  const got = parseAttachments([null, "x", [], { kind: "audio", path: "p" }, { kind: "file" }, { kind: "file", path: `${CONV}/${USER}/lx3k9-Lease.pdf`, size: "big", width: -4 }]);
  assert.deepEqual(got, [{ kind: "file", path: `${CONV}/${USER}/lx3k9-Lease.pdf`, name: "Lease.pdf", size: 0, mime: "application/octet-stream", width: null, height: null, duration: null }]);
  assert.equal(parseAttachments(Array.from({ length: 12 }, () => full)).length, 10, "never more than 10");
});

test("attachmentPreview: the same words as the database", () => {
  assert.equal(attachmentPreview([]), "");
  assert.equal(attachmentPreview([att("image")]), "Sent a photo");
  assert.equal(attachmentPreview([att("image"), att("image"), att("image")]), "Sent 3 photos");
  assert.equal(attachmentPreview([att("video")]), "Sent a video");
  assert.equal(attachmentPreview([att("video"), att("video")]), "Sent 2 videos");
  assert.equal(attachmentPreview([att("file")]), "Sent a file");
  assert.equal(attachmentPreview([att("file"), att("file")]), "Sent 2 files");
  assert.equal(attachmentPreview([att("image"), att("video"), att("file"), att("image")]), "Sent 4 attachments");
  assert.equal(attachmentPreview([att("image"), att("video")]), "Sent 2 attachments");
});

test("extractLinks: http(s) addresses in order, each once, without the punctuation around them", () => {
  assert.deepEqual(extractLinks("no links here"), []);
  assert.deepEqual(extractLinks(""), []);
  assert.deepEqual(extractLinks("See https://example.com/a, then http://x.org/b."), ["https://example.com/a", "http://x.org/b"]);
  assert.deepEqual(extractLinks("(https://en.wikipedia.org/wiki/Lease_(law))"), ["https://en.wikipedia.org/wiki/Lease_(law)"], "brackets the link opened stay");
  assert.deepEqual(extractLinks("[docs](https://docs.example.com/page)"), ["https://docs.example.com/page"]);
  assert.deepEqual(extractLinks('"https://a.example/q?x=1&y=2" and https://a.example/q?x=1&y=2!'), ["https://a.example/q?x=1&y=2"], "deduplicated");
  assert.deepEqual(extractLinks("HTTPS://SHOUT.EXAMPLE/X?"), ["HTTPS://SHOUT.EXAMPLE/X"]);
  assert.deepEqual(extractLinks("https://... and https://"), [], "no host, no link");
  assert.deepEqual(extractLinks("ftp://files.example and javascript:alert(1) and xhttps://nope.example"), []);
  assert.deepEqual(extractLinks("<https://angle.example/path>"), ["https://angle.example/path"]);
  assert.deepEqual(extractLinks("line one https://a.example\nhttps://b.example/x…"), ["https://a.example", "https://b.example/x"]);
});

test("formatFileSize: bytes, then one decimal below 10, whole numbers above", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(-5), "0 B");
  assert.equal(formatFileSize(Number.NaN), "0 B");
  assert.equal(formatFileSize(800), "800 B");
  assert.equal(formatFileSize(1024), "1 KB");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(512 * 1024), "512 KB");
  assert.equal(formatFileSize(Math.round(3.4 * 1024 * 1024)), "3.4 MB");
  assert.equal(formatFileSize(45 * 1024 * 1024), "45 MB");
  assert.equal(formatFileSize(1024 * 1024 - 1), "1 MB", "1023.999 KB rounds up to the next unit");
  assert.equal(formatFileSize(1.2 * 1024 ** 3), "1.2 GB");
});

test("sharedItemsFromMessages: Media has photos, videos and website photos; Files the rest; Links the addresses and shared posts", () => {
  const listing = { target_type: "apartment", target_id: "00000000-0000-4000-8000-000000000002", kind: "listing", path: "/apartments/00000000-0000-4000-8000-000000000002", title: "Sunny 2-bed", author: { id: USER, name: "Carol" } };
  const rows = [
    { id: "m3", sender_id: USER, created_at: "3", content: "deck https://slides.example/d", image_url: null, shared_post: listing, attachments: [att("file"), att("image")] },
    { id: "m2", sender_id: USER, created_at: "2", content: "", image_url: null, shared_post: null, attachments: [att("image"), att("video")] },
    { id: "m1", sender_id: null, created_at: "1", content: "📷 Photo", image_url: "https://x.supabase.co/storage/v1/object/public/uploads/messages/u/1.jpg", shared_post: null },
    { id: "m0", sender_id: USER, created_at: "0", content: "old", image_url: "javascript:alert(1)", shared_post: null, attachments: [] },
  ];
  const media = sharedItemsFromMessages(rows, "media", sharedPostOf);
  assert.deepEqual(media.map((i) => [i.messageId, i.kind]), [["m3", "image"], ["m2", "image"], ["m2", "video"], ["m1", "image"]]);
  assert.equal(media[3].legacyImageUrl, rows[2].image_url);
  assert.equal(media[3].senderId, null);
  assert.equal(media[0].attachment.path, rows[0].attachments[1].path);
  const files = sharedItemsFromMessages(rows, "files", sharedPostOf);
  assert.deepEqual(files.map((i) => [i.messageId, i.kind, i.attachment.name]), [["m3", "file", "file.bin"]]);
  const links = sharedItemsFromMessages(rows, "links", sharedPostOf);
  assert.deepEqual(links.map((i) => [i.messageId, i.url]), [["m3", "https://slides.example/d"], ["m3", "/apartments/00000000-0000-4000-8000-000000000002"]]);
  assert.equal(links[1].sharedPost.title, "Sunny 2-bed");
  assert.equal(links[0].sharedPost, undefined);
  assert.deepEqual(sharedItemsFromMessages(rows, "links").map((i) => i.url), ["https://slides.example/d"], "without a reader, shared posts are left out");
});
