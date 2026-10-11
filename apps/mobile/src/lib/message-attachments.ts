import { Alert, Image as NativeImage, Linking, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File as DeviceFile } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import type { Href } from "expo-router";
import {
  MESSAGE_ATTACHMENT_LIMITS,
  MESSAGE_MEDIA_BUCKET,
  attachmentKindOf,
  attachmentMimeType,
  formatFileSize,
  messageAttachmentPath,
  signMessageMedia,
  type MessageAttachment,
  type MessageAttachmentKind,
  type MessageWithSender,
  type SharedPost,
} from "@apartment-book/shared";
import { heicToJpeg, isHeic, type PickedAsset } from "./photos";
import { SITE_URL, supabase } from "./supabase";

// Photos, videos and files in chats: picking them on the device, uploading them to the private message-media bucket,
// and opening what other people sent. The screens only deal with PendingAttachment (on this device) and
// MessageAttachment (sent, stored on the message).

const MAX_BYTES = MESSAGE_ATTACHMENT_LIMITS.maxBytes;
const MAX_ITEMS = MESSAGE_ATTACHMENT_LIMITS.maxItems;

/** Where one picked file is while its message is being sent. */
export type UploadStatus = "waiting" | "uploading" | "done" | "failed";

/** A photo, video or file picked on this device and not sent yet. */
export type PendingAttachment = {
  /** Letters and digits only. Also the id part of the storage path, so a retry uploads to the same place. */
  id: string;
  kind: MessageAttachmentKind;
  /** The file on this device (file://, or a blob: or data: URL on the web). */
  uri: string;
  name: string;
  /** Bytes; 0 when the picker did not say (the upload measures it). */
  size: number;
  /** The content type it is uploaded with, always one the bucket accepts. */
  mime: string;
  width: number | null;
  height: number | null;
  /** Seconds, for videos. */
  duration: number | null;
  /** Web only: the picked file itself, read directly. */
  file?: Blob | null;
};

/** The files of a message that is still being sent from this device. */
export type OutgoingFiles = {
  items: PendingAttachment[];
  status: Record<string, UploadStatus>;
  /** Item id -> the attachment it became once uploaded (kept across retries, so nothing goes up twice). */
  uploaded: Record<string, MessageAttachment>;
};

/** A message in the open chat: from the server, or one of mine still sending (`pending`) or not sent (`failed`). */
export type ChatMessage = MessageWithSender & { pending?: boolean; failed?: boolean; error?: string | null; outgoing?: OutgoingFiles };

/** What a picker gave back: the files that can be sent, and a sentence for each one that cannot. */
export type PickResult = { items: PendingAttachment[]; problems: string[] };

export const ATTACHMENT_LIMIT_TEXT = `You can send up to ${MAX_ITEMS} files at a time.`;
const WHAT_CAN_BE_SENT = "You can send photos, videos, PDFs, Word, Excel and PowerPoint files, text files and zip files.";

function newAttachmentId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** The last part of a URI, for guessing a type from its extension. */
function uriName(uri: string): string {
  const last = uri.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** A display name the database accepts: 1 to 255 characters, extension kept. */
function cleanName(name: string | null | undefined, fallback: string): string {
  const base = (name ?? "").split(/[\\/]/).pop()?.trim() || fallback;
  if (base.length <= 255) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 11 ? base.slice(dot) : "";
  return base.slice(0, 255 - ext.length) + ext;
}

/** Bytes of a file on this device, or 0 when it cannot be told. */
function localFileSize(uri: string): number {
  if (Platform.OS === "web") return 0;
  try {
    const size = new DeviceFile(uri).size;
    return typeof size === "number" && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

/** A picture's size in pixels, or null when it cannot be read quickly (the bubble then shows it square). */
function pictureSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    const done = (size: { width: number; height: number } | null) => {
      clearTimeout(timer);
      resolve(size && size.width > 0 && size.height > 0 ? size : null);
    };
    try {
      NativeImage.getSize(uri, (width, height) => done({ width, height }), () => done(null));
    } catch {
      done(null);
    }
  });
}

const tooBigText = (name: string) => `"${name}" is over ${formatFileSize(MAX_BYTES)}.`;
const unsupportedText = (name: string) => `"${name}" isn't a type of file you can send.`;

