"use client";

import Image from "next/image";
import { useState } from "react";
import { Expand, ImageOff } from "lucide-react";
import type { PhotoMeta } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Lightbox } from "./lightbox";
import { PhotoCarousel } from "./photo-carousel";

/** Detail-page gallery: swipeable hero, thumbnail strip, tap for the full-quality viewer. */
export function PhotoHero({ photos, alt }: { photos: PhotoMeta[]; alt: string }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  if (photos.length === 0) {
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
        alt={alt}
        index={index}
        onIndexChange={setIndex}
        onTap={() => setOpen(true)}
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

      {photos.length > 1 ? (
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              onClick={() => setIndex(i)}
              className={cn("relative h-16 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition", i === index ? "ring-brand-600" : "ring-transparent opacity-80 hover:opacity-100 hover:ring-gray-300")}
              aria-label={`Photo ${i + 1}`}
            >
              <Image src={p.url} alt="" fill sizes="80px" quality={75} placeholder={p.blur ? "blur" : "empty"} blurDataURL={p.blur ?? undefined} className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}

      {open ? <Lightbox photos={photos} index={index} alt={alt} onClose={() => setOpen(false)} onIndexChange={setIndex} /> : null}
    </div>
  );
}
