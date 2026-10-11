// Photos, videos and files in chats (migration 20). Pure helpers only: no queries and no runtime imports, so the
// unit tests can load this file directly.
import type { SharedPost } from "./types/models";

/** The private Storage bucket for chat files. Objects live at {conversationId}/{userId}/{id}-{file name}. */
export const MESSAGE_MEDIA_BUCKET = "message-media";

/** At most 10 files per message, each up to 50 MB (the bucket and the database enforce the same numbers). */
export const MESSAGE_ATTACHMENT_LIMITS = { maxItems: 10, maxBytes: 50 * 1024 * 1024 } as const;

/**
 * What the bucket accepts. Anything else is refused by Storage, so check with attachmentMimeType() before uploading.
 * SVG and HTML are deliberately missing: a browser would run what is inside them.
 */
export const MESSAGE_ATTACHMENT_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/rtf",
  "text/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
];

export type MessageAttachmentKind = "image" | "video" | "file";

/** One file sent with a message (an entry of messages.attachments). */
export type MessageAttachment = {
  kind: MessageAttachmentKind;
  /** Storage path in MESSAGE_MEDIA_BUCKET; show it through signMessageMedia(). Always {conversationId}/{senderId}/… */
  path: string;
  /** The file name as picked, for display. */
  name: string;
  /** Bytes. */
  size: number;
  mime: string;
  /** Pixels, for photos and videos, so the bubble can keep its shape while the file loads. */
  width?: number | null;
  height?: number | null;
  /** Seconds, for videos (expo-image-picker reports milliseconds: divide by 1000). */
  duration?: number | null;
};

/** The tabs of a chat's "shared" screen. */
export type SharedContentKind = "media" | "files" | "links";

/** One square or row of a chat's Media, Files or Links tab. */
export type SharedItem = {
  messageId: string;
  senderId: string | null;
  createdAt: string;
  kind: "image" | "video" | "file" | "link";
  /** Photos, videos and files sent as attachments. */
  attachment?: MessageAttachment;
  /** A photo sent from the website before attachments existed (a public URL; no signing needed). */
  legacyImageUrl?: string;
  /** Links: an http(s) address from the text, or for a shared post its website path (starts with "/"). */
  url?: string;
  /** Links: the shared post, reel or listing behind `url` when the link is one; open it in the app, not in a browser. */
  sharedPost?: SharedPost;
};

const KINDS: readonly MessageAttachmentKind[] = ["image", "video", "file"];

/** "image" for photos, "video" for videos, "file" for everything else (SVG included: it is not shown as a picture). */
export function attachmentKindOf(mime: string): MessageAttachmentKind {
  const m = typeof mime === "string" ? mime.trim().toLowerCase() : "";
  if (m.startsWith("image/") && !m.startsWith("image/svg")) return "image";
  if (m.startsWith("video/")) return "video";
  return "file";
}

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

/**
 * The content type to upload a picked file with, or null when it cannot be sent: the picker's type when the bucket
 * accepts it ("image/jpg" read as "image/jpeg"), else one guessed from the file name's extension.
 */
export function attachmentMimeType(mime: string | null | undefined, fileName?: string | null): string | null {
  let m = typeof mime === "string" ? mime.split(";")[0].trim().toLowerCase() : "";
  if (m === "image/jpg" || m === "image/pjpeg") m = "image/jpeg";
  if (m && MESSAGE_ATTACHMENT_MIME_TYPES.includes(m)) return m;
  const ext = typeof fileName === "string" && fileName.includes(".") ? fileName.split(".").pop()?.trim().toLowerCase() : undefined;
  return (ext && EXTENSION_TYPES[ext]) || null;
}

function randomHex(bytes: number): string {
  const out = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(out);
  else for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 256);
  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A file name Storage accepts (it refuses many characters outside plain ASCII): accents dropped, anything else that is
 * not a letter, digit, "_" or "-" becomes "-", the extension kept, at most 80 characters before it.
 */
function safeFileName(fileName: string): string {
  let raw = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  try {
    raw = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  } catch {
    // Engines without normalize() keep the name; the replacements below still make it safe.
  }
  const dot = raw.lastIndexOf(".");
  const ext = dot > 0 ? raw.slice(dot + 1).replace(/[^A-Za-z0-9]+/g, "").slice(0, 10) : "";
  const base =
    (dot > 0 ? raw.slice(0, dot) : raw)
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, 80)
      .replace(/[-_]+$/g, "") || "file";
  return ext ? `${base}.${ext}` : base;
}

/**
 * Where to upload a file for a message: `${conversationId}/${userId}/${id}-${safe file name}`. The id defaults to a
 * fresh random one (time first, so a folder lists in sending order); pass your own to retry the same upload. Only
 * letters, digits and "_" are kept from it, so the first "-" always ends the id.
 */
export function messageAttachmentPath(conversationId: string, userId: string, fileName: string, id?: string): string {
  const key = (id ?? "").replace(/[^A-Za-z0-9_]+/g, "") || `${Date.now().toString(36)}${randomHex(8)}`;
  return `${conversationId}/${userId}/${key}-${safeFileName(fileName)}`;
}

