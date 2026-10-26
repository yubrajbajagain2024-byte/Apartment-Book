"use client";

/**
 * The content of a root buzz (UniVerse's `body.tsx`): optional title, the text (or its placeholder) and media — up to
 * four photos (1 / 2 / 3 / 4 layouts, tap → the site's full-screen viewer) or one video with controls. Shared by the
 * feed card and the thread page. A placeholder arrives with no title and no media.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Play } from "lucide-react";
import { BUZZ_FEED_COPY, type Buzz, type BuzzMedia } from "@apartment-book/shared";
import { isOptimizableImage } from "@/lib/images";
import { cn } from "@/lib/utils";
import { Lightbox } from "@/components/photos/lightbox";
import { Placeholder } from "./parts";
import { T } from "./ui";

export function BuzzTitle({ title, large, className }: { title: string; large?: boolean; className?: string }) {
  return <h3 className={cn(large ? T.title3 : T.headline, "text-incog-ink [overflow-wrap:anywhere]", className)}>{title}</h3>;
}

/**
 * Title + text. In the feed (`href`) the words open the thread; the text is clamped to 6 lines and long ones get a
 * Show more / Show less toggle (outside the link, so it never opens the thread).
 */
export function BuzzContent({ buzz, clamp, large, href }: { buzz: Buzz; clamp?: boolean; large?: boolean; href?: string }) {
  const [expanded, setExpanded] = useState(false);
  const placeholder = buzz.text === "" && !buzz.title;
  const showText = Boolean(buzz.text) || !buzz.title;
  const long = Boolean(clamp) && buzz.text.length > 320;
  const words = (
    <>
      {buzz.title ? <BuzzTitle title={buzz.title} large={large} /> : null}
      {showText ? (
        placeholder ? (
          <Placeholder item={buzz} />
        ) : (
          <p className={cn(large ? T.bodyLg : T.body, "whitespace-pre-wrap text-incog-ink [overflow-wrap:anywhere]", clamp && !expanded && "line-clamp-6")}>{buzz.text}</p>
        )
      ) : null}
    </>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {href && !placeholder ? (
        <Link href={href} aria-label="Open thread" className="flex flex-col gap-1.5 rounded-[6px] text-left" data-testid="buzz-open-thread">
          {words}
        </Link>
      ) : (
        <div className="flex flex-col gap-1.5">{words}</div>
      )}
      {long ? (
        <button type="button" className={cn("self-start text-incog-accent-ink", T.labelSm)} onClick={() => setExpanded((e) => !e)}>
          {expanded ? BUZZ_FEED_COPY.showLess : BUZZ_FEED_COPY.showMore}
        </button>
      ) : null}
    </div>
  );
}

function aspectOf(m: { width: number | null; height: number | null }, fallback: number): number {
  if (m.width && m.height && m.width > 0 && m.height > 0) return Math.min(1.78, Math.max(0.75, m.width / m.height));
  return fallback;
}

type Photo = Extract<BuzzMedia, { type: "image" }>;
type Video = Extract<BuzzMedia, { type: "video" }>;

function Tile({ photo, index, count, aspect, onOpen, className }: { photo: Photo; index: number; count: number; aspect: number; onOpen(i: number): void; className?: string }) {
  const alt = `Photo ${index + 1} of ${count}`;
  return (
    <button type="button" onClick={() => onOpen(index)} aria-label={alt} className={cn("relative block w-full overflow-hidden bg-incog-surface-2", className)} style={{ aspectRatio: String(aspect) }}>
      {isOptimizableImage(photo.url) ? (
        <Image src={photo.url} alt="" fill sizes="(min-width: 640px) 470px, 100vw" placeholder={photo.blur ? "blur" : "empty"} blurDataURL={photo.blur ?? undefined} className="object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a host next/image does not serve (local previews, drawn fixtures)
        <img src={photo.url} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </button>
  );
}

export function BuzzMediaView({ media, className }: { media: BuzzMedia[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (media.length === 0) return null;
  const video = media.find((m): m is Video => m.type === "video");
  if (video) return <BuzzVideo video={video} className={className} />;

  const photos = media.filter((m): m is Photo => m.type === "image").slice(0, 4);
  const n = photos.length;
  const tile = (i: number, aspect: number, extra?: string) => <Tile key={photos[i].url + i} photo={photos[i]} index={i} count={n} aspect={aspect} onOpen={setOpen} className={extra} />;

  let grid;
  if (n === 1) grid = tile(0, aspectOf(photos[0], 4 / 3));
  else if (n === 2) grid = <div className="grid grid-cols-2 gap-0.5">{[0, 1].map((i) => tile(i, 0.8))}</div>;
  else if (n === 3)
    grid = (
      <div className="grid grid-cols-2 grid-rows-2 gap-0.5">
        {tile(0, 0.5, "row-span-2 h-full")}
        {tile(1, 1)}
        {tile(2, 1)}
      </div>
    );
  else grid = <div className="grid grid-cols-2 gap-0.5">{[0, 1, 2, 3].map((i) => tile(i, 1))}</div>;

  return (
    <>
      {/* Its own gesture: a swipe on the photos never changes the Home tab. */}
      <div data-no-swipe className={cn("overflow-hidden rounded-[20px] bg-incog-surface-2", className)}>
        {grid}
      </div>
      {open !== null ? <Lightbox photos={photos.map((p) => ({ url: p.url, width: p.width, height: p.height, blur: p.blur }))} index={open} alt="Buzz" onClose={() => setOpen(null)} onIndexChange={setOpen} /> : null}
    </>
  );
}

/**
 * One video. Until it is tapped only the poster shows (nothing is fetched from the video host); then native controls,
 * HLS through hls.js where the browser cannot play it itself.
 */
function BuzzVideo({ video, className }: { video: Video; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const aspect = String(aspectOf(video, 16 / 9));
  return (
    <div data-no-swipe className={cn("relative overflow-hidden rounded-[20px] bg-incog-surface-2", className)} style={{ aspectRatio: aspect }}>
      {playing ? (
        <HlsVideo playbackId={video.playbackId} poster={video.posterUrl} />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} aria-label={video.durationSeconds ? `Play video, ${Math.round(video.durationSeconds)} seconds` : "Play video"} className="group absolute inset-0 block">
          {video.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the video host's poster frame
            <img src={video.posterUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
          ) : null}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-transform duration-150 group-hover:scale-105">
              <Play size={24} strokeWidth={2} fill="currentColor" aria-hidden="true" className="ml-0.5" />
            </span>
          </span>
          {video.durationSeconds ? (
            <span className={cn("absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 tabular-nums text-white", T.micro)}>{clockOf(video.durationSeconds)}</span>
          ) : null}
        </button>
      )}
    </div>
  );
}

/** 40 → "0:40", 60 → "1:00". */
function clockOf(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function HlsVideo({ playbackId, poster }: { playbackId: string; poster: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const src = `https://stream.mux.com/${playbackId}.m3u8`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let destroy: (() => void) | null = null;
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      // hls.js wherever Media Source Extensions exist (Chrome says "maybe" to native HLS but cannot play it); the
      // native player only where hls.js is unsupported (iPhone Safari).
      if (Hls.isSupported()) {
        const hls = new Hls({ capLevelToPlayerSize: true });
        hls.loadSource(src);
        hls.attachMedia(el);
        destroy = () => hls.destroy();
      } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = src;
      }
      el.play().catch(() => {});
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [src]);
  return <video ref={ref} controls playsInline poster={poster ?? undefined} aria-label="Video" className="absolute inset-0 size-full bg-incog-surface-2 object-contain" />;
}
