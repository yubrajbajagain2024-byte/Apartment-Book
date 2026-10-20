import { Platform } from "react-native";
import * as Device from "expo-device";
import { File as DeviceFile } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { SNAP_BUCKET, SNAP_LIMITS, formatFileSize, newSnapToken, snapMediaPath, snapMimeType, type SnapKind, type SnapMime } from "@apartment-book/shared";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase";

// Snaps on this device: taking one with the phone's own camera, getting it ready to send, and uploading it (with
// progress) to the private snaps bucket. Sending it is send_snap() (packages/shared/src/queries/snaps.ts).

/** A photo or video just taken, ready to preview and send. */
export type SnapShot = {
  uri: string;
  kind: SnapKind;
  mime: SnapMime;
  width: number | null;
  height: number | null;
  /** Seconds, for a video. */
  duration: number | null;
  /** Bytes. */
  size: number;
};

/** Camera access was refused: the screen offers Settings. */
export class SnapPermissionError extends Error {}

/** A photo is sent at most this long on its long side (sharp on any phone, quick to send and to open), as a JPEG. */
const PHOTO_EDGE = 1920;
const PHOTO_QUALITY = 0.85;

/** The Simulator has no camera: there a Snap comes from the photo library instead, so the flow can still be tried. */
export const SNAP_CAMERA_AVAILABLE = Platform.OS !== "web" && Device.isDevice;

/** Bytes of a file on this device, or 0 when that cannot be told. */
function fileSize(uri: string): number {
  if (Platform.OS === "web") return 0;
  try {
    const size = new DeviceFile(uri).size;
    return typeof size === "number" && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

/**
 * Opens the phone's own camera, photo or video (up to 30 seconds, at its best quality), and gets what it took ready to
 * send. Null when the camera is closed without taking anything.
 */
export async function captureSnap(): Promise<SnapShot | null> {
  let result: ImagePicker.ImagePickerResult;
  if (SNAP_CAMERA_AVAILABLE) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new SnapPermissionError("Allow camera access in Settings to take Snaps.");
    result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images", "videos"],
      quality: 1,
      exif: false,
      videoMaxDuration: SNAP_LIMITS.maxVideoSeconds,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
    });
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 1, exif: false, shouldDownloadFromNetwork: true });
  }
  const asset = result.canceled ? null : result.assets?.[0];
  return asset ? prepareSnap(asset) : null;
}

async function prepareSnap(asset: ImagePicker.ImagePickerAsset): Promise<SnapShot> {
  const video = asset.type === "video" || (asset.mimeType ?? "").toLowerCase().startsWith("video/");
  if (video) {
    const mime = snapMimeType(asset.mimeType, asset.fileName ?? asset.uri) ?? snapMimeType(null, asset.uri);
    if (!mime) throw new Error("This video can't be sent as a Snap.");
    // The picker reports milliseconds.
    const seconds = typeof asset.duration === "number" && asset.duration > 0 ? asset.duration / 1000 : null;
    if (seconds !== null && seconds > SNAP_LIMITS.maxVideoSeconds + 0.5) throw new Error(`Snaps can be up to ${SNAP_LIMITS.maxVideoSeconds} seconds long. Try a shorter video.`);
    const size = asset.fileSize || fileSize(asset.uri);
    if (size > SNAP_LIMITS.maxBytes) throw new Error(`This video is over ${formatFileSize(SNAP_LIMITS.maxBytes)}. Try a shorter one.`);
    return { uri: asset.uri, kind: "video", mime, width: asset.width || null, height: asset.height || null, duration: seconds ?? SNAP_LIMITS.maxVideoSeconds, size };
  }
  // Photos are always re-encoded: a JPEG (iPhone photos are often HEIC), no longer than PHOTO_EDGE, without metadata.
  const width = asset.width || 0;
  const height = asset.height || 0;
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(width, height) > PHOTO_EDGE) context.resize(width >= height ? { width: PHOTO_EDGE } : { height: PHOTO_EDGE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY, base64: false });
  if (!saved.uri) throw new Error("Couldn't prepare this photo. Try again.");
  return { uri: saved.uri, kind: "image", mime: "image/jpeg", width: saved.width || null, height: saved.height || null, duration: null, size: fileSize(saved.uri) };
}

/** An upload under way: where the file goes, the promise of it being there, and a way to stop it. */
export type SnapUpload = { path: string; done: Promise<string>; cancel: () => void };

function uploadErrorText(message: string, status?: number): string {
  if (/bucket not found/i.test(message)) return "Snaps aren't set up on the server yet. Please try again later.";
  if (/maximum allowed size|too large/i.test(message) || status === 413) return `This Snap is over ${formatFileSize(SNAP_LIMITS.maxBytes)}.`;
  if (/mime type/i.test(message) || status === 415) return "This file can't be sent as a Snap.";
  if (/row-level security|unauthori[sz]ed|jwt/i.test(message) || status === 401 || status === 403) return "You can't send Snaps right now. Log in again and try once more.";
  if (/network|failed to fetch|timed? ?out|offline/i.test(message) || status === 0) return "The upload failed. Check your connection and try again.";
  return message ? `The upload failed: ${message}` : "The upload failed. Please try again.";
}

/** The `message` of a Storage error body, or the body itself. */
function storageMessage(body: string | null | undefined): string {
  try {
    const parsed = JSON.parse(body ?? "") as { message?: unknown; error?: unknown };
    return String(parsed.message ?? parsed.error ?? "");
  } catch {
    return (body ?? "").slice(0, 200);
  }
}

/**
 * Uploads a Snap to {me}/{random}.{ext} in the private snaps bucket, straight from the file (nothing held in memory),
 * reporting how much has gone up. Nobody but its sender can read it until it is sent and opened.
 */
export function startSnapUpload(userId: string, shot: SnapShot, onProgress?: (fraction: number) => void): SnapUpload {
  const path = snapMediaPath(userId, newSnapToken(), shot.mime);
  let stopped = false;
  let task: FileSystem.UploadTask | null = null;
  const done = (async () => {
    if (Platform.OS === "web") {
      const bytes = await fetch(shot.uri).then((r) => r.arrayBuffer());
      const { error } = await supabase.storage.from(SNAP_BUCKET).upload(path, bytes, { contentType: shot.mime, upsert: false, cacheControl: "no-store" });
      if (error) throw new Error(uploadErrorText(error.message));
      onProgress?.(1);
      return path;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Log in again to send Snaps.");
    if (stopped) throw new Error("The upload was cancelled.");
    task = FileSystem.createUploadTask(
      `${SUPABASE_URL}/storage/v1/object/${SNAP_BUCKET}/${path}`,
      shot.uri,
      {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        // no-store: no cache along the way keeps a copy of a Snap.
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": shot.mime, "x-upsert": "false", "cache-control": "no-store" },
      },
      (p) => {
        if (p.totalBytesExpectedToSend > 0) onProgress?.(Math.min(1, p.totalBytesSent / p.totalBytesExpectedToSend));
      },
    );
    let result: FileSystem.FileSystemUploadResult | null | undefined;
    try {
      result = await task.uploadAsync();
    } catch (e) {
      throw new Error(uploadErrorText(e instanceof Error ? e.message : String(e), 0));
    }
    if (stopped || !result) throw new Error("The upload was cancelled.");
    if (result.status < 200 || result.status >= 300) throw new Error(uploadErrorText(storageMessage(result.body), result.status));
    onProgress?.(1);
    return path;
  })();
  return {
    path,
    done,
    cancel: () => {
      stopped = true;
      void task?.cancelAsync().catch(() => {});
    },
  };
}
