import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { muxPosterUrl, type ListingVideo, type Media } from "@apartment-book/shared";
import { apiFetch } from "./api";

export type PickedVideo = ImagePicker.ImagePickerAsset;

export async function pickVideo(source: "library" | "camera"): Promise<PickedVideo | null> {
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Allow camera access in Settings to film a tour.");
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["videos"], videoMaxDuration: 180, videoQuality: ImagePicker.UIImagePickerControllerQualityType.High });
    return result.canceled ? null : result.assets[0];
  }
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Allow photo access in Settings to add a video.");
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsMultipleSelection: false, quality: 1 });
  return result.canceled ? null : result.assets[0];
}

/**
 * Upload a video straight to the video provider (never through our server),
 * then wait until it is processed. Resolves with the snapshot stored on listings.
 */
export async function uploadVideo(asset: PickedVideo, onProgress: (fraction: number, phase: "uploading" | "processing") => void): Promise<ListingVideo> {
  const start = await apiFetch<{ mediaId: string; uploadUrl: string }>("/api/video/uploads", {
    method: "POST",
    body: JSON.stringify({ sizeBytes: asset.fileSize ?? undefined, fileName: asset.fileName ?? "tour.mp4" }),
  });
  const task = FileSystem.createUploadTask(
    start.uploadUrl,
    asset.uri,
    { httpMethod: "PUT", uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers: { "Content-Type": asset.mimeType ?? "video/mp4" } },
    (p) => onProgress(p.totalBytesExpectedToSend ? p.totalBytesSent / p.totalBytesExpectedToSend : 0, "uploading"),
  );
  const res = await task.uploadAsync();
  if (!res || res.status >= 300) throw new Error(`Upload failed (${res?.status ?? "no response"})`);
  onProgress(1, "processing");

  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const { media } = await apiFetch<{ media: Media }>(`/api/video/${start.mediaId}`);
    if (media.status === "ready" && media.playback_id) {
      return { media_id: media.id, playback_id: media.playback_id, poster_url: media.poster_url ?? muxPosterUrl(media.playback_id), width: media.width, height: media.height, duration_seconds: media.duration_seconds };
    }
    if (media.status === "failed") throw new Error(media.error ?? "Video processing failed");
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("The video is taking too long to process. Try again in a minute.");
}
