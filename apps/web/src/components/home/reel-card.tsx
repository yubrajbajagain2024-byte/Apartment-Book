"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Bookmark, Check, Heart, MessageCircle, Play, Plus, Share2, Video, Volume2, VolumeX } from "lucide-react";
import { muxPlaybackUrl, muxPosterUrl, reelPath, timeAgo, type Reel } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { MessageButton } from "@/components/common/message-button";
import { useSaveToggle } from "@/components/common/save-button";
import { useShare } from "@/components/common/share-button";
import { useLikeToggle } from "@/components/posts/like-button";

export const REELS_PATH = "/?tab=reels";
export const REELS_LOGIN_HREF = `/login?next=${encodeURIComponent(REELS_PATH)}`;

export function reelKey(reel: Pick<Reel, "sourceType" | "sourceId">): string {
  return `${reel.sourceType}:${reel.sourceId}`;
}

/** Sound is one choice for the whole feed: unmute one reel and the next one plays with sound too. */
let soundOn = false;
const soundListeners = new Set<() => void>();
function subscribeSound(listener: () => void) {
  soundListeners.add(listener);
  return () => {
    soundListeners.delete(listener);
  };
}
export function setReelSound(on: boolean) {
  soundOn = on;
  soundListeners.forEach((l) => l());
}
export function toggleReelSound() {
  setReelSound(!soundOn);
}
function useReelSound(): boolean {
  return useSyncExternalStore(
    subscribeSound,
    () => soundOn,
    () => false,
  );
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/**
 * One full-height reel: the video, a column of actions on the right and the
 * author + caption at the bottom left. The feed decides which card is `active`
 * (the only one that plays) and which are `near` (stream attached, ready to go).
 */
export function ReelCard({
  reel,
  index,
  active,
  near,
  signedIn,
  currentUserId,
  commentCount,
  onOpenComments,
  scopeLink,
}: {
  reel: Reel;
  index: number;
  active: boolean;
  near: boolean;
  signedIn: boolean;
  currentUserId: string | null;
  commentCount: number;
  onOpenComments: () => void;
  /** Switch between the viewer's university and all universities. */
  scopeLink?: { href: string; label: string } | null;
}) {
  const router = useRouter();
  const isMine = currentUserId === reel.author.id;
  const isTour = reel.sourceType !== "post";
  const path = reelPath(reel);
  const like = useLikeToggle(reel.sourceType, reel.sourceId, { liked: reel.likedByMe, likes: reel.likes }, signedIn);
  const save = useSaveToggle(reel.sourceType, reel.sourceId, reel.savedByMe, signedIn);
  const { share, copied } = useShare(path, reel.title ?? `${reel.author.name} on Apartment Book`);
  const [expanded, setExpanded] = useState(false);
  const longCaption = reel.caption.length > 90 || reel.caption.includes("\n");

  /** Likes, saves and comments need an account; send people to log in and bring them back to Reels. */
  function needsLogin(): boolean {
    if (signedIn) return false;
    router.push(REELS_LOGIN_HREF);
    return true;
  }

  return (
    <section data-reel data-index={index} aria-label={`Reel by ${reel.author.name}`} className="flex h-full w-full snap-start snap-always items-center justify-center sm:py-2">
      <div className="relative h-full w-full overflow-hidden bg-black sm:aspect-[9/16] sm:w-auto sm:max-w-full sm:rounded-2xl sm:shadow-lg">
        <ReelVideo src={muxPlaybackUrl(reel.video.playback_id)} poster={reel.video.poster_url ?? muxPosterUrl(reel.video.playback_id)} active={active} near={near} eager={index === 0} />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

        <div className="absolute left-3 right-14 top-3 z-20 flex flex-wrap items-center gap-2">
          <Link href="/reels/new" className="inline-flex h-9 items-center gap-1 rounded-full bg-black/45 pl-2 pr-3 text-[13px] font-semibold text-white backdrop-blur hover:bg-black/60">
            <Plus className="h-4 w-4" /> Post a reel
          </Link>
          {scopeLink ? (
            <Link href={scopeLink.href} className="inline-flex h-9 items-center rounded-full bg-black/45 px-3 text-[13px] font-semibold text-white backdrop-blur hover:bg-black/60" data-testid="reels-scope">
              {scopeLink.label}
            </Link>
          ) : null}
        </div>

        {/* Actions */}
        <div className="absolute bottom-4 right-2 z-20 flex flex-col items-center gap-3.5 text-white">
          <Link href={`/profile/${reel.author.id}`} aria-label={`${reel.author.name}'s profile`} className="rounded-full ring-2 ring-white">
            <Avatar name={reel.author.name} src={reel.author.avatarUrl} size="md" />
          </Link>
          <ActionButton
            label={like.liked ? "Unlike" : "Like"}
            count={like.likes}
            pressed={like.liked}
            disabled={like.pending}
            onClick={() => {
              if (!needsLogin()) like.toggle();
            }}
          >
            <Heart className={cn("h-6 w-6", like.liked && "fill-current text-red-500")} />
          </ActionButton>
          <ActionButton
            label="Comments"
            count={commentCount}
            onClick={() => {
              if (!needsLogin()) onOpenComments();
            }}
          >
            <MessageCircle className="h-6 w-6" />
          </ActionButton>
          <ActionButton
            label={save.saved ? "Saved" : "Save"}
            text={save.saved ? "Saved" : "Save"}
            pressed={save.saved}
            disabled={save.pending}
            onClick={() => {
              if (!needsLogin()) save.toggle();
            }}
          >
            <Bookmark className={cn("h-6 w-6", save.saved && "fill-current")} />
          </ActionButton>
          <ActionButton label="Share" text={copied ? "Copied" : "Share"} onClick={() => void share()}>
            {copied ? <Check className="h-6 w-6" /> : <Share2 className="h-6 w-6" />}
          </ActionButton>
        </div>

        {/* Author and caption */}
        <div className="absolute bottom-4 left-3 right-16 z-20 flex flex-col gap-1.5 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
          <div className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold">
            <Link href={`/profile/${reel.author.id}`} className="truncate hover:underline">
              {reel.author.name}
            </Link>
            {reel.author.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-brand-200" aria-label="Verified student" /> : null}
            {isMine ? <span className="shrink-0 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">You</span> : null}
            <span className="shrink-0 text-xs font-normal text-white/80" suppressHydrationWarning>
              · {timeAgo(reel.createdAt)}
            </span>
          </div>
          {reel.title ? <p className="line-clamp-2 text-sm font-semibold">{reel.title}</p> : null}
          {reel.caption ? (
            <div className={cn("text-sm", expanded && "max-h-40 overflow-y-auto pr-1")}>
              <p className={cn("whitespace-pre-line break-words", !expanded && "line-clamp-2")}>{reel.caption}</p>
              {longCaption ? (
                <button type="button" onClick={() => setExpanded((v) => !v)} className="font-semibold text-white/90 hover:underline">
                  {expanded ? "less" : "more"}
                </button>
              ) : null}
            </div>
          ) : null}
          {isTour && !isMine ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-2 [text-shadow:none]">
              <Link href={path} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-semibold text-gray-900 hover:bg-gray-100">
                <Video className="h-4 w-4 text-brand-600" /> Video tour · View listing
              </Link>
              <MessageButton
                userId={reel.author.id}
                currentUserId={currentUserId}
                returnTo={REELS_PATH}
                variant="action"
                target={{ type: reel.sourceType === "apartment" ? "apartment" : "roommate", id: reel.sourceId }}
                prefill={`Hi ${reel.author.name.split(" ")[0]}! I watched your video tour${reel.title ? ` of "${reel.title}"` : ""} and I'd like to know more.`}
                className="h-8 rounded-full bg-white/20 px-3 text-[13px] text-white backdrop-blur hover:bg-white/30"
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ActionButton({
  label,
  count,
  text,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  count?: number;
  text?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={pressed} className="group flex flex-col items-center gap-0.5 text-[12px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur transition-colors group-hover:bg-black/60">{children}</span>
      <span className="tabular-nums">{text ?? compact.format(count ?? 0)}</span>
    </button>
  );
}

/**
 * The player. Follows photos/video-player.tsx: hls.js wherever Media Source
 * Extensions exist, the native HLS player only when they do not (iPhone Safari),
 * and the stream is torn down on unmount or when the reel is far from view.
 */
function ReelVideo({ src, poster, active, near, eager }: { src: string; poster: string; active: boolean; near: boolean; eager: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const wantsPlay = useRef(false);
  const sound = useReelSound();
  const [started, setStarted] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  // A reel that scrolls away forgets that it was paused; one that is far away shows its poster again.
  const [prev, setPrev] = useState({ active, near });
  if (prev.active !== active || prev.near !== near) {
    setPrev({ active, near });
    if (!active) setUserPaused(false);
    if (!near) setStarted(false);
  }

  // Attach the stream only for the reel on screen and its neighbours.
  useEffect(() => {
    const video = ref.current;
    if (!video || !near) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    const begin = () => {
      if (wantsPlay.current) play(video);
    };
    if (!/\.m3u8(\?|$)/.test(src)) {
      video.src = src;
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const instance = new Hls({ capLevelToPlayerSize: true, startLevel: -1 });
          instance.loadSource(src);
          instance.attachMedia(video);
          hls = instance;
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
        }
        begin();
      });
    }
    return () => {
      cancelled = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, near]);

  // Only the active reel plays; leaving a reel rewinds it.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    wantsPlay.current = active && !userPaused;
    if (wantsPlay.current) {
      play(video);
    } else {
      video.pause();
      if (!active && video.currentTime > 0) video.currentTime = 0;
    }
  }, [active, userPaused, near]);

  useEffect(() => {
    if (ref.current) ref.current.muted = !sound;
  }, [sound]);

  return (
    <>
      <video ref={ref} poster={poster} muted={!sound} loop playsInline preload={near ? "auto" : "none"} onPlaying={() => setStarted(true)} className="absolute inset-0 h-full w-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element -- poster frame from the video provider */}
      <img src={poster} alt="" loading={eager ? "eager" : "lazy"} className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200", started ? "opacity-0" : "opacity-100")} />
      <button type="button" onClick={() => setUserPaused((v) => !v)} aria-label={userPaused ? "Play" : "Pause"} className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center focus:outline-none">
        {userPaused ? (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur">
            <Play className="h-8 w-8 translate-x-0.5 fill-current" />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={toggleReelSound}
        aria-label={sound ? "Mute" : "Unmute"}
        className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/60"
      >
        {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>
    </>
  );
}

/** Browsers refuse autoplay with sound until the person has interacted with the page: fall back to muted. */
function play(video: HTMLVideoElement) {
  video.play().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "NotAllowedError" && !video.muted) {
      setReelSound(false);
      video.muted = true;
      video.play().catch(() => {});
    }
  });
}
