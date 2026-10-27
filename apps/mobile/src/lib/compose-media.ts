import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library/legacy";
import * as VideoThumbnails from "expo-video-thumbnails";
import { muxPosterUrl, uploadImage, type ListingVideo, type PhotoMeta, type UploadKind } from "@apartment-book/shared";
import { localId, type ComposeMedia, type ComposeMode } from "./compose-store";
import { supabase } from "./supabase";
import { uploadVideo } from "./video";

/**
 * Turning what the camera and the photo library hand over into the create flow's items (lib/compose-store.ts), and
 * getting those items to the servers. Nothing is re-encoded on the way in, so a shot or a pick reaches the editor at
 * once: photos become JPEGs no longer than PHOTO_EDGE on their long side (HEIC included, which the website cannot show)
 * only as they upload, while the title and caption are being written. Videos go up as they are, straight to the video
 * provider.
 */
const PHOTO_EDGE = 2160;

/** A photo as the flow keeps it: a JPEG at most PHOTO_EDGE long, its orientation applied. */
export async function normalizePhoto(uri: string, width = 0, height = 0): Promise<{ uri: string; width: number; height: number }> {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > PHOTO_EDGE) context.resize(width >= height ? { width: PHOTO_EDGE } : { height: PHOTO_EDGE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  if (!saved.uri) throw new Error("Could not prepare this photo. Try another one.");
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/** A still from a video (a local JPEG) and the frame's size: what a recorded clip shows in thumbnails and as its cover. */
export async function videoStill(uri: string, seconds = 0): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    const still = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, Math.round(seconds * 1000)), quality: 0.7 });
    return { uri: still.uri, width: still.width, height: still.height };
  } catch {
    return null;
  }
}

/** A photo just taken with the in-app camera. */
export function photoFromCamera(shot: { uri: string; width: number; height: number }): ComposeMedia {
  return photoItem(shot.uri, shot.width, shot.height);
}

/** A clip just recorded with the in-app camera, `duration` as the camera timed it. */
export async function videoFromCamera(uri: string, duration: number): Promise<ComposeMedia> {
  const still = await videoStill(uri);
  return videoItem({ uri, width: still?.width ?? 1080, height: still?.height ?? 1920, duration, mimeType: Platform.OS === "ios" ? "video/quicktime" : "video/mp4", fileName: uri.split("/").pop() ?? null, thumbUri: still?.uri ?? null });
}

/**
 * An item from the in-app gallery's grid, as a file this app may read. On iOS the library's own file paths (DCIM) can
 * only be opened by Photos itself: the player and the uploader are refused ("you don't have permission to view it"),
 * so the photo or video is copied out through Photos (its edited version when it has one; an iCloud original is
 * downloaded first) into this app's cache. Elsewhere the library hands over a readable file.
 */
