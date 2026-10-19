import { PartyPopper } from "lucide-react";
import type { ListingStats } from "@apartment-book/shared";
import { ListingStatsPanel } from "@/components/stats/listing-stats-panel";

/** Thank-you after posting, with the post's live numbers. */
export function PostedBanner({ kind, stats }: { kind: "video" | "photo"; stats?: ListingStats | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
      <div className="flex items-start gap-3">
        <PartyPopper className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">{kind === "video" ? "Your video tour is live. Nice work!" : "Your listing is live."}</p>
          <p>{kind === "video" ? "Video tours rank higher in the feed. Here is how this post is doing; come back any time to check." : "Tip: add a short video tour to rank higher in the feed."}</p>
        </div>
      </div>
      {stats ? <ListingStatsPanel stats={stats} title="Right now" /> : null}
    </div>
  );
}
