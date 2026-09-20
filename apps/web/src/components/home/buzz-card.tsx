"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, Flag, MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
import { BUZZ_TOPICS, listingMedia, timeAgo, type BuzzPost, type BuzzTopic } from "@apartment-book/shared";
import { deleteBuzzAction, muteBuzzAuthorAction } from "@/lib/actions/buzz";
import { cn } from "@/lib/utils";
import { ReportMenu } from "@/components/common/report-block";
import { ShareButton } from "@/components/common/share-button";
import { PhotoCarousel } from "@/components/photos/photo-carousel";
import { BuzzVote } from "./buzz-vote";

// Buzz is anonymous: there is no author here, only an alias. Never add avatars, profile links or a message button.

export const BUZZ_HOME = "/?tab=buzz";

export function buzzTopicLabel(topic: BuzzTopic): string {
  return BUZZ_TOPICS.find((t) => t.value === topic)?.label ?? "Other";
}

/** "Student 4821 · 2h" plus the OP / You markers. Used by threads and replies. */
export function BuzzByline({ alias, createdAt, isMine, isOp, className }: { alias: string; createdAt: string; isMine: boolean; isOp?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-500", className)}>
      <span className="font-semibold text-gray-700">{alias}</span>
      {isOp ? <span className="rounded bg-brand-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-brand-700">OP</span> : null}
      {isMine ? (
        <span className="rounded bg-gray-900 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white" title="Only you can see this marker">
          You
        </span>
      ) : null}
      <span aria-hidden="true">·</span>
      <span suppressHydrationWarning>{timeAgo(createdAt)}</span>
    </span>
  );
}

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
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
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

/**
 * One anonymous thread, Reddit style: votes on the left, then topic, alias, title, text, media and a quiet footer.
 * `full` is the thread page (whole text, no link on the title).
 */
export function BuzzCard({
  post,
  signedIn,
  full,
  priority,
  onRemoved,
  topicHref,
}: {
  post: BuzzPost;
  signedIn: boolean;
  full?: boolean;
  priority?: boolean;
  /** The feed drops the card (deleted or hidden). Without it the card goes back to Buzz. */
  onRemoved?: (id: string, why: "deleted" | "hidden") => void;
  /** The feed builds topic links that keep its sort and "All universities" choice. */
  topicHref?: (topic: BuzzTopic) => string;
}) {
  const router = useRouter();
  const href = `/buzz/${post.id}`;
  const media = listingMedia(post.images, post.imageMeta, post.videos);

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
    <article className="flex gap-1 bg-white py-2 pl-1 pr-3 shadow-sm ring-1 ring-gray-200 sm:rounded-xl sm:pl-1.5" data-testid="buzz-card">
      <BuzzVote postId={post.id} score={post.score} myVote={post.myVote} signedIn={signedIn} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={topicHref ? topicHref(post.topic) : `${BUZZ_HOME}&topic=${post.topic}`} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">
              {buzzTopicLabel(post.topic)}
            </Link>
            <BuzzByline alias={post.alias} createdAt={post.createdAt} isMine={post.isMine} />
          </div>
          <BuzzMenu
            label="Thread options"
            signedIn={signedIn}
            loginPath={href}
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
          />
        </div>

        {full ? (
          <h1 className="text-xl font-bold leading-snug text-gray-900 [overflow-wrap:anywhere]">{post.title}</h1>
        ) : (
          <h2 className="text-base font-bold leading-snug text-gray-900 [overflow-wrap:anywhere]">
            <Link href={href} className="hover:underline">
              {post.title}
            </Link>
          </h2>
        )}

        {post.body ? (
          full ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-gray-800 [overflow-wrap:anywhere]">{post.body}</p>
          ) : (
            <Link href={href} tabIndex={-1} aria-hidden="true" className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 [overflow-wrap:anywhere]">
              {post.body}
            </Link>
          )
        ) : null}

        {media.length > 0 ? (
          <PhotoCarousel photos={[]} media={media} alt={post.title} aspect="4 / 3" href={full ? undefined : href} fit={full ? "contain" : "cover"} priority={priority} sizes="(min-width: 640px) 450px, 100vw" className={cn("mt-0.5 rounded-lg", full && "bg-gray-900")} />
        ) : null}

        <div className="-ml-2 flex items-center gap-1">
          <Link href={`${href}#replies`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-gray-800 hover:bg-gray-100" data-testid="buzz-replies-link">
            <MessageSquare className="h-5 w-5 shrink-0" />
            {post.commentCount === 0 ? "Reply" : `${post.commentCount} ${post.commentCount === 1 ? "reply" : "replies"}`}
          </Link>
          <ShareButton path={href} title={post.title} />
        </div>
      </div>
    </article>
  );
}
