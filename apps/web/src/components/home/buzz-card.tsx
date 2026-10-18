"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, Flag, MessageCircle, MoreHorizontal, Play, Trash2 } from "lucide-react";
import { compactCount, listingMedia, type BuzzPost, type BuzzTopic, type FeedMedia } from "@apartment-book/shared";
import { deleteBuzzAction, muteBuzzAuthorAction } from "@/lib/actions/buzz";
import { cn } from "@/lib/utils";
import { ReportMenu } from "@/components/common/report-block";
import { PhotoCarousel } from "@/components/photos/photo-carousel";
import { BUZZ_HOME, BUZZ_PILL, BuzzAge, BuzzBadges, BuzzSharePill, BuzzTopicIcon, buzzTopicLabel } from "./buzz-bits";
import { BuzzVote } from "./buzz-vote";

// Buzz is anonymous: there is no author here, only an alias. Never add avatars of people, profile links or a message button.

const MENU_WIDTH = 240; // w-60

function placeBelow(button: HTMLButtonElement | null): { top: number; right: number } | null {
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  const right = Math.min(Math.max(8, window.innerWidth - rect.right), Math.max(8, window.innerWidth - MENU_WIDTH - 8));
  return { top: rect.bottom + 6, right };
}

type MenuResult = { error?: string };

/**
 * The small "•••" menu on a Buzz thread or reply: Report, Hide, Delete.
 * Hiding covers one thread only (that thread, or one person's replies inside it), so threads can never be linked
 * to a shared author, and it works without anyone learning who the person is.
 */