const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** The display name hidden in a path: its last part without the "{id}-" in front. */
function nameFromPath(path: string): string {
  const last = path.split("/").pop() ?? "";
  return last.replace(/^[A-Za-z0-9_]+-/, "") || last || "file";
}

/**
 * A message's attachments, from whatever the row carries. Tolerant: anything that is not a list reads as none, and
 * entries without a known kind or a path are skipped (missing names, sizes or types get harmless defaults).
 */
export function parseAttachments(value: unknown): MessageAttachment[] {
  let list: unknown = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: MessageAttachment[] = [];
  for (const entry of list) {
    if (out.length >= MESSAGE_ATTACHMENT_LIMITS.maxItems) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const v = entry as Record<string, unknown>;
    const kind = typeof v.kind === "string" && (KINDS as readonly string[]).includes(v.kind) ? (v.kind as MessageAttachmentKind) : null;
    const path = typeof v.path === "string" && v.path.trim() ? v.path : null;
    if (!kind || !path) continue;
    out.push({
      kind,
      path,
      name: typeof v.name === "string" && v.name.trim() ? v.name : nameFromPath(path),
      size: finiteOrNull(v.size) ?? 0,
      mime: typeof v.mime === "string" && v.mime.trim() ? v.mime : "application/octet-stream",
      width: finiteOrNull(v.width),
      height: finiteOrNull(v.height),
      duration: finiteOrNull(v.duration),
    });
  }
  return out;
}

/**
 * The inbox line for a message of files without words; the same text the database writes into last_message_preview
 * and notifications. "" when there are none.
 */
export function attachmentPreview(attachments: MessageAttachment[]): string {
  const n = attachments?.length ?? 0;
  if (n === 0) return "";
  const images = attachments.filter((a) => a.kind === "image").length;
  const videos = attachments.filter((a) => a.kind === "video").length;
  if (images === n) return n === 1 ? "Sent a photo" : `Sent ${n} photos`;
  if (videos === n) return n === 1 ? "Sent a video" : `Sent ${n} videos`;
  if (images === 0 && videos === 0) return n === 1 ? "Sent a file" : `Sent ${n} files`;
  return `Sent ${n} attachments`;
}

// An http(s) address up to the next space or quote; what ends a sentence is trimmed off afterwards.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"`]+/gi;
const TRAILING = /[.,;:!?'"*»…]$/;
const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

const count = (s: string, c: string) => s.split(c).length - 1;

function trimLink(url: string): string {
  let u = url;
  for (;;) {
    const last = u.slice(-1);
    if (TRAILING.test(last)) u = u.slice(0, -1);
    // A closing bracket belongs to the link only when the link opened it: "(see https://x.y/a_(b))" keeps one.
    else if (PAIRS[last] && count(u, PAIRS[last]) < count(u, last)) u = u.slice(0, -1);
    else return u;
  }
}

/** The http(s) links in a message, in order, each once, without the punctuation that ends a sentence. */
export function extractLinks(text: string): string[] {
  if (typeof text !== "string" || !text) return [];
  const out: string[] = [];
  for (const match of text.match(URL_PATTERN) ?? []) {
    const url = trimLink(match);
    if (!/^https?:\/\/[^/?#\s]*[A-Za-z0-9]/i.test(url)) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** "800 B", "1.5 KB", "512 KB", "3.4 MB", "45 MB", "1.2 GB": one decimal below 10, whole numbers above. */
export function formatFileSize(bytes: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  let text = value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
  if (text === "1024" && unit < units.length - 1) {
    text = "1";
    unit++;
  }
  return `${text} ${units[unit]}`;
}

/** The fields of a message row the shared tabs need. */
export type SharedSourceMessage = {
  id: string;
  sender_id: string | null;
  created_at: string;
  content: string;
  image_url: string | null;
  shared_post?: unknown;
  attachments?: unknown;
};

/**
 * The items of one tab, from messages newest first (each message in its own order). `readSharedPost` reads a
 * message's shared_post (pass sharedPostOf from ./share); without it, shared posts are not listed under Links.
 */
export function sharedItemsFromMessages(
  messages: SharedSourceMessage[],
  kind: SharedContentKind,
  readSharedPost?: (value: unknown) => SharedPost | null,
): SharedItem[] {
  const items: SharedItem[] = [];
  for (const m of messages) {
    const base = { messageId: m.id, senderId: m.sender_id ?? null, createdAt: m.created_at };
    if (kind === "links") {
      for (const url of extractLinks(m.content ?? "")) items.push({ ...base, kind: "link", url });
      const shared = m.shared_post && readSharedPost ? readSharedPost(m.shared_post) : null;
      if (shared) items.push({ ...base, kind: "link", url: shared.path, sharedPost: shared });
      continue;
    }
    if (kind === "media" && typeof m.image_url === "string" && /^https:\/\//i.test(m.image_url)) {
      items.push({ ...base, kind: "image", legacyImageUrl: m.image_url });
    }
    for (const attachment of parseAttachments(m.attachments)) {
      const wanted = kind === "media" ? attachment.kind !== "file" : attachment.kind === "file";
      if (wanted) items.push({ ...base, kind: attachment.kind, attachment });
    }
  }
  return items;
}
