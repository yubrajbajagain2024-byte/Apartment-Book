"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, Bookmark, ChevronRight, EyeOff, Flag, Info, MoreHorizontal, Ban } from "lucide-react";
import {
  BUSINESS_REPORT_REASONS,
  adCtaLabel,
  adDestination,
  formatPrice,
  mediaCover,
  muxPlaybackUrl,
  muxPosterUrl,
  recordBusinessEvent,
  type AdPlacement,
  type BusinessReportReason,
  type FeedAd,
} from "@apartment-book/shared";
import { hideAdAction, reportBusinessAction, saveAdAction, setBusinessBlockedAction, startBusinessChatAction } from "@/lib/actions/ads";
import { isOptimizableImage } from "@/lib/images";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { ReelVideo } from "@/components/home/reel-card";

/*
 * Ads as students meet them: a post, a reel or a listing like any other, labelled Sponsored, with the business's name
 * and its button. What a student does with one is counted (seen half on screen for a second, a tap on the button, a
 * save, a visit to the profile, a message) once per person per hour or day, and the business only ever gets the
 * numbers. The "…" menu hides the ad, reports it, blocks the business, or says why it is there.
 */

/** Counts an impression once the ad has been at least half on screen for a second (once per card). */
function useImpression(ad: FeedAd, placement: AdPlacement) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          timer = setTimeout(() => {
            void recordBusinessEvent(createClient(), "impression", { adId: ad.id, placement });
            observer.disconnect();
          }, 1000);
        } else if (timer) clearTimeout(timer);
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [ad.id, placement]);
  return ref;
}

function click(ad: FeedAd, placement: AdPlacement) {
  void recordBusinessEvent(createClient(), "click", { adId: ad.id, placement });
}

/**
 * The pictures an ad shows: its own, or the listing's or post's it promotes. Only those next/image serves (this
 * project's storage, the video provider's posters): the image is fetched by our server, so no business learns which
 * student looked at its ad from its own server's logs.
 */
function adPictures(ad: FeedAd): string[] {
  const own = ad.media.flatMap((m) => (m.type === "image" ? [m.url] : []));
  const all = own.length ? own : ad.promoted?.type === "apartment" ? ad.promoted.images : ad.promoted?.type === "deal" ? ad.promoted.media.flatMap((m) => (m.type === "image" ? [m.url] : [])) : [];
  return all.filter(isOptimizableImage);
}

function adVideo(ad: FeedAd) {
  const v = ad.media.find((m) => m.type === "video");
  return v && v.type === "video" && v.playback_id ? v : null;
}

/** The ad's button: a link out (opened in a new tab), the listing, the post, a chat the student starts, or the profile. */
export function AdButton({ ad, placement, className, dark = false }: { ad: FeedAd; placement: AdPlacement; className?: string; dark?: boolean }) {
  const dest = adDestination(ad);
  const label = adCtaLabel(ad.cta);
  const classes = cn("flex items-center justify-between gap-2 font-semibold transition-colors", className);
  if (dest.kind === "message") {
    return (
      <form action={startBusinessChatAction} onSubmit={() => click(ad, placement)}>
        <input type="hidden" name="targetType" value="ad" />
        <input type="hidden" name="targetId" value={ad.id} />
        <input type="hidden" name="back" value="/" />
        <button type="submit" className={cn(classes, "w-full")}>
          {label} <ChevronRight className="h-4 w-4" />
        </button>
      </form>
    );
  }
  const href =
    dest.kind === "url" ? dest.url : dest.kind === "listing" ? `/apartments/${dest.id}` : dest.kind === "post" ? `/businesses/${dest.businessId}?post=${dest.id}&ad=${ad.id}` : `/businesses/${dest.businessId}?ad=${ad.id}`;
  return dest.kind === "url" ? (
    <a href={href} target="_blank" rel="noopener noreferrer sponsored" onClick={() => click(ad, placement)} className={classes}>
      {label} <ChevronRight className={cn("h-4 w-4", dark && "text-white")} />
    </a>
  ) : (
    <Link href={href} onClick={() => click(ad, placement)} className={classes}>
      {label} <ChevronRight className="h-4 w-4" />
    </Link>
  );
}