/** iPhone photos are often HEIC, which most browsers cannot show: send them as JPEG, like the rest of the app does. */
async function asJpeg(asset: PickedAsset, name: string): Promise<{ uri: string; name: string; width: number | null; height: number | null }> {
  const jpeg = await heicToJpeg(asset);
  const renamed = /\.(heic|heif)$/i.test(name) ? name.replace(/\.(heic|heif)$/i, ".jpg") : /\.jpe?g$/i.test(name) ? name : `${name}.jpg`;
  return { uri: jpeg.uri, name: cleanName(renamed, "photo.jpg"), width: jpeg.width || null, height: jpeg.height || null };
}

async function fromLibraryAsset(asset: ImagePicker.ImagePickerAsset, problems: string[]): Promise<PendingAttachment | null> {
  const video = asset.type === "video" || (asset.mimeType ?? "").toLowerCase().startsWith("video/");
  const stamp = Date.now();
  let name = cleanName(asset.fileName, video ? `video-${stamp}.${Platform.OS === "ios" ? "mov" : "mp4"}` : `photo-${stamp}.jpg`);
  let uri = asset.uri;
  let width: number | null = asset.width || null;
  let height: number | null = asset.height || null;
  let size = asset.fileSize ?? 0;
  let mime = attachmentMimeType(asset.mimeType, asset.fileName ?? uriName(asset.uri)) ?? attachmentMimeType(null, name);
  if (!video && isHeic(asset)) {
    try {
      const jpeg = await asJpeg(asset, name);
      ({ uri, name } = jpeg);
      width = jpeg.width ?? width;
      height = jpeg.height ?? height;
      mime = "image/jpeg";
      size = 0;
    } catch {
      problems.push(`"${name}" couldn't be prepared. Try another photo.`);
      return null;
    }
  }
  if (!mime || (video && !mime.startsWith("video/"))) {
    problems.push(unsupportedText(name));
    return null;
  }
  if (!size) size = localFileSize(uri) || asset.file?.size || 0;
  if (size > MAX_BYTES) {
    problems.push(tooBigText(name));
    return null;
  }
  const kind = video ? "video" : attachmentKindOf(mime);
  // expo-image-picker reports milliseconds; attachments keep seconds.
  const duration = kind === "video" && typeof asset.duration === "number" && asset.duration > 0 ? Math.round(asset.duration / 100) / 10 : null;
  return { id: newAttachmentId(), kind, uri, name, size, mime, width, height, duration, file: asset.file ?? null };
}

async function fromDocument(asset: DocumentPicker.DocumentPickerAsset, problems: string[]): Promise<PendingAttachment | null> {
  let name = cleanName(asset.name, `file-${Date.now()}`);
  let mime = attachmentMimeType(asset.mimeType, asset.name || uriName(asset.uri));
  if (!mime) {
    problems.push(unsupportedText(name));
    return null;
  }
  let uri = asset.uri;
  let size = asset.size ?? 0;
  let width: number | null = null;
  let height: number | null = null;
  const kind = attachmentKindOf(mime);
  if (kind === "image" && Platform.OS !== "web" && (mime === "image/heic" || mime === "image/heif")) {
    try {
      const jpeg = await asJpeg({ uri, width: 0, height: 0, mimeType: mime, fileName: name }, name);
      ({ uri, name, width, height } = jpeg);
      mime = "image/jpeg";
      size = 0;
    } catch {
      problems.push(`"${name}" couldn't be prepared. Try another photo.`);
      return null;
    }
  }
  if (!size) size = localFileSize(uri) || asset.file?.size || 0;
  if (size > MAX_BYTES) {
    problems.push(tooBigText(name));
    return null;
  }
  // Files do not come with dimensions; a picture's own keep its shape in the chat.
  if (kind === "image" && (!width || !height)) ({ width, height } = (await pictureSize(uri)) ?? { width: null, height: null });
  return { id: newAttachmentId(), kind, uri, name, size, mime, width, height, duration: null, file: asset.file ?? null };
}

