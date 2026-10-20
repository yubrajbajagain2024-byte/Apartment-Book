// Snaps: a photo or video from the camera, sent straight into the direct chats of friends and people you chat with, and
// opened once by each of them. What the apps and the database (migration 28, 20261020120000_snaps.sql) agree on.

/** The private storage bucket Snap files go to, as {sender}/{32 hex}.{jpg|mp4|mov}. */
export const SNAP_BUCKET = "snaps";

/** What the bucket takes: JPEG photos (the apps convert HEIC first) and the camera's own videos. */
export const SNAP_MIME_TYPES = ["image/jpeg", "video/mp4", "video/quicktime"] as const;
export type SnapMime = (typeof SNAP_MIME_TYPES)[number];

/** 50 MB a file (what the bucket takes), videos up to 30 seconds (about what fits at the camera's best quality), 50 people a Snap. */
export const SNAP_LIMITS = { maxBytes: 52428800, maxVideoSeconds: 30, maxRecipients: 50 } as const;

/** Days an unopened Snap waits: then it expires and is deleted. */
export const SNAP_LIFETIME_DAYS = 31;

/** How long after opening a Snap its recipient can still load it (closing it ends that at once). */
export const SNAP_VIEW_WINDOW_SECONDS = 120;

/**
 * Where an opened Snap's file is loaded from: Storage's signed-in download, sent with the viewer's own session. Every
 * request (each range of a video too) is checked against the view, so nothing outlives it; a signed link would, since
 * its lifetime is the asker's to choose.
 */
export function snapMediaUrl(apiUrl: string, path: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/storage/v1/object/authenticated/${SNAP_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The inbox row of a chat whose newest message is a Snap. */
export const SNAP_PREVIEW = "Sent a Snap";
/** The body of the notification its recipient gets. */
export const SNAP_NOTIFICATION_BODY = "Sent you a Snap";

/** The database's words when a Snap cannot be opened (open_snap). */
export const SNAP_ERRORS = {
  expired: "This Snap expired",
  opened: "You already opened this Snap",
  unavailable: "This Snap isn't available",
} as const;

export type SnapKind = "image" | "video";

/** What a message carries for a Snap (messages.snap): enough to draw it in the chat, nothing to see. */
export type MessageSnap = {
  id: string;
  kind: SnapKind;
  /** When it expires unopened: 31 days after it was sent. */
  expires_at: string;
  /** When its recipient opened it; null until then. */
  opened_at: string | null;
  /** It went before its recipient opened it: it expired, or its sender's account was deleted. */
  gone?: boolean;
};

/**
 * Where a Snap stands: new (not opened yet, still openable), opened, expired (not opened in time), or unavailable (it
 * went before it expired, with its sender's account).
 */
export type SnapState = "new" | "opened" | "expired" | "unavailable";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{32}$/;

const isDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** messages.snap read safely: null for anything that is not a Snap (an older row, or JSON from somewhere else). */
export function snapOf(value: unknown): MessageSnap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !UUID.test(v.id)) return null;
  if (v.kind !== "image" && v.kind !== "video") return null;
  if (!isDate(v.expires_at)) return null;
  const snap: MessageSnap = { id: v.id.toLowerCase(), kind: v.kind, expires_at: v.expires_at, opened_at: isDate(v.opened_at) ? v.opened_at : null };
  if (v.gone === true) snap.gone = true;
  return snap;
}

export function snapState(snap: MessageSnap, now: number = Date.now()): SnapState {
  if (snap.opened_at) return "opened";
  if (Date.parse(snap.expires_at) <= now) return "expired";
  return snap.gone ? "unavailable" : "new";
}

/**
 * The line under "Snap" in a chat: "Tap to view" for its recipient while it waits, "Delivered" for its sender; then
 * "Opened", "Expired" or "Unavailable" for both.
 */
export function snapStatusText(snap: MessageSnap, mine: boolean, now: number = Date.now()): string {
  switch (snapState(snap, now)) {
    case "opened":
      return "Opened";
    case "expired":
      return "Expired";
    case "unavailable":
      return "Unavailable";
    default:
      return mine ? "Delivered" : "Tap to view";
  }
}

/** The file extension a Snap of this type is stored with. */
export function snapExtension(mime: string): "jpg" | "mp4" | "mov" | null {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    default:
      return null;
  }
}

/** The type a picked file goes up as, from what the picker said or its name; null when a Snap cannot be one. */
export function snapMimeType(mime: string | null | undefined, fileName?: string | null): SnapMime | null {
  const type = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (type === "image/jpeg" || type === "image/jpg") return "image/jpeg";
  if (type === "video/mp4") return "video/mp4";
  if (type === "video/quicktime") return "video/quicktime";
  const ext = /\.([a-z0-9]+)$/i.exec(fileName ?? "")?.[1]?.toLowerCase();
  if (!type || type === "application/octet-stream") {
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "mp4" || ext === "m4v") return "video/mp4";
    if (ext === "mov" || ext === "qt") return "video/quicktime";
  }
  return null;
}

/** A random 32-character hex name for a Snap file. Not a secret: the policies decide who reads it. */
export function newSnapToken(random: () => number = Math.random): string {
  let token = "";
  while (token.length < 32) token += Math.floor(random() * 16).toString(16);
  return token;
}

/** Where a Snap file goes: the sender's own folder, a random name, the type's extension. */
export function snapMediaPath(userId: string, token: string, mime: SnapMime): string {
  const ext = snapExtension(mime);
  if (!UUID.test(userId) || !TOKEN.test(token) || !ext) throw new Error("Invalid Snap file name");
  return `${userId.toLowerCase()}/${token}.${ext}`;
}

/** Which of the database's refusals an error from open_snap is, if any. */
export function snapErrorState(message: string | null | undefined): keyof typeof SNAP_ERRORS | null {
  const text = message ?? "";
  if (text.includes(SNAP_ERRORS.expired)) return "expired";
  if (text.includes(SNAP_ERRORS.opened)) return "opened";
  if (text.includes(SNAP_ERRORS.unavailable)) return "unavailable";
  return null;
}
