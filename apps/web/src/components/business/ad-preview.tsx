import { BadgeCheck, ChevronRight, Heart, MessageCircle, MoreHorizontal, Bookmark, Send, Play } from "lucide-react";
import { adCtaLabel, type AdPlacement, type BusinessMediaItem } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

/** What the preview needs of an ad, however it got there (the editor's form, a saved ad, the review queue). */
export type PreviewAd = {
  businessName: string;
  logoUrl: string | null;
  verified: boolean;
  headline: string | null;
  caption: string;
  cta: string;
  media: BusinessMediaItem[];
  /** A promoted listing's or post's picture and title, standing in when the ad has no media of its own. */
  promoted?: { title: string; image: string | null; price?: string | null } | null;
};

function cover(ad: PreviewAd): { src: string | null; video: boolean } {
  const first = ad.media[0];
  if (first?.type === "image") return { src: first.url, video: false };
  if (first?.type === "video") return { src: first.poster_url ?? null, video: true };
  return { src: ad.promoted?.image ?? null, video: false };
}

function Picture({ ad, className }: { ad: PreviewAd; className?: string }) {
  const c = cover(ad);
  return (
    <div className={cn("relative overflow-hidden bg-[#f0f2f5]", className)}>
      {c.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a preview of what the business uploaded, any host the uploader used
        <img src={c.src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[13px] text-[#8a8d91]">Your photo or video</div>
      )}
      {c.video ? (
        <span className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur">
          <Play className="h-4 w-4 fill-current" />
        </span>
      ) : null}
    </div>
  );
}

function SponsoredHeader({ ad, dark = false }: { ad: PreviewAd; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={ad.businessName} src={ad.logoUrl} size="sm" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn("flex items-center gap-1 truncate text-[13px] font-semibold", dark ? "text-white" : "text-[#1c1e21]")}>
          {ad.businessName}
          {ad.verified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[#2b7de9]" aria-label="Verified Partner" /> : null}
        </span>
        <span className={cn("block text-[11px]", dark ? "text-white/80" : "text-[#65676b]")}>Sponsored</span>
      </span>
      <MoreHorizontal className={cn("h-5 w-5", dark ? "text-white" : "text-[#65676b]")} aria-hidden="true" />
    </div>
  );
}

/**
 * The ad as a student meets it: a post in For You (labelled Sponsored, the button under the picture), a full-screen
 * reel, or a listing card in Housing. Drawn in the student app's light look whatever the portal's theme: literal colours, which the dark portal's remapping of greys and white does not touch.
 */
export function AdPreview({ ad, placement }: { ad: PreviewAd; placement: AdPlacement }) {
  const label = adCtaLabel(ad.cta);
  if (placement === "reels") {
    return (
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-[28px] bg-black shadow-biz-lift ring-1 ring-black/10" data-testid="ad-preview-reels">
        <Picture ad={ad} className="absolute inset-0 bg-neutral-900" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2.5 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-4 pt-16">
          <SponsoredHeader ad={ad} dark />
          {ad.headline ? <p className="text-[13px] font-semibold text-white">{ad.headline}</p> : null}
          {ad.caption ? <p className="line-clamp-2 text-[12px] leading-snug text-white/90">{ad.caption}</p> : null}
          <span className="flex h-9 items-center justify-between rounded-xl bg-[#fff]/95 px-3 text-[13px] font-semibold text-[#1c1e21]">
            {label} <ChevronRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    );
  }
  if (placement === "housing") {
    return (
      <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl bg-[#fff] shadow-biz ring-1 ring-black/5" data-testid="ad-preview-housing">
        <div className="p-3">
          <SponsoredHeader ad={ad} />
        </div>
        <Picture ad={ad} className="aspect-[4/3]" />
        <div className="flex flex-col gap-1 p-3">
          <p className="text-[15px] font-semibold text-[#1c1e21]">{ad.headline || ad.promoted?.title || "Your headline"}</p>
          {ad.promoted?.price ? <p className="text-[13px] font-semibold text-[#1c1e21]">{ad.promoted.price}</p> : null}
          {ad.caption ? <p className="line-clamp-2 text-[13px] text-[#4b4f56]">{ad.caption}</p> : null}
          <span className="mt-2 flex h-9 items-center justify-center rounded-lg bg-[#166fe5] text-[13px] font-semibold text-white">{label}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl bg-[#fff] shadow-biz ring-1 ring-black/5" data-testid="ad-preview-for-you">
      <div className="p-3">
        <SponsoredHeader ad={ad} />
      </div>
      <Picture ad={ad} className="aspect-[4/5]" />
      <span className="flex h-11 items-center justify-between border-b border-[#eef0f2] px-3 text-[13px] font-semibold text-[#166fe5]">
        {label} <ChevronRight className="h-4 w-4" />
      </span>
      <div className="flex items-center gap-4 px-3 pt-2.5 text-[#1c1e21]" aria-hidden="true">
        <Heart className="h-6 w-6" />
        <MessageCircle className="h-6 w-6" />
        <Send className="h-6 w-6" />
        <Bookmark className="ml-auto h-6 w-6" />
      </div>
      <p className="px-3 pb-3.5 pt-2 text-[13px] leading-snug text-[#1c1e21]">
        <span className="font-semibold">{ad.businessName}</span> {ad.headline ? <span className="font-semibold">{ad.headline} · </span> : null}
        {ad.caption || <span className="text-[#8a8d91]">Your caption</span>}
      </p>
    </div>
  );
}
