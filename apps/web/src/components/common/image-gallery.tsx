"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function ImageGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 text-gray-400">
        <ImageOff className="h-10 w-10" />
        <span className="text-sm">No photos yet</span>
      </div>
    );
  }

  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-gray-100">
        <Image src={current} alt={alt} fill priority sizes="(min-width: 1024px) 800px, 100vw" className="object-cover" />
      </div>
      {images.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setActive(index)}
              className={cn(
                "relative h-16 w-20 shrink-0 overflow-hidden rounded-lg ring-2",
                index === active ? "ring-brand-600" : "ring-transparent hover:ring-gray-300",
              )}
              aria-label={`Photo ${index + 1}`}
            >
              <Image src={url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
