"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Bookmark, Check, Heart, MessageCircle, Play, Plus, Share2, Volume2, VolumeX } from "lucide-react";
import { muxPlaybackUrl, muxPosterUrl, reelPath, timeAgo, type Reel } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
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
  /** Bumped on every like so the heart replays its pop, and on every double tap so the big heart flashes again. */
  const [pop, setPop] = useState(0);
  const [burst, setBurst] = useState(0);
  /** Collapsed, the description is one line like Instagram's. Whether it was cut is measured on the clamped span, not guessed. */
  const oneLine = [reel.title, reel.caption].filter(Boolean).join(" · ");
  const clampRef = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const descRef = useRef<HTMLButtonElement>(null);
  const lessRef = useRef<HTMLButtonElement>(null);
  /** Set by the toggles, so focus only moves after a keyboard/click toggle and never on mount or when a reel scrolls away. */
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    (expanded ? lessRef : descRef).current?.focus({ preventScroll: true });
  }, [expanded]);
  useLayoutEffect(() => {
    const el = clampRef.current;
    if (!el) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, oneLine]);
  const canExpand = clipped || oneLine.includes("\n");

  /** Likes, saves and comments need an account; send people to log in and bring them back to Reels. */
  function needsLogin(): boolean {
    if (signedIn) return false;
    router.push(REELS_LOGIN_HREF);
    return true;
  }

  function toggleLike() {
    if (needsLogin()) return;
    if (!like.liked) setPop((k) => k + 1);
    like.toggle();
  }

  /** Double click or double tap on the video: like (never unlike) with a big heart, like Instagram. */
  function doubleTap() {
    setBurst((k) => k + 1);
    if (!like.liked) toggleLike();
  }

  return (
    <section data-reel data-index={index} aria-label={`Reel by ${reel.author.name}`} className="flex h-full w-full snap-start snap-always items-center justify-center sm:py-2">
      <div className="relative h-full w-full overflow-hidden bg-black sm:aspect-[9/16] sm:w-auto sm:max-w-full sm:rounded-2xl sm:shadow-lg">
        <ReelVideo src={muxPlaybackUrl(reel.video.playback_id)} poster={reel.video.poster_url ?? muxPosterUrl(reel.video.playback_id)} active={active} near={near} eager={index === 0} onDoubleTap={doubleTap} />
        {burst > 0 ? (
          <span key={burst} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <Heart className="ab-burst h-28 w-28 fill-white text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.5)]" />
          </span>
        ) : null}

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
        <div className="absolute bottom-4 right-2 z-20 flex flex-col items-center gap-2 text-white">
          <ActionButton label={like.liked ? "Unlike" : "Like"} count={like.likes} pressed={like.liked} disabled={like.pending} onClick={toggleLike}>
            {/* A new key on every like restarts the pop. */}
            <Heart key={pop} className={cn("h-7 w-7", like.liked && "fill-current text-red-500", like.liked && pop > 0 && "ab-pop")} />
          </ActionButton>
          <ActionButton
            label="Comments"
            count={commentCount}
            onClick={() => {
              if (!needsLogin()) onOpenComments();
            }}
          >
            <MessageCircle className="h-7 w-7" />
          </ActionButton>
          <ActionButton label="Share" text={copied ? "Copied" : "Share"} onClick={() => void share()}>
            {copied ? <Check className="h-7 w-7" /> : <Share2 className="h-7 w-7" />}
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
            <Bookmark className={cn("h-7 w-7", save.saved && "fill-current")} />
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
          {/* Collapsed: one line with a tail ellipsis, like Instagram; the line is the button. Expanded: title (a tour's title opens its listing, which has the Message button), caption, "less". */}
          {oneLine ? (
            expanded ? (
              <>
                {reel.title ? (
                  isTour ? (
                    <Link href={path} className="line-clamp-3 text-sm font-semibold hover:underline" data-testid="reel-listing-link">
                      {reel.title}
                    </Link>
                  ) : (
                    <p className="line-clamp-3 text-sm font-semibold">{reel.title}</p>
                  )
                ) : null}
                {reel.caption ? <p className="max-h-40 overflow-y-auto whitespace-pre-line break-words pr-1 text-sm">{reel.caption}</p> : null}
                {/* Outside the scroll box, so a long description can always be folded back. */}
                <button
                  ref={lessRef}
                  type="button"
                  onClick={() => {
                    toggled.current = true;
                    setExpanded(false);
                  }}
                  aria-expanded="true"
                  className="self-start text-sm font-semibold text-white/90 hover:underline"
                >
                  less
                </button>
              </>
            ) : (
              <button
                ref={descRef}
                type="button"
                onClick={() => {
                  toggled.current = true;
                  setExpanded(true);
                }}
                disabled={!canExpand}
                aria-expanded="false"
                title={canExpand ? "Show the full description" : undefined}
                className="w-full text-left text-sm disabled:cursor-default"
                data-testid="reel-description"
              >
                {/* The clamp lives on its own span (a -webkit-box, so block-level by itself): Safari does not let a button become one. */}
                <span ref={clampRef} className="line-clamp-1">
                  {oneLine}
                </span>
              </button>
            )
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
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur transition-colors group-hover:bg-black/60">{children}</span>
      <span className="tabular-nums">{text ?? compact.format(count ?? 0)}</span>
    </button>
  );
}

/**
 * The player. Follows photos/video-player.tsx: hls.js wherever Media Source
 * Extensions exist, the native HLS player only when they do not (iPhone Safari),
 * and the stream is torn down on unmount or when the reel is far from view.
 */
function ReelVideo({ src, poster, active, near, eager, onDoubleTap }: { src: string; poster: string; active: boolean; near: boolean; eager: boolean; onDoubleTap?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (pendingTap.current && clearTimeout(pendingTap.current)), []);
  /** Single tap pauses after a beat; a second tap inside it likes instead (Instagram's double tap). */
  function onTap() {
    if (pendingTap.current) {
      clearTimeout(pendingTap.current);
      pendingTap.current = null;
      onDoubleTap?.();
      return;
    }
    pendingTap.current = setTimeout(() => {
      pendingTap.current = null;
      setUserPaused((v) => !v);
    }, onDoubleTap ? 260 : 0);
  }
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
      <button type="button" onClick={onTap} aria-label={userPaused ? "Play" : "Pause"} className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center focus:outline-none">
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