/** "…": hide, report, block, and why this ad is here. After any of the first three the card steps aside. */
function AdMenu({ ad, onGone, dark = false }: { ad: FeedAd; onGone: (message: string) => void; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "report" | "why">("menu");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<{ error?: string }>, message: string) =>
    start(async () => {
      const result = await work();
      if (result.error) setError(result.error);
      else {
        setOpen(false);
        onGone(message);
      }
    });
  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100";
  return (
    <div className="relative">
      <button type="button" aria-label="Ad options" aria-expanded={open} onClick={() => { setOpen((o) => !o); setView("menu"); setError(null); }} className={cn("flex h-9 w-9 items-center justify-center rounded-full", dark ? "text-white hover:bg-white/15" : "text-gray-600 hover:bg-gray-100")}>
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open ? (
        <div role="menu" className="ab-menu-in absolute right-0 top-full z-30 mt-1 w-72 origin-top-right rounded-xl bg-white p-1.5 text-left shadow-lg ring-1 ring-gray-200">
          {error ? <p className="px-3 py-2 text-sm text-red-600">{error}</p> : null}
          {view === "menu" ? (
            <>
              <button type="button" role="menuitem" disabled={pending} onClick={() => run(() => hideAdAction(ad.id), "Ad hidden. You won't see it again.")} className={row}>
                <EyeOff className="h-4 w-4" /> Hide ad
              </button>
              <button type="button" role="menuitem" onClick={() => setView("report")} className={row}>
                <Flag className="h-4 w-4" /> Report ad
              </button>
              <button type="button" role="menuitem" disabled={pending} onClick={() => run(() => setBusinessBlockedAction(ad.business_id, true), `${ad.business_name} is blocked. Its ads and posts won't show to you.`)} className={row}>
                <Ban className="h-4 w-4" /> Block {ad.business_name}
              </button>
              <button type="button" role="menuitem" onClick={() => setView("why")} className={row}>
                <Info className="h-4 w-4" /> Why am I seeing this?
              </button>
            </>
          ) : view === "report" ? (
            <div className="flex flex-col">
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Why are you reporting it?</p>
              {BUSINESS_REPORT_REASONS.map((r) => (
                <button key={r.value} type="button" role="menuitem" disabled={pending} onClick={() => run(() => reportBusinessAction({ adId: ad.id }, r.value as BusinessReportReason), "Thanks. The UniBuzz team will look at it, and you won't see this ad again.")} className={row}>
                  {r.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-2.5 text-sm leading-relaxed text-gray-700">
              {ad.business_name} chose to reach students at your campus, and this ad was approved and paid for. That is all: UniBuzz never uses your age, gender, interests or what you do in the app to choose ads.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Header({ ad, menu, dark = false }: { ad: FeedAd; menu: React.ReactNode; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Link href={`/businesses/${ad.business_id}?ad=${ad.id}`} className="shrink-0">
        <Avatar name={ad.business_name} src={ad.business_logo_url} size="sm" />
      </Link>
      <span className="min-w-0 flex-1 leading-tight">
        <Link href={`/businesses/${ad.business_id}?ad=${ad.id}`} className={cn("flex items-center gap-1 truncate text-sm font-semibold hover:underline", dark ? "text-white" : "text-gray-900")}>
          {ad.business_name}
          {ad.verified_partner ? <BadgeCheck className={cn("h-4 w-4 shrink-0", dark ? "text-brand-200" : "text-brand-600")} aria-label="Verified Partner" /> : null}
        </Link>
        <span className={cn("block text-xs", dark ? "text-white/80" : "text-gray-500")} data-testid="sponsored-label">
          Sponsored
        </span>
      </span>
      {menu}
    </div>
  );
}

function Gone({ message }: { message: string }) {
  return <p className="rounded-xl bg-white px-4 py-5 text-center text-sm text-gray-600 shadow-sm ring-1 ring-gray-200 sm:rounded-xl">{message}</p>;
}

function SaveButton({ ad }: { ad: FeedAd }) {
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Saved" : "Save"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const next = !saved;
          setSaved(next);
          const result = await saveAdAction(ad.id, next);
          if (result.error) setSaved(!next);
        })
      }
      className="flex h-9 w-9 items-center justify-center rounded-full text-gray-900 hover:bg-gray-100"
    >
      <Bookmark className={cn("h-6 w-6", saved && "fill-current")} />
    </button>
  );
}

/** For You: an ad that reads like a post, Sponsored under the business's name, its button under the picture. */
export function SponsoredPost({ ad }: { ad: FeedAd }) {
  const ref = useImpression(ad, "for_you");
  const [gone, setGone] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const video = adVideo(ad);
  const pictures = adPictures(ad);
  useEffect(() => {
    const el = ref.current;
    if (!el || !video) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, video]);
  if (gone) return <Gone message={gone} />;
  return (
    <article ref={ref} aria-label={`Sponsored by ${ad.business_name}`} className="bg-white sm:overflow-hidden sm:rounded-xl sm:shadow-sm sm:ring-1 sm:ring-gray-200" data-testid="sponsored-post">
      <div className="px-3 py-2.5">
        <Header ad={ad} menu={<AdMenu ad={ad} onGone={setGone} />} />
      </div>
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gray-100">
        {video ? (
          <ReelVideo src={muxPlaybackUrl(video.playback_id!)} poster={muxPosterUrl(video.playback_id!)} active={inView} near eager={false} />
        ) : pictures[0] ? (
          <Image src={pictures[0]} alt="" fill sizes="(min-width: 640px) 640px, 100vw" className="object-cover" />
        ) : null}
      </div>
      <AdButton ad={ad} placement="for_you" className="h-11 border-b border-gray-100 px-3 text-sm text-brand-600 hover:bg-gray-50" />
      <div className="flex items-center justify-end px-1.5 pt-1">
        <SaveButton ad={ad} />
      </div>
      <p className="whitespace-pre-line px-3 pb-3.5 text-sm leading-snug text-gray-900">
        <span className="font-semibold">{ad.business_name}</span> {ad.headline ? <span className="font-semibold">{ad.headline} · </span> : null}
        {ad.caption}
      </p>
    </article>
  );
}

/** Housing: an ad that reads like a listing (a tile in the grid when compact), its listing's rent and photos when it promotes one. */
export function SponsoredListing({ ad, compact = false }: { ad: FeedAd; compact?: boolean }) {
  const ref = useImpression(ad, "housing");
  const [gone, setGone] = useState<string | null>(null);
  if (gone) return <Gone message={gone} />;
  const pictures = adPictures(ad);
  const listing = ad.promoted?.type === "apartment" ? ad.promoted : null;
  return (
    <article ref={ref} aria-label={`Sponsored by ${ad.business_name}`} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200" data-testid="sponsored-listing">
      <div className="px-3 py-2.5">
        <Header ad={ad} menu={<AdMenu ad={ad} onGone={setGone} />} />
      </div>
      <div className={cn("relative w-full overflow-hidden bg-gray-100", compact ? "aspect-[4/5]" : "aspect-[4/3]")}>
        {pictures[0] ? (
          <Image src={pictures[0]} alt="" fill sizes="(min-width: 640px) 320px, 50vw" className="object-cover" />
        ) : null}
      </div>
      <div className={cn("flex flex-col gap-1", compact ? "p-2.5" : "p-3")}>
        <p className={cn("font-semibold text-gray-900", compact ? "line-clamp-2 text-sm" : "text-base")}>{ad.headline || listing?.title || ad.business_name}</p>
        {listing ? (
          <p className="text-sm font-semibold text-gray-900">
            {formatPrice(listing.price, listing.currency)}/mo · {listing.bedrooms} bd · {listing.bathrooms} ba{listing.city ? ` · ${listing.city}` : ""}
          </p>
        ) : null}
        {ad.caption && !compact ? <p className="line-clamp-2 text-sm text-gray-600">{ad.caption}</p> : null}
        <AdButton ad={ad} placement="housing" className={cn("mt-2 justify-center rounded-lg bg-brand-600 px-4 text-white hover:bg-brand-700", compact ? "h-9 text-xs" : "h-10 text-sm")} />
      </div>
    </article>
  );
}

/** Reels: a full-screen vertical video, labelled Sponsored, its button over the bottom of the video. */
export function SponsoredReel({ ad, index, active, near }: { ad: FeedAd; index: number; active: boolean; near: boolean }) {
  const ref = useImpression(ad, "reels");
  const [gone, setGone] = useState<string | null>(null);
  const video = adVideo(ad);
  return (
    <section ref={ref} data-reel data-index={index} aria-label={`Sponsored by ${ad.business_name}`} className="flex h-full w-full snap-start snap-always items-center justify-center sm:py-2" data-testid="sponsored-reel">
      <div className="relative h-full w-full overflow-hidden bg-black sm:aspect-[9/16] sm:w-auto sm:max-w-full sm:rounded-2xl sm:shadow-lg">
        {gone ? (
          <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-white/90">{gone}</p>
        ) : (
          <>
            {video ? (
              <ReelVideo src={muxPlaybackUrl(video.playback_id!)} poster={muxPosterUrl(video.playback_id!)} active={active} near={near} eager={false} />
            ) : isOptimizableImage(mediaCover(ad.media)) ? (
              <Image src={mediaCover(ad.media)!} alt="" fill sizes="100vh" className="object-cover" />
            ) : null}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
            <div className="absolute inset-x-3 bottom-4 z-20 flex flex-col gap-2.5 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
              <Header ad={ad} menu={<AdMenu ad={ad} onGone={setGone} dark />} dark />
              {ad.headline ? <p className="text-[15px] font-semibold">{ad.headline}</p> : null}
              {ad.caption ? <p className="line-clamp-2 text-sm text-white/90">{ad.caption}</p> : null}
              <AdButton ad={ad} placement="reels" dark className="h-11 rounded-xl bg-white/95 px-4 text-sm text-gray-900 [text-shadow:none] hover:bg-white" />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
