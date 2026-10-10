import Image from "next/image";
import { isOptimizableImage } from "@/lib/images";
import { cn } from "@/lib/utils";

/**
 * A cover picture filling its box (the box must be `relative`): next/image for the hosts it serves, a plain <img> for
 * anything else. Decorative: the link around it carries the name.
 */
export function TileImage({ src, sizes, eager, className }: { src: string; sizes: string; eager?: boolean; className?: string }) {
  const loading = eager ? "eager" : "lazy";
  return isOptimizableImage(src) ? (
    <Image src={src} alt="" fill sizes={sizes} loading={loading} className={cn("object-cover", className)} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- a host next/image does not serve (see lib/images.ts)
    <img src={src} alt="" loading={loading} decoding="async" referrerPolicy="no-referrer" className={cn("absolute inset-0 h-full w-full object-cover", className)} />
  );
}
