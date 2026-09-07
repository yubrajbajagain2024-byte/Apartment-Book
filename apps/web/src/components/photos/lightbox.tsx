"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import type { PhotoMeta } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

/**
 * Full-screen viewer that shows the untouched original file (no resizing or
 * re-encoding). Swipe or use the arrow keys to move, double tap to zoom, Esc to close.
 */
export function Lightbox({
  photos,
  index,
  alt,
  onClose,
  onIndexChange,
}: {
  photos: PhotoMeta[];
  index: number;
  alt: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const [zoomState, setZoomState] = useState<{ url: string; scale: number; x: number; y: number } | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef(0);
  const count = photos.length;
  const photo = photos[Math.min(index, count - 1)];
  // Zoom and "loaded" belong to the photo on screen; switching photos resets them.
  const zoom = zoomState && photo && zoomState.url === photo.url ? zoomState : null;
  const loaded = photo ? loadedUrl === photo.url : false;
  const setZoom = (z: { scale: number; x: number; y: number } | null) => setZoomState(z && photo ? { url: photo.url, ...z } : null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < count - 1) onIndexChange(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [index, count, onClose, onIndexChange]);

  // Preload neighbours so swiping feels instant.
  useEffect(() => {
    [index - 1, index + 1].forEach((i) => {
      const p = photos[i];
      if (p) {
        const img = new window.Image();
        img.src = p.url;
      }
    });
  }, [index, photos]);

  if (!photo) return null;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    start.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) moved.current = true;
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (moved.current && !zoom) {
      if (dx < -50 && index < count - 1) onIndexChange(index + 1);
      else if (dx > 50 && index > 0) onIndexChange(index - 1);
      return;
    }
    if (moved.current) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (zoom) setZoom(null);
      else {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setZoom({ scale: 2.5, x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
      }
      return;
    }
    lastTap.current = now;
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`${alt} photos`}>
      <div className="flex items-center justify-between px-3 py-2 text-sm">
        <span className="rounded-full bg-white/10 px-2.5 py-1 font-semibold">
          {index + 1} / {count}
        </span>
        <div className="flex items-center gap-1">
          <a href={photo.url} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center gap-1.5 rounded-full px-3 hover:bg-white/10" title="Open the original file">
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Original</span>
          </a>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close">
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: "pinch-zoom" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {!loaded ? <div className="absolute inset-0 ab-skeleton opacity-30" /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- the original file, exactly as uploaded */}
        <img
          src={photo.url}
          alt={`${alt} (photo ${index + 1})`}
          draggable={false}
          onLoad={() => setLoadedUrl(photo.url)}
          className={cn("max-h-full max-w-full select-none object-contain transition-transform duration-300", zoom ? "cursor-zoom-out" : "cursor-zoom-in")}
          style={zoom ? { transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
        />
        {index > 0 ? (
          <button type="button" onClick={() => onIndexChange(index - 1)} className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/30 md:flex" aria-label="Previous photo">
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}
        {index < count - 1 ? (
          <button type="button" onClick={() => onIndexChange(index + 1)} className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/30 md:flex" aria-label="Next photo">
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 py-2">
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              onClick={() => onIndexChange(i)}
              className={cn("relative h-14 w-14 shrink-0 overflow-hidden rounded-md ring-2", i === index ? "ring-white" : "ring-transparent opacity-60 hover:opacity-100")}
              aria-label={`Photo ${i + 1}`}
            >
              <Image src={p.url} alt="" fill sizes="56px" quality={75} placeholder={p.blur ? "blur" : "empty"} blurDataURL={p.blur ?? undefined} className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
