"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { BadgeCheck, Bookmark, Video } from "lucide-react";
import { hasVideo, timeAgo, type FeedMedia, type PostCommentWithAuthor, type PostEngagement, type SavedTargetType } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { MessageButton } from "@/components/common/message-button";
import { SaveBurst, SaveToggleButton, useSaveToggle } from "@/components/common/save-button";
import { ShareButton } from "@/components/common/share-button";
import { PhotoCarousel } from "@/components/photos/photo-carousel";
import { CommentsSection } from "./comments-section";
import { EngagementBar, EngagementSummary } from "./engagement-bar";
import { useLikeToggle } from "./like-button";

export type PostCardProps = {
  href: string;
  targetType: SavedTargetType;
  targetId: string;
  poster: { id: string; name: string; avatarUrl: string | null; verified: boolean };
  /** e.g. "0.4 mi from campus · San Marcos" */
  subtitle?: string;
  media: FeedMedia[];
  title: string;
  caption?: string | null;
  /** Bold lead-in before the caption, e.g. "$650/mo · 2 bd · 1 ba". */
  lead?: string;
  createdAt: string;
  saved: boolean;
  signedIn: boolean;
  currentUserId: string | null;
  messagePrefill?: string;
  priority?: boolean;
  /** Smaller tile for photo-only posts so video posts stand out. */
  compact?: boolean;
  /**
   * "instagram" (default): media first, actions, caption.
   * "facebook": header, text, media, like/comment/message, comments.
   */
  layout?: "instagram" | "facebook";
  /** Facebook layout: extra chips under the text (budget, move-in date…). */
  details?: ReactNode;
  /** Facebook layout: like/comment counts. */
  engagement?: PostEngagement;
  /** Facebook layout: who is commenting (avatar next to the input). */
  currentUser?: { id: string; name: string; avatarUrl: string | null } | null;
  /** Facebook layout: show the comment thread straight away (detail pages). */
  commentsOpen?: boolean;
  initialComments?: PostCommentWithAuthor[];
};

const CAPTION_LIMIT = 140;
const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

