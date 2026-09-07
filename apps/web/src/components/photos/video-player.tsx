"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

/** Only one feed video plays at a time; sound preference is shared across posts (Instagram behaviour). */
let activeVideo: HTMLVideoElement | null = null;
let soundOn = false;
const soundListeners = new Set<(on: boolean) => void>();
function setSound(on: boolean) {
  soundOn = on;
  soundListeners.forEach((l) => l(on));
}

export function VideoPlayer({
  src,
  poster,
  className,
  /** Autoplay muted while at least this fraction is visible. */
  threshold = 0.6,
  aspect,
}: {
  src: string;
  poster?: string | null;
  className?: string;
  threshold?: number;
  aspect?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(() => !soundOn);
  const [ready, setReady] = useState(false);

  // Attach the stream (HLS via hls.js where the browser cannot play it natively).
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    const isHls = /\.m3u8(\?|$)/.test(src);
    if (!isHls) {
      video.src = src;
    } else {
      // hls.js first wherever Media Source Extensions exist (Chrome, Firefox, desktop
      // Safari). Chrome answers "maybe" to native HLS but cannot play it, so only fall
      // back to the native player when hls.js is unsupported (iPhone Safari).
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const instance = new Hls({ capLevelToPlayerSize: true, startLevel: -1 });
          instance.loadSource(src);
          instance.attachMedia(video);
          hls = instance;
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
        }
      });
    }
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);

  // Play when in view, pause when out; never more than one at once.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
          if (activeVideo && activeVideo !== video) activeVideo.pause();
          activeVideo = video;
          video.play().catch(() => {});
        } else {
          video.pause();
          if (activeVideo === video) activeVideo = null;
        }
      },
      { threshold: [0, threshold, 1] },
    );
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
      if (activeVideo === video) activeVideo = null;
    };
  }, [threshold]);

  // Shared sound preference.
  useEffect(() => {
    const listener = (on: boolean) => setMuted(!on);
    soundListeners.add(listener);
    return () => {
      soundListeners.delete(listener);
    };
  }, []);

  return (
    <div className={cn("relative h-full w-full bg-black", className)} style={aspect ? { aspectRatio: aspect } : undefined}>
      <video
        ref={ref}
        poster={poster ?? undefined}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setReady(true)}
        className={cn("h-full w-full object-cover transition-opacity", ready ? "opacity-100" : "opacity-0")}
      />
      {!ready ? <div className="absolute inset-0 ab-skeleton" /> : null}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setSound(muted);
        }}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute bottom-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/75"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
