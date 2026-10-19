"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Upload, Video as VideoIcon, X } from "lucide-react";
import { MAX_VIDEO_SIZE_BYTES, MAX_VIDEOS_PER_LISTING, muxPosterUrl, videosFor, type ListingVideo, type Media } from "@apartment-book/shared";
import { formatBytes } from "@/lib/photos";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TourRecorder } from "./tour-recorder";

type Item = {
  key: string;
  mediaId: string | null;
  status: "uploading" | "processing" | "ready" | "failed";
  progress: number;
  preview: string | null;
  error?: string;
  video: ListingVideo | null;
  sizeBytes?: number;
};

/**
 * Video uploads go straight from the browser to the video provider in resumable
 * chunks (they survive a dropped connection), then we wait for processing.
 * Submits one hidden `videos` input (JSON) per ready video.
 */
export function VideoUploader({
  name = "videos",
  initial,
  max = MAX_VIDEOS_PER_LISTING,
  tour = true,
}: {
  name?: string;
  initial?: unknown;
  max?: number;
  /** Show the guided tour recorder (apartments). */
  tour?: boolean;
}) {
  const [items, setItems] = useState<Item[]>(() => videosFor(initial).map((v, i) => ({ key: `initial-${i}`, mediaId: v.media_id, status: "ready", progress: 100, preview: null, video: v })));
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const previews = useRef<string[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const urls = previews.current;
    const pending = timers.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      pending.forEach((t) => clearTimeout(t));
    };
  }, []);

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  async function pollStatus(key: string, mediaId: string) {
    try {
      const res = await fetch(`/api/video/${mediaId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Status check failed");
      const { media } = (await res.json()) as { media: Media };
      if (media.status === "ready" && media.playback_id) {
        update(key, {
          status: "ready",
          progress: 100,
          video: { media_id: media.id, playback_id: media.playback_id, poster_url: media.poster_url ?? muxPosterUrl(media.playback_id), width: media.width, height: media.height, duration_seconds: media.duration_seconds },
        });
        return;
      }
      if (media.status === "failed") {
        update(key, { status: "failed", error: media.error ?? "Processing failed" });
        return;
      }
      update(key, { status: "processing" });
    } catch (e) {
      update(key, { error: errorMessage(e, "Status check failed") });
    }
    timers.current.set(key, setTimeout(() => pollStatus(key, mediaId), 3000));
  }

  async function addFile(file: File) {
    if (items.filter((i) => i.status !== "failed").length >= max) {
      setNotice(`You can add up to ${max} videos.`);
      return;
    }
    setNotice(null);
    if (!file.type.startsWith("video/") && !/\.(mov|mp4|m4v|webm|hevc)$/i.test(file.name)) {
      setNotice("Please choose a video file.");
      return;
    }
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      setNotice(`Videos must be 2 GB or smaller (this one is ${formatBytes(file.size)}).`);
      return;
    }
    const key = `${Date.now()}-${file.name}`;
    const preview = URL.createObjectURL(file);
    previews.current.push(preview);
    setItems((prev) => [...prev, { key, mediaId: null, status: "uploading", progress: 0, preview, video: null, sizeBytes: file.size }]);

    try {
      const res = await fetch("/api/video/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sizeBytes: file.size, fileName: file.name }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not start the upload");
      const { mediaId, uploadUrl } = (await res.json()) as { mediaId: string; uploadUrl: string };
      update(key, { mediaId });

      const { createUpload } = await import("@mux/upchunk");
      const upload = createUpload({ endpoint: uploadUrl, file, chunkSize: 5120, dynamicChunkSize: true, maxFileSize: MAX_VIDEO_SIZE_BYTES / 1024 });
      upload.on("progress", (e: { detail: number }) => update(key, { progress: Math.round(e.detail) }));
      upload.on("error", (e: { detail: { message?: string } }) => update(key, { status: "failed", error: e.detail?.message ?? "Upload failed" }));
      upload.on("offline", () => update(key, { error: "Connection lost, upload paused. It resumes when you're back online." }));
      upload.on("online", () => update(key, { error: undefined }));
      upload.on("success", () => {
        update(key, { status: "processing", progress: 100, error: undefined });
        pollStatus(key, mediaId);
      });
    } catch (e) {
      update(key, { status: "failed", error: errorMessage(e, "Upload failed") });
    }
  }

  function remove(key: string) {
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  const ready = items.filter((i) => i.status === "ready" && i.video);
  const canAdd = items.filter((i) => i.status !== "failed").length < max;

  return (
    <div className="flex flex-col gap-3">
      {ready.map((i) => (
        <input key={i.key} type="hidden" name={name} value={JSON.stringify(i.video)} />
      ))}

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.key} className={cn("relative aspect-[4/5] overflow-hidden rounded-lg bg-black ring-1", item.status === "failed" ? "ring-red-400" : "ring-gray-200")}>
              {item.preview ? (
                <video src={item.preview} muted playsInline className="h-full w-full object-cover" />
              ) : item.video?.poster_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- provider poster frame
                <img src={item.video.poster_url} alt="Video" className="h-full w-full object-cover" />
              ) : null}
              {item.status !== "ready" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 px-2 text-center text-white">
                  {item.status === "failed" ? (
                    <span className="text-xs font-medium">{item.error}</span>
                  ) : (
                    <>
                      <Spinner className="h-6 w-6" />
                      <span className="text-xs font-semibold">{item.status === "uploading" ? `Uploading ${item.progress}%` : "Processing…"}</span>
                      {item.status === "uploading" ? (
                        <span className="h-1.5 w-3/4 overflow-hidden rounded-full bg-white/30">
                          <span className="block h-full bg-brand-500 transition-all" style={{ width: `${item.progress}%` }} />
                        </span>
                      ) : (
                        <span className="text-[11px] text-white/80">Making streaming versions</span>
                      )}
                      {item.error ? <span className="text-[11px] text-amber-200">{item.error}</span> : null}
                    </>
                  )}
                </div>
              ) : (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <VideoIcon className="h-3 w-3" /> Ready{item.video?.duration_seconds ? ` · ${Math.round(item.video.duration_seconds)}s` : ""}
                </span>
              )}
              <button type="button" onClick={() => remove(item.key)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label="Remove video">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {canAdd ? (
        <div className="flex flex-wrap gap-2">
          {tour ? (
            <Button type="button" onClick={() => setRecording(true)}>
              <Camera className="h-4 w-4" /> Record a tour
            </Button>
          ) : null}
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-gray-200 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-300">
            <Upload className="h-4 w-4" /> Upload a video
            <input type="file" accept="video/*,.mov,.mp4,.m4v,.webm" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFile(f); e.target.value = ""; }} />
          </label>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-gray-200 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-300 md:hidden">
            <Camera className="h-4 w-4" /> Camera app
            <input type="file" accept="video/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFile(f); e.target.value = ""; }} />
          </label>
        </div>
      ) : null}
      <p className="text-xs text-gray-500">
        {tour ? "Walk through the front door, living room, kitchen, bedroom, bathroom and the view. " : ""}
        Any phone video works (iPhone .mov included), up to 2 GB. The original is uploaded untouched and streams at the best quality each viewer&apos;s connection allows.
      </p>
      {notice ? <p className="text-sm text-red-600">{notice}</p> : null}
      {recording ? <TourRecorder onClose={() => setRecording(false)} onDone={(file) => { setRecording(false); void addFile(file); }} /> : null}
    </div>
  );
}
