import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Cover photo for cards, with a placeholder when there are no photos. */
export function ListingImage({ src, alt, className }: { src?: string | null; alt: string; className?: string }) {
  return (
    <div className={cn("relative aspect-[4/3] w-full overflow-hidden bg-gray-100", className)}>
      {src ? (
        <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gray-300">
          <ImageOff className="h-8 w-8" />
        </div>
      )}
    </div>
  );
}
