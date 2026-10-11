"use client";

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, ImageOff, VideoOff, X } from "lucide-react";
import type { MessageAttachment } from "@apartment-book/shared";
import { formatMessageTime } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { useStableSource, type SignedFile, type SignedFiles } from "./signed-media";

const FOCUSABLE = 'a[href], button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

type ViewerProps = {
  /** The photos and videos of one message. */
  items: MessageAttachment[];
  index: number;
  signed: SignedFiles;
  /** Who sent them and when (an ISO time), for the title bar. */
  senderName: string;
  sentAt: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

/**
 * Full-screen viewer for a message's photos and videos: arrows, the arrow keys or a swipe move between them, Escape
 * closes, and "Original" opens the file itself in a new tab. Rendered on the body, so neither the chat dock nor the
 * Messages page can clip it or sit above it.
 */
export function MediaViewer(props: ViewerProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<Viewer {...props} />, document.body);
}

function Viewer({ items, index, signed, senderName, sentAt, onIndexChange, onClose }: ViewerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const count = items.length;
  const current = Math.min(Math.max(index, 0), count - 1);
  const item = items[current];
  const file = item ? signed[item.path] : undefined;

  // Focus moves to Close and goes back to the tile when the viewer closes; the page behind does not scroll.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);

  // Escape closes the viewer and nothing else. The arrow keys move, except on a focused video, where they seek.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.target instanceof HTMLVideoElement || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight" && current < count - 1) {
        e.preventDefault();
        onIndexChange(current + 1);
      } else if (e.key === "ArrowLeft" && current > 0) {
        e.preventDefault();
        onIndexChange(current - 1);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current, count, onClose, onIndexChange]);

  if (!item) return null;

  /** Keys stay in the viewer (the page's shortcuts are behind it), and Tab cycles inside it. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && active !== panelRef.current && panelRef.current.contains(active);
    if (e.shiftKey && (!inside || active === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || active === last)) {
      e.preventDefault();
      first.focus();
    }
  }

  // A sideways swipe moves; one that starts on a video's controls is left to the video.
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    swipe.current = e.target instanceof Element && e.target.closest("video, button, a") ? null : { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.clientY - start.y)) return;
    if (dx < 0 && current < count - 1) onIndexChange(current + 1);
    else if (dx > 0 && current > 0) onIndexChange(current - 1);
  }

  const what = item.kind === "video" ? "Video" : "Photo";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={count > 1 ? `${what} ${current + 1} of ${count}` : what}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white focus:outline-none"
      data-testid="media-viewer"
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        {count > 1 ? (
          <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 font-semibold tabular-nums">
            {current + 1} / {count}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-white/80" title={item.name}>
          <span className="font-semibold text-white">{senderName}</span> · {formatMessageTime(sentAt)}
        </span>
        {file?.url ? (
          <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 hover:bg-white/10" title="Open the original file in a new tab">
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Original</span>
            <span className="sr-only sm:hidden">Open the original file</span>
          </a>
        ) : null}
        <button ref={closeRef} type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 touch-pan-y touch-pinch-zoom items-center justify-center overflow-hidden px-2 pb-4 md:px-16"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {/* Keyed by position and file, so moving starts the next one fresh (a video stops, a photo shows its own spinner). */}
        <ViewerMedia key={`${current}:${item.path}`} item={item} file={file} />
        {current > 0 ? (
          <button type="button" onClick={() => onIndexChange(current - 1)} className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 ring-1 ring-white/20 hover:bg-white/30 md:left-3 md:h-11 md:w-11 md:bg-white/15 md:ring-0" aria-label="Previous">
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}
        {current < count - 1 ? (
          <button type="button" onClick={() => onIndexChange(current + 1)} className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 ring-1 ring-white/20 hover:bg-white/30 md:right-3 md:h-11 md:w-11 md:bg-white/15 md:ring-0" aria-label="Next">
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ViewerMedia({ item, file }: { item: MessageAttachment; file: SignedFile | undefined }) {
  const source = useStableSource(item.path, file);
  /** Where a video was when its address ran out mid-play, to carry on from there on the new one. */
  const resumeAt = useRef(0);

  if (source.broken) return <Unavailable item={item} url={file?.url ?? null} />;
  if (!source.src) return file && !file.url ? <Unavailable item={item} url={null} /> : <Spinner className="h-8 w-8 text-white/70" />;
  if (source.waiting) return <Spinner className="h-8 w-8 text-white/70" />;

  if (item.kind === "video") {
    return (
      <video
        src={source.src}
        controls
        autoPlay
        playsInline
        aria-label={item.name}
        onLoadedMetadata={(e) => {
          source.onLoad();
          if (resumeAt.current > 0) {
            e.currentTarget.currentTime = resumeAt.current;
            resumeAt.current = 0;
          }
        }}
        onError={(e) => {
          resumeAt.current = e.currentTarget.currentTime;
          source.onError();
        }}
        className="max-h-full max-w-full bg-black"
      />
    );
  }
  return (
    <>
      {!source.loaded ? <Spinner className="absolute h-8 w-8 text-white/70" /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind a short-lived signed URL: next/image would cache it past its expiry */}
      <img src={source.src} alt={item.name} draggable={false} onLoad={source.onLoad} onError={source.onError} className="max-h-full max-w-full select-none object-contain" />
    </>
  );
}

function Unavailable({ item, url }: { item: MessageAttachment; url: string | null }) {
  const what = item.kind === "video" ? "video" : "photo";
  return (
    <div className="flex max-w-xs flex-col items-center gap-3 text-center text-sm text-white/80">
      {item.kind === "video" ? <VideoOff className="h-10 w-10" /> : <ImageOff className="h-10 w-10" />}
      <p>{url ? `This ${what} can't be shown in this browser.` : `This ${what} couldn't be loaded. Try again in a moment.`}</p>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/15 px-4 py-2 font-semibold text-white hover:bg-white/25">
          Open the original
        </a>
      ) : null}
    </div>
  );
}
