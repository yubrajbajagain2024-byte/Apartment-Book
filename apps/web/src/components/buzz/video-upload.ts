"use client";

/**
 * The one video a buzz may carry: read its length on the device first (longer than 60 s is refused before a single
 * byte is uploaded), then a resumable direct upload to Mux through the existing `/api/video` routes, then wait until
 * it can stream. The file name never leaves the device. Only the playback id, poster and size go into the buzz; the
 * database stores it without any media id.
 */
import { BUZZ_LIMITS, MAX_VIDEO_SIZE_BYTES, muxPosterUrl, type Media } from "@apartment-book/shared";

export interface UploadedBuzzVideo {
  playbackId: string;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/** Same 0.5 s of slack the database allows (`duration_seconds ≤ 60.5`). */
export const BUZZ_VIDEO_MAX_SECONDS = BUZZ_LIMITS.videoMaxSeconds + 0.5;

export class BuzzVideoTooLong extends Error {
  constructor() {
    super("Videos on Buzz max out at 60 seconds.");
    this.name = "BuzzVideoTooLong";
  }
}

/** Duration and size from the file's own metadata, read locally. */
export function readVideoMeta(file: File): Promise<{ durationSeconds: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const d = video.duration;
      resolve({ durationSeconds: Number.isFinite(d) ? d : null, width: video.videoWidth || null, height: video.videoHeight || null });
      done();
    };
    video.onerror = () => {
      done();
      reject(new Error("This video could not be opened here. Try an MP4 or MOV file."));
    };
    video.src = url;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadBuzzVideo(file: File, onProgress: (percent: number, phase: "uploading" | "processing") => void): Promise<UploadedBuzzVideo> {
  if (file.size > MAX_VIDEO_SIZE_BYTES) throw new Error("Videos must be 2 GB or smaller.");
  const meta = await readVideoMeta(file);
  if (meta.durationSeconds !== null && meta.durationSeconds > BUZZ_VIDEO_MAX_SECONDS) throw new BuzzVideoTooLong();

  const start = await fetch("/api/video/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // No file name: it can say more about the person than the video does.
    body: JSON.stringify({ sizeBytes: file.size }),
  });
  if (!start.ok) throw new Error(((await start.json().catch(() => ({}))) as { error?: string }).error ?? "Could not start the upload.");
  const { mediaId, uploadUrl } = (await start.json()) as { mediaId: string; uploadUrl: string };

  onProgress(0, "uploading");
  const { createUpload } = await import("@mux/upchunk");
  await new Promise<void>((resolve, reject) => {
    const upload = createUpload({ endpoint: uploadUrl, file, chunkSize: 5120, dynamicChunkSize: true, maxFileSize: MAX_VIDEO_SIZE_BYTES / 1024 });
    upload.on("progress", (e: { detail: number }) => onProgress(Math.round(e.detail), "uploading"));
    upload.on("error", (e: { detail: { message?: string } }) => reject(new Error(e.detail?.message ?? "The upload failed. Try again.")));
    upload.on("success", () => resolve());
  });

  onProgress(100, "processing");
  // Mux needs a little while to make the streaming versions.
  for (let attempt = 0; attempt < 200; attempt++) {
    await sleep(attempt === 0 ? 1500 : 3000);
    const res = await fetch(`/api/video/${mediaId}`, { cache: "no-store" });
    if (!res.ok) continue;
    const { media } = (await res.json()) as { media: Media };
    if (media.status === "failed") throw new Error(media.error ?? "The video could not be processed. Try another one.");
    if (media.status === "ready" && media.playback_id) {
      const duration = media.duration_seconds ?? meta.durationSeconds;
      if (duration !== null && duration > BUZZ_VIDEO_MAX_SECONDS) throw new BuzzVideoTooLong();
      return {
        playbackId: media.playback_id,
        posterUrl: media.poster_url ?? muxPosterUrl(media.playback_id),
        width: media.width ?? meta.width,
        height: media.height ?? meta.height,
        durationSeconds: duration,
      };
    }
  }
  throw new Error("The video is taking too long to process. Try again in a moment.");
}
