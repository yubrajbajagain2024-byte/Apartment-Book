"use client";

import { useState } from "react";
import { Film, Images } from "lucide-react";
import { BUSINESS_MEDIA_MAX, type BusinessMediaItem } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { ImageUploader } from "@/components/common/image-uploader";
import { VideoUploader } from "@/components/video/video-uploader";

/**
 * A post's or an ad's media: up to ten photos, or one video, never both (the database holds the same rule). Each
 * uploader writes its own hidden inputs (mediaPhotoMeta, mediaVideo); mediaMode says which one counts, and the server
 * action builds the list from them. Switching mode drops the other uploader's files from the form.
 */
export function MediaField({ userId, initial = [], videoHint }: { userId: string; initial?: BusinessMediaItem[]; videoHint?: string }) {
  const initialVideo = initial.find((m) => m.type === "video");
  const [mode, setMode] = useState<"photos" | "video">(initialVideo ? "video" : "photos");
  const photos = initial.flatMap((m) => (m.type === "image" ? [{ url: m.url, width: m.width ?? null, height: m.height ?? null, blur: null }] : []));
  const video =
    initialVideo && initialVideo.type === "video"
      ? [{ media_id: initialVideo.media_id, playback_id: initialVideo.playback_id ?? "", poster_url: initialVideo.poster_url ?? null, width: initialVideo.width ?? null, height: initialVideo.height ?? null, duration_seconds: initialVideo.duration_seconds ?? null }]
      : [];
  const options = [
    { value: "photos" as const, label: `Photos (up to ${BUSINESS_MEDIA_MAX})`, icon: Images },
    { value: "video" as const, label: "One video", icon: Film },
  ];
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="mediaMode" value={mode} />
      <div role="radiogroup" aria-label="Media" className="inline-flex self-start rounded-full bg-biz-surface-3 p-1">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200",
              mode === value ? "bg-biz-surface text-biz-ink shadow-biz" : "text-biz-ink-3 hover:text-biz-ink",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {mode === "photos" ? (
        <ImageUploader name="mediaPhotos" metaName="mediaPhotoMeta" kind="posts" userId={userId} max={BUSINESS_MEDIA_MAX} initial={photos} />
      ) : (
        <div className="flex flex-col gap-2">
          <VideoUploader name="mediaVideo" max={1} tour={false} initial={video} />
          {videoHint ? <p className="text-[13px] text-biz-ink-3">{videoHint}</p> : null}
        </div>
      )}
    </div>
  );
}
