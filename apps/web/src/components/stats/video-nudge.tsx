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
    <div className="flex items-start gap-3 rounded-xl border border-accent-500/40 bg-accent-100 px-4 py-3 text-sm text-gray-800">
      <Video className="mt-0.5 h-5 w-5 shrink-0 text-accent-600" />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">Add a 30-second tour.</p>
        <p>
          {multiplier !== null && multiplier > 1
            ? `On Apartment Book, listings with a video tour get about ${multiplier}× more messages than photo-only listings (based on ${comparison?.videoListings} video and ${comparison?.photoListings} photo listings).`
            : "Video tours rank higher in the feed and let students see the place before they message you."}
        </p>
        <Link href={editHref} className="w-fit font-semibold text-accent-600 hover:underline">
          Record or upload a tour
        </Link>
      </div>
    </div>
  );
}
