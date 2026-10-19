"use client";

import Image from "next/image";
import { useState } from "react";
import { Expand, ImageOff, Play } from "lucide-react";
import type { FeedMedia, PhotoMeta } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Lightbox } from "./lightbox";
import { PhotoCarousel } from "./photo-carousel";

/** Detail-page gallery: swipeable hero, thumbnail strip, tap for the full-quality viewer. */
export function PhotoHero({ photos, media, alt }: { photos: PhotoMeta[]; media?: FeedMedia[]; alt: string }) {
  const slides: FeedMedia[] = media ?? photos.map((p) => ({ type: "photo", url: p.url, width: p.width, height: p.height, blur: p.blur }));
  const photoSlides = photos.length ? photos : slides.filter((m): m is Extract<FeedMedia, { type: "photo" }> => m.type === "photo").map((m) => ({ url: m.url, width: m.width, height: m.height, blur: m.blur }));
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  if (slides.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 text-gray-400">
        <ImageOff className="h-10 w-10" />
        <span className="text-sm">No photos yet</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <PhotoCarousel
        photos={photos}
        media={slides}
        alt={alt}
        index={index}
        onIndexChange={setIndex}
        onTap={() => {
          if (slides[index]?.type === "photo") setOpen(true);
        }}
        priority
        quality={90}
        sizes="(min-width: 1024px) 800px, 100vw"
        className="aspect-[4/3] rounded-xl md:aspect-[16/10]"
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="absolute bottom-2 right-2 z-20 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/75"
        >
          <Expand className="h-3.5 w-3.5" /> View full size
        </button>
      </PhotoCarousel>

      {slides.length > 1 ? (
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {slides.map((m, i) => (
            <button
              key={m.type === "photo" ? m.url : m.playbackUrl}
              type="button"
              onClick={() => setIndex(i)}
              className={cn("relative h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-black ring-2 transition", i === index ? "ring-brand-600" : "ring-transparent opacity-80 hover:opacity-100 hover:ring-gray-300")}
              aria-label={m.type === "video" ? `Video ${i + 1}` : `Photo ${i + 1}`}
            >
              {m.type === "photo" ? (
                <Image src={m.url} alt="" fill sizes="80px" quality={75} placeholder={m.blur ? "blur" : "empty"} blurDataURL={m.blur ?? undefined} className="object-cover" />
              ) : m.poster ? (
                <Image src={m.poster} alt="" fill sizes="80px" quality={75} unoptimized className="object-cover" />
              ) : null}
              {m.type === "video" ? <span className="absolute inset-0 flex items-center justify-center text-white"><Play className="h-5 w-5 fill-white" /></span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {open ? (
        <Lightbox
          photos={photoSlides}
          index={Math.max(0, photoSlides.findIndex((p) => slides[index]?.type === "photo" && p.url === (slides[index] as { url: string }).url))}
          alt={alt}
          onClose={() => setOpen(false)}
          onIndexChange={(i) => {
            const target = slides.findIndex((m) => m.type === "photo" && m.url === photoSlides[i]?.url);
            if (target >= 0) setIndex(target);
          }}
        />
      ) : null}
    </div>
  );
}
