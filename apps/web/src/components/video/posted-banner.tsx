import { PartyPopper } from "lucide-react";

/** Thank-you after posting a video tour. Stats arrive with the stats step. */
export function PostedBanner({ kind }: { kind: "video" | "photo" }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
      <PartyPopper className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="font-semibold">{kind === "video" ? "Your video tour is live. Nice work!" : "Your listing is live."}</p>
        <p>
          {kind === "video"
            ? "Video tours rank higher in the feed. Views, saves and messages for this post will appear here."
            : "Tip: add a short video tour to rank higher in the feed."}
        </p>
      </div>
    </div>
  );
}
