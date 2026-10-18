import { PartyPopper } from "lucide-react";
import type { ListingStats } from "@apartment-book/shared";
import { ListingStatsPanel } from "@/components/stats/listing-stats-panel";

/** Thank-you after posting, with the post's live numbers. */
export function PostedBanner({ kind, stats }: { kind: "video" | "photo"; stats?: ListingStats | null }) {
  return (
    <div className="flex flex-col gap-4 rounded-[14px] bg-white px-4 py-4 text-sm text-gray-600 shadow-card ring-1 ring-gray-200">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent ring-1 ring-gray-200">
          <PartyPopper className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-display text-lg leading-tight tracking-tight text-gray-900">{kind === "video" ? "Your video tour is live. Nice work!" : "Your listing is live."}</p>
          <p className="leading-relaxed">{kind === "video" ? "Video tours rank higher in the feed. Here is how this post is doing; come back any time to check." : "Tip: add a short video tour to rank higher in the feed."}</p>
        </div>
      </div>
      {stats ? <ListingStatsPanel stats={stats} title="Right now" /> : null}
    </div>
  );
}
