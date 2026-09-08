"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import type { FeedMedia, PhotoMeta } from "@apartment-book/shared";
import { VideoPlayer } from "./video-player";
import { cn } from "@/lib/utils";

export type PhotoCarouselProps = {
  photos: PhotoMeta[];
  /** Mixed photos and videos; when given, `photos` is ignored for rendering. */
  media?: FeedMedia[];
  alt: string;
  /** CSS aspect ratio of the frame ("4 / 3"). Omit to control it with className. */
  aspect?: string;
  sizes?: string;
  quality?: number;
  priority?: boolean;
  /** Navigate here when the photo is tapped (a swipe never navigates). */
  href?: string;
  /** Called on a single tap when there is no href. */
  onTap?: () => void;
  /** Double tap / double click (like Instagram). On touch, single-tap navigation waits briefly to detect it. */
  onDoubleTap?: () => void;
  index?: number;
  onIndexChange?: (index: number) => void;
  fit?: "cover" | "contain";
  showCounter?: boolean;
  showDots?: boolean;
  className?: string;
  children?: ReactNode;
};

const SWIPE_PX = 40;
const DOUBLE_TAP_MS = 280;

export function PhotoCarousel({
  photos,
  media,
  alt,
  aspect,
  sizes = "100vw",
  quality = 85,
  priority,
  href,
  onTap,
  onDoubleTap,
  index: controlledIndex,
  onIndexChange,
  fit = "cover",
  showCounter = true,
  showDots = true,
  className,
  children,
}: PhotoCarouselProps) {
  const router = useRouter();
  const [internalIndex, setInternalIndex] = useState(0);
  const slides: FeedMedia[] = media ?? photos.map((p) => ({ type: "photo", url: p.url, width: p.width, height: p.height, blur: p.blur }));
  const count = slides.length;
  // Clamp against the slides actually rendered (not the photos prop, which may be empty when media is given).
  const index = Math.min(controlledIndex ?? internalIndex, Math.max(0, count - 1));
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; time: number; pointerType: string } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (href) router.prefetch(href);
  }, [href, router]);

  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  function go(next: number) {
    const clamped = Math.max(0, Math.min(count - 1, next));
    if (controlledIndex === undefined) setInternalIndex(clamped);
    onIndexChange?.(clamped);
  }

  function activate() {
    if (href) router.push(href);
    else onTap?.();
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, time: Date.now(), pointerType: e.pointerType };
    moved.current = false;
    setDragging(true);
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (!moved.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) moved.current = true;
    if (moved.current && count > 1) {
      // Resist dragging past the ends.
      const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
      setDrag(atEdge ? dx / 3 : dx);
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s) return;
    const dx = e.clientX - s.x;
    const elapsed = Date.now() - s.time;
    setDrag(0);

    if (moved.current && count > 1) {
      const velocity = Math.abs(dx) / Math.max(elapsed, 1);
      if (dx < -SWIPE_PX || (dx < -12 && velocity > 0.5)) go(index + 1);
      else if (dx > SWIPE_PX || (dx > 12 && velocity > 0.5)) go(index - 1);
      return;
    }
    if (moved.current) return;

    // A tap. Detect double taps when a handler is provided.
    const now = Date.now();
    if (onDoubleTap && now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      onDoubleTap();
      return;
    }
    lastTap.current = now;
    if (onDoubleTap && s.pointerType === "touch") {
      // Wait a moment so a second tap can cancel the navigation.
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        activate();
      }, DOUBLE_TAP_MS);
    } else if (onDoubleTap && s.pointerType === "mouse") {
      // Mouse: single click navigates immediately; double click still fires the handler.
      activate();
    } else {
      activate();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === "Enter" && (href || onTap)) {
      e.preventDefault();
      activate();
    }
  }

  if (count === 0) {
    return (
      <div className={cn("relative flex w-full items-center justify-center overflow-hidden bg-gray-100 text-gray-300", className)} style={aspect ? { aspectRatio: aspect } : undefined}>
        <ImageOff className="h-10 w-10" />
        {children}
      </div>
    );
  }

  return (
    <div
      ref={frameRef}
      className={cn("group/carousel relative w-full select-none overflow-hidden bg-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-500", (href || onTap) && "cursor-pointer", className)}
      style={{ ...(aspect ? { aspectRatio: aspect } : {}), touchAction: "pan-y" }}
      role={href || onTap ? "link" : "group"}
      tabIndex={0}
      aria-label={alt}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
        setDrag(0);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="flex h-full w-full"
        style={{
          transform: `translateX(calc(${-index * 100}% + ${drag}px))`,
          transition: dragging ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {slides.map((slide, i) => (
          <div key={slide.type === "photo" ? slide.url : slide.playbackUrl} className="relative h-full w-full shrink-0">
            {slide.type === "video" ? (
              <VideoPlayer src={slide.playbackUrl} poster={slide.poster} />
            ) : (
              <Image
                src={slide.url}
                alt={i === 0 ? alt : `${alt} (photo ${i + 1})`}
                fill
                sizes={sizes}
                quality={quality}
                priority={priority && i === 0}
                loading={priority && i === 0 ? undefined : Math.abs(i - index) <= 1 ? "eager" : "lazy"}
                placeholder={slide.blur ? "blur" : "empty"}
                blurDataURL={slide.blur ?? undefined}
                draggable={false}
                className={cn("pointer-events-none", fit === "cover" ? "object-cover" : "object-contain")}
              />
            )}
          </div>
        ))}
      </div>

      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              go(index - 1);
            }}
            className={cn("absolute left-2 top-1/2 z-20 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow transition-opacity hover:bg-white md:flex", index === 0 ? "opacity-0 pointer-events-none" : "opacity-0 group-hover/carousel:opacity-100 focus-visible:opacity-100")}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              go(index + 1);
            }}
            className={cn("absolute right-2 top-1/2 z-20 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow transition-opacity hover:bg-white md:flex", index === count - 1 ? "opacity-0 pointer-events-none" : "opacity-0 group-hover/carousel:opacity-100 focus-visible:opacity-100")}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          {showCounter ? (
            <span className="pointer-events-none absolute right-2 top-2 z-20 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
              {index + 1}/{count}
            </span>
          ) : null}
          {showDots ? (
            <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 gap-1" role="tablist" aria-label="Choose photo">
              {slides.slice(0, 12).map((slide, i) => (
                <button
                  key={slide.type === "photo" ? slide.url : slide.playbackUrl}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`Go to ${slide.type === "video" ? "video" : "photo"} ${i + 1}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    go(i);
                  }}
                  className="flex h-4 items-center px-0.5"
                >
                  <span className={cn("block h-1.5 rounded-full shadow transition-all", i === index ? "w-4 bg-white" : "w-1.5 bg-white/60")} />
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {children}
    </div>
  );
}
