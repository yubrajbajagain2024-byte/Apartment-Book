// Replies in chats (migration 31). Pure helpers only: no queries and no runtime imports, so the unit tests can load
// this file directly.
import type { MessageAttachmentKind } from "./message-media";

/**
 * What the message answered was, when it had no words (or besides them). The database decides this from the original
 * message when the reply is sent, in replyKindOf()'s order; the apps show a matching label and icon.
 */
export type MessageReplyKind = "text" | "photo" | "video" | "voice" | "file" | "snap" | "post" | "reel" | "listing";

/**
 * What a reply carries about the message it answers (messages.reply_to): a snapshot the database builds from the
 * original the moment the reply is sent, so the quoted line reads without another query and stays even if the
 * original is later deleted. The apps send only `{ id }`; everything else is the database's, never the sender's.
 */
export type MessageReply = {
  /** The original message's id: tapping the quote jumps to it. */
  id: string;
  /** Who wrote the original; null when their account is gone. */
  sender_id: string | null;
  kind: MessageReplyKind;
  /** The original's first REPLY_TEXT_MAX_LENGTH characters, or null when it had no words. */
  text: string | null;
};

/** How much of the original's text the snapshot keeps (the database cuts there too). */
export const REPLY_TEXT_MAX_LENGTH = 140;

const KINDS: readonly MessageReplyKind[] = ["text", "photo", "video", "voice", "file", "snap", "post", "reel", "listing"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The snapshot stored on a message, if it is one. Anything malformed (old rows, hand-made JSON) reads as "no reply". */
export function replyOf(value: unknown): MessageReply | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" && UUID.test(v.id) ? v.id : null;
  if (!id) return null;
  const kind = typeof v.kind === "string" && (KINDS as readonly string[]).includes(v.kind) ? (v.kind as MessageReplyKind) : "text";
  const text = typeof v.text === "string" && v.text.length > 0 ? v.text.slice(0, REPLY_TEXT_MAX_LENGTH) : null;
  return { id, sender_id: typeof v.sender_id === "string" && UUID.test(v.sender_id) ? v.sender_id : null, kind, text };
}

/** The fields of the original message the snapshot is built from. */
export type ReplySourceMessage = {
  id: string;
  sender_id: string | null;
  content: string;
  image_url?: string | null;
  shared_post?: unknown;
  attachments?: unknown;
  snap?: unknown;
};

const ATTACHMENT_KINDS: readonly MessageAttachmentKind[] = ["image", "video", "audio", "file"];

/** The kinds of a message's files, from the raw column as the database reads it (anything else counts as none). */
function attachmentKinds(value: unknown): MessageAttachmentKind[] {
  let list: unknown = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>).kind : null))
    .filter((kind): kind is MessageAttachmentKind => typeof kind === "string" && (ATTACHMENT_KINDS as readonly string[]).includes(kind));
}

/** What a message was, for the quote: the same order the database follows (a Snap first, then a share, then files). */
export function replyKindOf(m: ReplySourceMessage): MessageReplyKind {
  if (m.snap && typeof m.snap === "object") return "snap";
  const shared = m.shared_post && typeof m.shared_post === "object" ? (m.shared_post as Record<string, unknown>) : null;
  if (shared) {
    const type = typeof shared.target_type === "string" ? shared.target_type : "";
    if (type && type !== "post") return "listing";
    return shared.kind === "reel" ? "reel" : "post";
  }
  const files = attachmentKinds(m.attachments);
  if (files.length > 0) {
    if (files.every((k) => k === "audio")) return "voice";
    if (files.some((k) => k === "video")) return "video";
    if (files.some((k) => k === "image")) return "photo";
    if (files.every((k) => k === "file")) return "file";
    return "photo";
  }
  if (typeof m.image_url === "string" && /^https:\/\//i.test(m.image_url)) return "photo";
  return "text";
}

/**
 * The snapshot the database will store for a reply to `m`, built here as well so a message still sending shows its
 * quote exactly as the saved one will (the server's copy then replaces it unchanged).
 */
export function replySnapshotOf(m: ReplySourceMessage): MessageReply {
  const text = (m.content ?? "").slice(0, REPLY_TEXT_MAX_LENGTH);
  return { id: m.id, sender_id: m.sender_id ?? null, kind: replyKindOf(m), text: text.length > 0 ? text : null };
}

const LABELS: Record<MessageReplyKind, string> = {
  text: "Message",
  photo: "Photo",
  video: "Video",
  voice: "Voice message",
  file: "File",
  snap: "Snap",
  post: "Post",
  reel: "Reel",
  listing: "Listing",
};

/** What the quote says: the original's words, or what it was ("Photo", "Voice message", …) when it had none. */
export function replyText(reply: MessageReply): string {
  return reply.text ?? LABELS[reply.kind];
}

/** "Photo", "Voice message", … for a kind: the word beside the quote's icon when the original had words too. */
export function replyKindLabel(kind: MessageReplyKind): string {
  return LABELS[kind];
}
