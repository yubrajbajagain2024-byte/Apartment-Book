import Link from "next/link";
import { Video } from "lucide-react";
import type { VideoVsPhotoStats } from "@apartment-book/shared";

/**
 * Shown to the owner of a photo-only apartment listing. The comparison number
 * comes from our own data and is left out until there is enough of it.
 */
export function VideoNudge({ editHref, comparison }: { editHref: string; comparison: VideoVsPhotoStats | null }) {
  const multiplier = comparison?.contactMultiplier ?? null;
  return (
    <div className="flex items-start gap-3 rounded-[14px] bg-white px-4 py-3.5 text-sm text-gray-600 shadow-card ring-1 ring-gray-200">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent ring-1 ring-gray-200">
        <Video className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg leading-tight tracking-tight text-gray-900">Add a 30-second tour.</p>
        <p className="leading-relaxed">
          {multiplier !== null && multiplier > 1
            ? `On CampConnect, listings with a video tour get about ${multiplier}× more messages than photo-only listings (based on ${comparison?.videoListings} video and ${comparison?.photoListings} photo listings).`
            : "Video tours rank higher in the feed and let students see the place before they message you."}
        </p>
        <Link href={editHref} className="mt-1 w-fit text-sm font-semibold text-gray-900 underline-offset-4 hover:underline">
          Record or upload a tour
        </Link>
      </div>
    </div>
  );
}