export async function itemFromAsset(asset: MediaLibrary.Asset): Promise<ComposeMedia> {
  let local: string;
  if (Platform.OS === "ios" && asset.uri.startsWith("ph://")) {
    const dir = `${FileSystem.cacheDirectory ?? ""}compose/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const ext = (asset.filename.split(".").pop() ?? "").toLowerCase() || (asset.mediaType === "video" ? "mov" : "jpg");
    local = `${dir}${localId("a")}.${ext}`;
    await FileSystem.copyAsync({ from: asset.uri, to: local });
  } else {
    const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: true });
    // A fragment can hang off a video's file address (slow-motion edits): the file is the part before it.
    local = (info.localUri ?? info.uri).split("#")[0];
  }
  if (!local) throw new Error("This item isn't on your phone yet. Try again in a moment.");
  if (asset.mediaType === "video") {
    // On iOS the library's own address draws the video's still (expo-image reads ph:// from Photos): no frame to cut.
    const still = Platform.OS === "ios" && asset.uri.startsWith("ph://") ? null : await videoStill(local);
    return videoItem({ uri: local, width: asset.width || still?.width || 1080, height: asset.height || still?.height || 1920, duration: asset.duration || null, mimeType: mimeFor(asset.filename), fileName: asset.filename, thumbUri: still?.uri ?? asset.uri });
  }
  return photoItem(local, asset.width, asset.height);
}

/** Several library picks at once, a few at a time (each may wait on iCloud); in the order picked, failures left out. */
export async function itemsFromAssets(assets: MediaLibrary.Asset[], onEach?: (done: number) => void): Promise<{ items: ComposeMedia[]; failed: number }> {
  const results: (ComposeMedia | null)[] = new Array(assets.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < assets.length) {
      const i = next++;
      results[i] = await itemFromAsset(assets[i]).catch(() => null);
      onEach?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, assets.length) }, worker));
  const items = results.filter((r): r is ComposeMedia => r !== null);
  return { items, failed: assets.length - items.length };
}

/** Items from the system photo picker, the fallback where the in-app gallery can't read the library. */
export async function pickWithSystemPicker(mode: ComposeMode, room: { photos: number; videos: number }): Promise<ComposeMedia[]> {
  const limit = mode === "reel" ? 1 : Math.max(1, room.photos + room.videos);
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: mode === "reel" || room.photos === 0 ? ["videos"] : room.videos === 0 ? ["images"] : ["images", "videos"],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 1,
    exif: false,
    videoMaxDuration: mode === "reel" ? 180 : undefined,
  });
  if (result.canceled) return [];
  const items: ComposeMedia[] = [];
  for (const a of result.assets) {
    if (a.type === "video") {
      const still = await videoStill(a.uri);
      // The system picker gives a video's length in milliseconds.
      items.push(videoItem({ uri: a.uri, width: a.width || still?.width || 1080, height: a.height || still?.height || 1920, duration: a.duration ? a.duration / 1000 : null, mimeType: a.mimeType ?? mimeFor(a.fileName), fileName: a.fileName ?? null, thumbUri: still?.uri ?? null }));
    } else {
      items.push(photoItem(a.uri, a.width, a.height));
    }
  }
  return items;
}

function photoItem(uri: string, width: number, height: number): ComposeMedia {
  return { id: localId(), kind: "photo", uri, originalUri: uri, baseUri: uri, width, height, duration: null, mimeType: "image/jpeg", fileName: null, thumbUri: null, coverTime: 0, texts: [], crop: null };
}

function videoItem(v: { uri: string; width: number; height: number; duration: number | null; mimeType: string | null; fileName: string | null; thumbUri: string | null }): ComposeMedia {
  return { id: localId(), kind: "video", uri: v.uri, originalUri: v.uri, baseUri: v.uri, width: v.width, height: v.height, duration: v.duration, mimeType: v.mimeType, fileName: v.fileName, thumbUri: v.thumbUri, coverTime: 0, texts: [], crop: null };
}

function mimeFor(name: string | null | undefined): string | null {
  const ext = name?.split(".").pop()?.toLowerCase();
  if (ext === "mov") return "video/quicktime";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  return null;
}

/** "0:42", "3:05": a video's length on a thumbnail. */
export function clock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------------------------------------------------

export type UploadStatus = { phase: "uploading" | "processing" | "done" | "failed"; progress: number; error?: string };
type Uploaded = { kind: "photo"; photo: PhotoMeta } | { kind: "video"; video: ListingVideo };
type Job = { uri: string; place: string; status: UploadStatus; done: Promise<Uploaded>; cancel: () => void };
/**
 * Where a photo goes: a post's to posts/<you>/…, a listing's to its own folder (roommates, items), and an anonymous
 * listing's to the folder with no names in it (uploads/buzz/anon/<random>, see uploadImage): a picture's address would
 * otherwise carry its poster's id. Videos go to the video provider either way, whose record of them only the uploader
 * can read.
 */
export type UploadPlace = { kind: UploadKind; anonymous: boolean };
const POST_PLACE: UploadPlace = { kind: "posts", anonymous: false };

/**
 * Uploads start as soon as the publish screen opens (while the title and caption are being written), one job per item
 * and file: an item whose file changes (a new crop) starts over. Post waits for whatever is still going.
 */
const jobs = new Map<string, Job>();
let snapshot: Record<string, UploadStatus> = {};
const watchers = new Set<() => void>();

function publish() {
  snapshot = Object.fromEntries([...jobs].map(([id, job]) => [id, job.status]));
  watchers.forEach((w) => w());
}

function setStatus(id: string, job: Job, status: UploadStatus) {
  if (jobs.get(id) !== job) return;
  job.status = status;
  publish();
}

/** The upload of `item`'s current file to `place`: the one already running, or a new one (a new file, or a new place). */
export function ensureUpload(item: ComposeMedia, userId: string, place: UploadPlace = POST_PLACE): Promise<Uploaded> {
  const where = `${place.kind}:${place.anonymous ? "anon" : "named"}`;
  const existing = jobs.get(item.id);
  if (existing && existing.uri === item.uri && existing.place === where && existing.status.phase !== "failed") return existing.done;
  existing?.cancel();
  let cancelled = false;
  let stopTransfer: (() => void) | null = null;
  const job: Job = {
    uri: item.uri,
    place: where,
    status: { phase: "uploading", progress: 0 },
    done: Promise.resolve(null as never),
    cancel: () => {
      cancelled = true;
      stopTransfer?.();
    },
  };
  job.done = (async (): Promise<Uploaded> => {
    try {
      if (item.kind === "photo") {
        // Made a JPEG of a sensible size here, on its way up, rather than when it was taken or picked.
        const ready = await normalizePhoto(item.uri, item.width, item.height);
        if (cancelled) throw new Error("Upload cancelled");
        const data = await fetch(ready.uri).then((r) => r.arrayBuffer());
        if (cancelled) throw new Error("Upload cancelled");
        const url = await uploadImage(supabase, { kind: place.kind, userId, file: data, fileName: `${item.id}.jpg`, contentType: "image/jpeg", anonymous: place.anonymous });
        setStatus(item.id, job, { phase: "done", progress: 1 });
        return { kind: "photo", photo: { url, width: ready.width || item.width || null, height: ready.height || item.height || null, blur: null } };
      }
      const size = await FileSystem.getInfoAsync(item.uri).then((i) => (i.exists ? i.size : undefined)).catch(() => undefined);
      const video = await uploadVideo(
        { uri: item.uri, fileSize: size ?? null, fileName: item.fileName ?? `${item.id}.mov`, mimeType: item.mimeType },
        (progress, phase) => setStatus(item.id, job, { phase, progress }),
        { cancelled: () => cancelled, onTask: (stop) => (stopTransfer = stop) },
      );
      setStatus(item.id, job, { phase: "done", progress: 1 });
      return { kind: "video", video };
    } catch (e) {
      setStatus(item.id, job, { phase: "failed", progress: 0, error: e instanceof Error ? e.message : "The upload failed" });
      throw e;
    }
  })();
  // Nobody may be waiting yet: a failure is shown on the thumbnail, not thrown into the void.
  job.done.catch(() => {});
  jobs.set(item.id, job);
  publish();
  return job.done;
}

/** Stops and forgets every upload except those of `keep` (items still in the post). */
export function dropUploads(keep: string[] = []) {
  for (const [id, job] of jobs) {
    if (keep.includes(id)) continue;
    job.cancel();
    jobs.delete(id);
  }
  publish();
}

/** Each item's upload, kept current: what the publish screen's thumbnails and its Post button show. */
export function useUploads(): Record<string, UploadStatus> {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => {
        watchers.delete(w);
      };
    },
    () => snapshot,
    () => snapshot,
  );
}

/** A processed video with its poster taken at the cover frame chosen in the editor (Mux makes stills at any time). */
export function withCover(video: ListingVideo, coverTime: number): ListingVideo {
  if (coverTime <= 0) return video;
  return { ...video, poster_url: muxPosterUrl(video.playback_id, Math.round(coverTime * 10) / 10) };
}

/** Copies the post's photos and video to the phone's library (More options → Save to device). Best effort. */
export async function saveToDevice(media: ComposeMedia[]): Promise<boolean> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) return false;
  for (const m of media) {
    await MediaLibrary.saveToLibraryAsync(m.uri).catch(() => {});
  }
  return true;
}