export function BuzzMenu({
  label,
  signedIn,
  loginPath,
  report,
  onHide,
  hideLabel = "Hide this thread",
  hideConfirm = "Hide this thread? You will not find out who wrote it, and they will not be told.",
  onDelete,
  deleteConfirm,
  className,
}: {
  label: string;
  signedIn: boolean;
  loginPath: string;
  /** Omit on your own content. */
  report?: { targetType: "buzz" | "buzz_comment"; targetId: string };
  /** Omit on your own content. */
  onHide?: () => Promise<MenuResult>;
  /** What hiding means here: the whole thread (default) or one person's replies in this thread. */
  hideLabel?: string;
  hideConfirm?: string;
  /** Only for content you may delete. */
  onDelete?: () => Promise<MenuResult>;
  deleteConfirm?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const login = `/login?next=${encodeURIComponent(loginPath)}`;

  function toggle() {
    setReporting(false);
    setError(null);
    if (!open) setPos(placeBelow(buttonRef.current));
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const follow = () => setPos(placeBelow(buttonRef.current));
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  async function run(task: () => Promise<MenuResult>) {
    setBusy(true);
    setError(null);
    const result = await task().catch(() => ({ error: "Something went wrong. Try again." }));
    setBusy(false);
    if (result.error) setError(result.error);
    else setOpen(false);
  }

  if (!report && !onHide && !onDelete) return null;
  const item = "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50";

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className, open && "z-50")}>
      <button ref={buttonRef} type="button" onClick={toggle} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900">
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && pos ? (
        <div id={menuId} role="menu" aria-label={label} style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-60 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-gray-200">
          {report ? (
            !signedIn ? (
              <a role="menuitem" href={login} className={item}>
                <Flag className="h-5 w-5" /> Report
              </a>
            ) : reporting ? (
              <ReportMenu targetType={report.targetType} targetId={report.targetId} onDone={() => setOpen(false)} />
            ) : (
              <button type="button" role="menuitem" onClick={() => setReporting(true)} className={item}>
                <Flag className="h-5 w-5" /> Report
              </button>
            )
          ) : null}
          {onHide && !reporting ? (
            !signedIn ? (
              <a role="menuitem" href={login} className={item}>
                <EyeOff className="h-5 w-5" /> {hideLabel}
              </a>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(hideConfirm)) return;
                  void run(onHide);
                }}
                className={item}
              >
                <EyeOff className="h-5 w-5" /> {hideLabel}
              </button>
            )
          ) : null}
          {onDelete && !reporting ? (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(deleteConfirm ?? "Delete this? This cannot be undone.")) return;
                void run(onDelete);
              }}
              className={cn(item, "text-red-600")}
            >
              <Trash2 className="h-5 w-5" /> Delete
            </button>
          ) : null}
          {error ? <p className="px-2.5 py-1 text-xs text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Report / Hide / Delete for one thread, wired the same way in the feed and on the thread page. */
export function BuzzThreadMenu({ post, signedIn, onRemoved, className }: { post: BuzzPost; signedIn: boolean; onRemoved?: (id: string, why: "deleted" | "hidden") => void; className?: string }) {
  const router = useRouter();

  function leave(why: "deleted" | "hidden") {
    if (onRemoved) {
      onRemoved(post.id, why);
      router.refresh();
    } else {
      router.push(BUZZ_HOME);
      router.refresh();
    }
  }

  return (
    <BuzzMenu
      label="Thread options"
      signedIn={signedIn}
      loginPath={`/buzz/${post.id}`}
      report={post.isMine ? undefined : { targetType: "buzz", targetId: post.id }}
      onHide={
        post.isMine
          ? undefined
          : async () => {
              const result = await muteBuzzAuthorAction({ postId: post.id }, { stayQuiet: !onRemoved });
              if (!result.error) leave("hidden");
              return result;
            }
      }
      onDelete={
        post.isMine
          ? async () => {
              const result = await deleteBuzzAction(post.id, { stayQuiet: !onRemoved });
              if (!result.error) leave("deleted");
              return result;
            }
          : undefined
      }
      deleteConfirm="Delete this thread and all its replies? This cannot be undone."
      className={className}
    />
  );
}

/** The small rounded picture at the right of a feed row: the first photo, or the video's still with a play badge. */
function BuzzThumb({ media, href, alt, priority, small }: { media: FeedMedia[]; href: string; alt: string; priority?: boolean; small?: boolean }) {
  const first = media[0];
  if (!first) return null;
  const src = first.type === "video" ? first.poster : first.url;
  return (
    <Link href={href} tabIndex={-1} aria-hidden="true" className={cn("relative z-10 shrink-0 overflow-hidden rounded-xl bg-gray-100 ring-1 ring-black/5", small ? "h-[54px] w-[72px]" : "h-[72px] w-24")} data-testid="buzz-thumb">
      {src ? <Image src={src} alt={alt} fill sizes="96px" priority={priority} className="object-cover" /> : null}
      {first.type === "video" ? (
        <span className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white">
          <Play className="h-3 w-3 fill-current" />
        </span>
      ) : media.length > 1 ? (
        <span className="absolute bottom-1 right-1 rounded-full bg-black/70 px-1.5 text-[10px] font-semibold leading-4 text-white">{media.length}</span>
      ) : null}
    </Link>
  );
}

function RepliesPill({ href, count }: { href: string; count: number }) {
  return (
    <Link href={`${href}#replies`} aria-label={count === 1 ? "1 reply" : `${count} replies`} className={cn(BUZZ_PILL, "relative z-10")} data-testid="buzz-replies-link">
      <MessageCircle className="h-[18px] w-[18px]" />
      <span className="tabular-nums">{compactCount(count)}</span>
    </Link>
  );
}

/**
 * One thread in the Buzz feed, laid out like a row of Reddit's home feed: topic and age, bold title, a short grey
 * preview, a small picture at the right, then the vote, replies and share pills. The whole row opens the thread.
 */
export function BuzzRow({
  post,
  signedIn,
  priority,
  onRemoved,
  topicHref,
}: {
  post: BuzzPost;
  signedIn: boolean;
  priority?: boolean;
  /** The feed drops the row (deleted or hidden). */
  onRemoved?: (id: string, why: "deleted" | "hidden") => void;
  /** The feed builds topic links that keep its sort and "All universities" choice. */
  topicHref?: (topic: BuzzTopic) => string;
}) {
  const href = `/buzz/${post.id}`;
  const media = listingMedia(post.images, post.imageMeta, post.videos);

  return (
    <article className="relative px-4 pb-2.5 pt-2 transition-colors hover:bg-gray-50" data-testid="buzz-card">
      <div className="flex items-center gap-2">
        <Link href={topicHref ? topicHref(post.topic) : `${BUZZ_HOME}&topic=${post.topic}`} className="relative z-10 flex min-w-0 items-center gap-2 hover:underline">
          <BuzzTopicIcon topic={post.topic} />
          <span className="truncate text-[13px] font-bold text-gray-900">{buzzTopicLabel(post.topic)}</span>
        </Link>
        <BuzzAge iso={post.createdAt} className="shrink-0 text-[13px] text-gray-500" />
        <BuzzBadges isMine={post.isMine} />
        <BuzzThreadMenu post={post} signedIn={signedIn} onRemoved={onRemoved} className="z-10 -mr-2 ml-auto" />
      </div>

      <div className="mt-0.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold leading-snug text-gray-900 [overflow-wrap:anywhere]">
            {/* The title link covers the whole row; the pills and the menu sit above it. */}
            <Link href={href} className="after:absolute after:inset-0">
              {post.title}
            </Link>
          </h2>
          {post.body ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm leading-snug text-gray-600 [overflow-wrap:anywhere]">{post.body}</p> : null}
        </div>
        <BuzzThumb media={media} href={href} alt={post.title} priority={priority} />
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <BuzzVote postId={post.id} score={post.score} myVote={post.myVote} signedIn={signedIn} className="relative z-10" />
        <RepliesPill href={href} count={post.commentCount} />
        <BuzzSharePill path={href} title={post.title} className="relative z-10 ml-auto" />
      </div>
    </article>
  );
}

/** A search result, as compact as Reddit's: topic and age, the title, then "12 upvotes · 7 comments". */
export function BuzzSearchRow({ post }: { post: BuzzPost }) {
  const href = `/buzz/${post.id}`;
  const media = listingMedia(post.images, post.imageMeta, post.videos);
  return (
    <article className="relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50" data-testid="buzz-card">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] text-gray-500">
          <BuzzTopicIcon topic={post.topic} />
          <span className="truncate font-semibold text-gray-700">{buzzTopicLabel(post.topic)}</span>
          <span aria-hidden="true">•</span>
          <BuzzAge iso={post.createdAt} className="shrink-0" />
          <BuzzBadges isMine={post.isMine} />
        </div>
        <h2 className="mt-1.5 text-base leading-snug text-gray-900 [overflow-wrap:anywhere]">
          <Link href={href} className="after:absolute after:inset-0">
            {post.title}
          </Link>
        </h2>
        <p className="mt-1.5 text-[13px] text-gray-500">
          {compactCount(post.score)} {post.score === 1 ? "upvote" : "upvotes"} <span aria-hidden="true">•</span> {compactCount(post.commentCount)} {post.commentCount === 1 ? "comment" : "comments"}
        </p>
      </div>
      <BuzzThumb media={media} href={href} alt={post.title} small />
    </article>
  );
}

/** The top of the thread page: topic, alias in blue, the big title, the whole text, media as wide as the column, pills. */
export function BuzzPostBlock({ post, signedIn, replyCount }: { post: BuzzPost; signedIn: boolean; replyCount: number }) {
  const href = `/buzz/${post.id}`;
  const media = listingMedia(post.images, post.imageMeta, post.videos);
  // The frame takes the shape of the first photo or video (between 4:5 and 16:9, like Reddit), so it fills the
  // column from edge to edge with no dark bars. A single picture that is only a little taller or wider than that is
  // trimmed to fill; a very long one (a screenshot, say) and the other slides of a gallery are shown whole.
  const first = media[0];
  const natural = first?.width && first?.height ? first.width / first.height : null;
  const ratio = natural ? Math.min(16 / 9, Math.max(4 / 5, natural)) : 4 / 3;
  const fills = media.length === 1 && natural !== null && Math.abs(natural / ratio - 1) < 0.2;
  return (
    <article className="pb-3 pt-1" data-testid="buzz-card">
      <div className="flex items-center gap-2.5 px-4">
        <BuzzTopicIcon topic={post.topic} size="md" />
        <div className="min-w-0 text-[13px] leading-tight">
          <Link href={`${BUZZ_HOME}&topic=${post.topic}`} className="font-bold text-gray-700 hover:underline">
            {buzzTopicLabel(post.topic)}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-gray-500">
            <span className="font-medium text-brand-700">{post.alias}</span>
            <span aria-hidden="true">•</span>
            <BuzzAge iso={post.createdAt} />
            <BuzzBadges isOp isMine={post.isMine} />
          </div>
        </div>
      </div>

      <h1 className="mt-2.5 px-4 text-[22px] font-bold leading-tight text-gray-900 [overflow-wrap:anywhere]">{post.title}</h1>
      {post.body ? <p className="mt-2 whitespace-pre-wrap px-4 text-[15px] leading-relaxed text-gray-900 [overflow-wrap:anywhere]">{post.body}</p> : null}

      {/* Photos and video run from one edge of the column to the other, with no box around them. */}
      {media.length > 0 ? <PhotoCarousel photos={[]} media={media} alt={post.title} aspect={ratio.toFixed(4)} fit={fills ? "cover" : "contain"} priority sizes="(min-width: 640px) 500px, 100vw" className="mt-3 bg-gray-900" /> : null}

      <div className="mt-3 flex items-center gap-2 px-4">
        <BuzzVote postId={post.id} score={post.score} myVote={post.myVote} signedIn={signedIn} />
        <RepliesPill href={href} count={replyCount} />
        <BuzzSharePill path={href} title={post.title} className="ml-auto" />
      </div>
    </article>
  );
}
