import { ImageOff, Play } from "lucide-react";
import { adCtaLabel, mediaItems, type Json } from "@apartment-book/shared";
import { safeHttpUrl } from "@/lib/utils";
import { placementLabel } from "./parts";

/**
 * What students would see of an ad in one placement: the business, the headline and caption, the first photo (a
 * video's poster) and the button. A plain <img>, as the admin app's moderation previews: the review sees the file
 * itself.
 */
export function CreativePreview({ placement, businessName, headline, caption, cta, media, promotedTitle }: {
  placement: string;
  businessName: string;
  headline: string | null;
  caption: string;
  cta: string;
  media: Json;
  promotedTitle: string | null;
}) {
  const first = mediaItems(media)[0];
  const src = safeHttpUrl(first?.type === "image" ? first.url : first?.type === "video" ? first.poster_url : null);
  return (
    <figure className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-gray-500">
        <span>{placementLabel(placement)}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">Sponsored</span>
      </figcaption>
      <div className="relative flex aspect-[4/3] items-center justify-center bg-gray-100">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs text-gray-500">
            <ImageOff className="h-5 w-5" aria-hidden />
            {promotedTitle ? `Shows “${promotedTitle}”` : "No photo yet"}
          </span>
        )}
        {first?.type === "video" ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <Play className="h-8 w-8 rounded-full bg-black/60 p-2 text-white" aria-label="Video" />
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 p-3 text-sm">
        <p className="font-semibold text-gray-900">{businessName}</p>
        {headline ? <p className="font-medium text-gray-900">{headline}</p> : null}
        {caption ? <p className="line-clamp-4 whitespace-pre-wrap text-gray-700">{caption}</p> : null}
        <span className="mt-1 self-start rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">{adCtaLabel(cta)}</span>
      </div>
    </figure>
  );
}