/** A feed post. Instagram-style by default; `layout="facebook"` for text-first posts with likes and comments. */
export function PostCard(props: PostCardProps) {
  const { href, poster, media, title, caption, lead, createdAt, compact } = props;
  const save = useSaveToggle(props.targetType, props.targetId, props.saved, props.signedIn);
  const [burst, setBurst] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const video = hasVideo(media);
  const text = caption?.trim() ?? "";
  const long = text.length > CAPTION_LIMIT;
  const facebook = props.layout === "facebook";

  const header = (
    <div className={cn("flex items-center gap-2.5", compact ? "px-2 py-1.5" : "px-3 py-2.5")}>
      <Link href={`/profile/${poster.id}`} className="shrink-0">
        <Avatar name={poster.name} src={poster.avatarUrl} size={compact ? "xs" : facebook ? "md" : "sm"} />
      </Link>
      <div className="min-w-0 flex-1 leading-tight">
        <Link href={`/profile/${poster.id}`} className={cn("flex items-center gap-1 font-semibold text-gray-900", compact ? "text-xs" : "text-sm")}>
          <span className="truncate">{poster.name}</span>
          {poster.verified ? <BadgeCheck className={cn("shrink-0 text-brand-600", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-label="Verified student" /> : null}
        </Link>
        {facebook ? (
          <p className="truncate text-xs text-gray-500">
            <span suppressHydrationWarning>{timeAgo(createdAt)}</span>
            {props.subtitle ? <span> · {props.subtitle}</span> : null}
          </p>
        ) : props.subtitle && !compact ? (
          <p className="truncate text-xs text-gray-500">{props.subtitle}</p>
        ) : null}
      </div>
      {!compact && !facebook ? (
        <span className="shrink-0 text-xs text-gray-400" suppressHydrationWarning>
          {timeAgo(createdAt)}
        </span>
      ) : null}
    </div>
  );

  const description = text ? (
    <p className={cn("mt-0.5 whitespace-pre-line text-gray-800", facebook && "text-[15px] leading-snug")}>
      {expanded || !long ? text : `${text.slice(0, CAPTION_LIMIT).trimEnd()}… `}
      {long && !expanded ? (
        <button type="button" onClick={() => setExpanded(true)} className="font-medium text-gray-500 hover:text-gray-800">
          more
        </button>
      ) : null}
    </p>
  ) : null;

  const mediaBlock =
    media.length > 0 ? (
      <div className="relative">
        <PhotoCarousel
          photos={[]}
          media={media}
          alt={title}
          aspect="4 / 5"
          href={href}
          priority={props.priority}
          sizes={compact ? "(min-width: 640px) 320px, 50vw" : "(min-width: 640px) 640px, 100vw"}
          onDoubleTap={() => {
            if (!save.saved) save.toggle();
            setBurst((b) => b + 1);
          }}
        >
          {video ? (
            <span className="pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">
              <Video className="h-3.5 w-3.5" /> Video tour
            </span>
          ) : null}
          {compact && lead ? (
            <span className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-full bg-black/65 px-2.5 py-1 text-sm font-bold text-white backdrop-blur">{lead}</span>
          ) : null}
          <SaveBurst key={burst} show={burst > 0} />
        </PhotoCarousel>
        {compact ? (
          <div className="absolute right-2 top-2 z-20">
            <SaveToggleButton controller={save} size="sm" className="bg-white/90 shadow" />
          </div>
        ) : null}
      </div>
    ) : null;

  if (facebook) {
    return (
      <FacebookBody {...props} header={header} description={description} mediaBlock={mediaBlock} save={save} />
    );
  }

  if (compact) {
    return (
      <article className="flex flex-col overflow-hidden bg-white ring-1 ring-gray-200 sm:rounded-xl">
        {mediaBlock}
        {header}
        <Link href={href} className="px-2 pb-2 text-sm font-semibold leading-snug text-gray-900">
          <span className="line-clamp-2">{title}</span>
        </Link>
      </article>
    );
  }

  return (
    <article className="flex flex-col overflow-hidden bg-white ring-1 ring-gray-200 sm:rounded-xl">
      {header}
      {mediaBlock}
      <div className="flex items-center gap-1 px-1.5 pt-1">
        <button
          type="button"
          onClick={save.toggle}
          disabled={save.pending || !save.signedIn}
          aria-pressed={save.saved}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold hover:bg-gray-100", save.saved ? "text-brand-700" : "text-gray-800")}
        >
          <Bookmark className={cn("h-5 w-5", save.saved && "fill-current")} /> {save.saved ? "Saved" : "Save"}
        </button>
        <MessageButton userId={poster.id} currentUserId={props.currentUserId} returnTo={href} prefill={props.messagePrefill} variant="action" target={{ type: props.targetType, id: props.targetId }} />
        <ShareButton path={href} title={title} />
      </div>
      <div className="px-3 pb-3 pt-1 text-sm text-gray-900">
        <Link href={href} className="font-semibold">
          {lead ? <span>{lead} · </span> : null}
          {title}
        </Link>
        {description}
      </div>
    </article>
  );
}

/** Header → title/description → media → counts → Like/Comment/Message → comments. */
function FacebookBody(
  props: PostCardProps & { header: ReactNode; description: ReactNode; mediaBlock: ReactNode; save: ReturnType<typeof useSaveToggle> },
) {
  const { href, title, lead, poster, header, description, mediaBlock, save } = props;
  const engagement = props.engagement ?? NO_ENGAGEMENT;
  const like = useLikeToggle(props.targetType, props.targetId, { liked: engagement.likedByMe, likes: engagement.likes }, props.signedIn);
  const [open, setOpen] = useState(Boolean(props.commentsOpen));
  const [commentCount, setCommentCount] = useState(engagement.comments);
  // When the feed loads counts after the first paint, pick up the fresh number.
  const [seen, setSeen] = useState(engagement);
  if (seen !== engagement) {
    setSeen(engagement);
    setCommentCount(engagement.comments);
  }
  // Bumped every time "Comment" is pressed; the section focuses its input when it changes.
  const [focusToken, setFocusToken] = useState(0);
  function openComments() {
    setOpen(true);
    setFocusToken((n) => n + 1);
  }

  return (
    <article className="flex flex-col overflow-hidden bg-white ring-1 ring-gray-200 sm:rounded-xl" data-testid="fb-post">
      {header}
      <div className="px-3 pb-3 text-gray-900">
        <Link href={href} className="block text-[17px] font-semibold leading-snug">
          {title}
        </Link>
        {lead ? <p className="mt-0.5 text-sm font-semibold text-brand-700">{lead}</p> : null}
        {description}
        {props.details ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">{props.details}</div> : null}
      </div>
      {mediaBlock}
      <EngagementSummary likes={like.likes} comments={commentCount} onComments={openComments} className={mediaBlock ? undefined : "border-t border-gray-100"} />
      <EngagementBar
        like={like}
        onComment={openComments}
        message={{ userId: poster.id, currentUserId: props.currentUserId, returnTo: href, prefill: props.messagePrefill, target: { type: props.targetType, id: props.targetId } }}
        save={save}
        share={{ path: href, title }}
      />
      {open ? (
        <CommentsSection
          targetType={props.targetType}
          targetId={props.targetId}
          totalComments={commentCount}
          onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))}
          currentUser={props.currentUser ?? null}
          ownerId={poster.id}
          focusToken={focusToken}
          initialComments={props.initialComments}
        />
      ) : null}
    </article>
  );
}