/** Turns picked assets into sendable items, one at a time (HEIC conversion is heavy), never more than `remaining`. */
async function collect<T>(assets: T[], remaining: number, convert: (asset: T, problems: string[]) => Promise<PendingAttachment | null>): Promise<PickResult> {
  const items: PendingAttachment[] = [];
  const problems: string[] = [];
  for (const asset of assets) {
    if (items.length >= remaining) {
      problems.push(ATTACHMENT_LIMIT_TEXT);
      break;
    }
    const item = await convert(asset, problems);
    if (item) items.push(item);
  }
  if (problems.some((p) => p.endsWith("isn't a type of file you can send."))) problems.push(WHAT_CAN_BE_SENT);
  return { items, problems };
}

/** Photos and videos from the library, several at once (in the order they were tapped), up to `remaining`. */
export async function pickLibraryMedia(remaining: number): Promise<PickResult> {
  if (remaining <= 0) return { items: [], problems: [ATTACHMENT_LIMIT_TEXT] };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: remaining > 1,
    selectionLimit: remaining,
    orderedSelection: true,
    quality: 1,
    exif: false,
    // Photos kept in iCloud ("Optimize iPhone Storage") are downloaded instead of failing.
    shouldDownloadFromNetwork: true,
  });
  if (result.canceled) return { items: [], problems: [] };
  return collect(result.assets, remaining, fromLibraryAsset);
}

/** A photo or a short video from the camera. */
export async function captureMedia(): Promise<PickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error("Allow camera access in Settings to take photos and videos.");
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images", "videos"],
    quality: 1,
    exif: false,
    // About what fits in 50 MB at the camera's best quality.
    videoMaxDuration: 30,
  });
  if (result.canceled) return { items: [], problems: [] };
  return collect(result.assets.slice(0, 1), 1, fromLibraryAsset);
}

/** Any files (PDFs, documents, spreadsheets, zips, photos and videos from Files), several at once, up to `remaining`. */
export async function pickDocuments(remaining: number): Promise<PickResult> {
  if (remaining <= 0) return { items: [], problems: [ATTACHMENT_LIMIT_TEXT] };
  const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: true, base64: false });
  if (result.canceled) return { items: [], problems: [] };
  return collect(result.assets, remaining, fromDocument);
}

/** The whole file, for the upload: straight from disk on a phone, from the picked File on the web. */
async function readBytes(item: PendingAttachment): Promise<ArrayBuffer> {
  if (item.file && typeof item.file.arrayBuffer === "function") return item.file.arrayBuffer();
  if (Platform.OS !== "web") {
    try {
      const bytes = await new DeviceFile(item.uri).bytes();
      // Exactly the file's bytes, even if the array is a window on a bigger buffer.
      if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer as ArrayBuffer;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } catch {
      // Fall through to fetch, which reads any URI React Native understands.
    }
  }
  const response = await fetch(item.uri);
  return response.arrayBuffer();
}

/** Storage answers "already exists" when a retry uploads a file that did reach it the first time. */
function alreadyUploaded(error: unknown): boolean {
  const e = (error ?? {}) as { message?: unknown; statusCode?: unknown; status?: unknown };
  return e.statusCode === "409" || e.status === 409 || (typeof e.message === "string" && /already exists|duplicate/i.test(e.message));
}

function uploadErrorText(error: unknown, name: string): string {
  const e = (error ?? {}) as { message?: unknown; statusCode?: unknown; status?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  const code = String(e.statusCode ?? e.status ?? "");
  if (/row-level security|unauthori[sz]ed/i.test(message) || code === "403") return "You can't send files in this chat right now.";
  if (/bucket not found/i.test(message)) return "Sending files isn't available yet. Please try again later.";
  if (/maximum allowed size|too large/i.test(message) || code === "413") return tooBigText(name);
  if (/mime type/i.test(message) || code === "415") return unsupportedText(name);
  if (/network request failed|failed to fetch|timed? ?out/i.test(message)) return "The upload failed. Check your connection and try again.";
  return message ? `Couldn't upload "${name}": ${message}` : `Couldn't upload "${name}". Please try again.`;
}

/**
 * Upload one picked file to {conversation}/{me}/{id}-{name} in the message-media bucket and describe it for the
 * message. Uploading the same item again (a retry) goes to the same path, and "already exists" counts as done.
 */
export async function uploadAttachment(conversationId: string, userId: string, item: PendingAttachment): Promise<MessageAttachment> {
  let bytes: ArrayBuffer;
  try {
    bytes = await readBytes(item);
  } catch {
    throw new Error(`Couldn't read "${item.name}". Try picking it again.`);
  }
  const size = bytes.byteLength;
  if (size <= 0) throw new Error(`"${item.name}" is empty.`);
  if (size > MAX_BYTES) throw new Error(tooBigText(item.name));
  const path = messageAttachmentPath(conversationId, userId, item.name, item.id);
  const { error } = await supabase.storage.from(MESSAGE_MEDIA_BUCKET).upload(path, bytes, { contentType: item.mime, upsert: false, cacheControl: "3600" });
  if (error && !alreadyUploaded(error)) throw new Error(uploadErrorText(error, item.name));
  const attachment: MessageAttachment = { kind: item.kind, path, name: item.name, size, mime: item.mime };
  if (item.width) attachment.width = Math.round(item.width);
  if (item.height) attachment.height = Math.round(item.height);
  if (item.duration) attachment.duration = item.duration;
  return attachment;
}

/**
 * Best effort: files uploaded for a message that was then discarded. A send whose reply was lost may have gone through
 * after all, so a file that a message in the chat shows is kept (and so is any file when the check itself fails).
 */
export async function removeUploadedFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const shown = await Promise.all(
      paths.map(async (path) => {
        const conversationId = path.split("/")[0];
        const { data, error } = await supabase.from("messages").select("id").eq("conversation_id", conversationId).contains("attachments", JSON.stringify([{ path }])).limit(1);
        return Boolean(error) || (data?.length ?? 0) > 0;
      }),
    );
    const unused = paths.filter((_, i) => !shown[i]);
    if (unused.length > 0) await supabase.storage.from(MESSAGE_MEDIA_BUCKET).remove(unused);
  } catch {
    // Left behind; nothing points at them.
  }
}

/** "0:07", "1:23", "1:02:03". "" when unknown. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "PDF", "DOCX", … from a file name; "" when it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1).toUpperCase() : "";
}

/** An address in the in-app browser (Safari view on iPhone), or the system browser if that cannot open. */
export async function openInBrowser(url: string, tint?: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, { controlsColor: tint, dismissButtonStyle: "close" });
  } catch {
    await Linking.openURL(url).catch(() => Alert.alert("Couldn't open this link", url));
  }
}

/** Open a sent file (a PDF, a document, …) with a fresh short-lived link. */
export async function openMessageFile(attachment: Pick<MessageAttachment, "path">, tint?: string): Promise<void> {
  let url: string | undefined;
  try {
    url = (await signMessageMedia(supabase, [attachment.path], 600))[attachment.path];
  } catch {
    url = undefined;
  }
  if (!url) {
    Alert.alert("Couldn't open this file", "It may have been deleted, or you're offline.");
    return;
  }
  await openInBrowser(url, tint);
}

const APP_PATH = /^\/(apartments|roommates|marketplace|posts|buzz|profile)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** The app screen for a link to this app's own website (a listing, post, Buzz post or profile), or null. */
export function appPathForUrl(url: string): string | null {
  const site = /^https?:\/\/([^/?#]+)/i.exec(SITE_URL)?.[1]?.toLowerCase();
  const link = /^https?:\/\/([^/?#]+)(\/[^?#]*)?/i.exec(url.trim());
  if (!site || !link || link[1].toLowerCase() !== site) return null;
  const match = APP_PATH.exec(link[2] ?? "");
  return match ? `/${match[1].toLowerCase()}/${match[2].toLowerCase()}` : null;
}

/** A link tapped in a chat: our own posts and listings open in the app, anything else in the in-app browser. */
export function openChatLink(url: string, router: { push: (href: Href) => void }, tint?: string): void {
  const inApp = appPathForUrl(url);
  if (inApp) router.push(inApp);
  else void openInBrowser(url, tint);
}

/** The app screen behind a shared post's website path. */
export function sharedPostHref(shared: Pick<SharedPost, "target_type" | "target_id">) {
  const params = { id: shared.target_id };
  switch (shared.target_type) {
    case "apartment":
      return { pathname: "/apartments/[id]", params } as const;
    case "roommate":
      return { pathname: "/roommates/[id]", params } as const;
    case "item":
      return { pathname: "/marketplace/[id]", params } as const;
    default:
      return { pathname: "/posts/[id]", params } as const;
  }
}
