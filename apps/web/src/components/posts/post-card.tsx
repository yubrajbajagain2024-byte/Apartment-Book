"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { BadgeCheck, Bookmark, Video, EyeOff } from "lucide-react";
import { ANONYMOUS_POSTER, hasPublicComments, hasVideo, sharedPostFromListing, timeAgo, type FeedMedia, type PostCommentWithAuthor, type PostEngagement, type PostTargetType, type SharedPost } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { MessageButton } from "@/components/common/message-button";
import { SaveBurst, SaveToggleButton, useSaveToggle } from "@/components/common/save-button";
import { ShareButton } from "@/components/common/share-button";
import { PhotoCarousel } from "@/components/photos/photo-carousel";
import { CommentsSection } from "./comments-section";
import { EngagementBar, EngagementSummary } from "./engagement-bar";
import { PostMenu } from "./post-menu";
import { useLikeToggle } from "./like-button";

export type PostCardProps = {
  href: string;
  targetType: PostTargetType;
  targetId: string;
  /** `badge` marks a business listing ("Sponsored" / "Verified Partner"): the business is the poster, and it has no profile to open. */
  /** `anonymous`: an anonymous roommate post or item (its row names nobody): no profile, and Message opens the anonymous inquiry chat. */
  poster: { id: string; name: string; avatarUrl: string | null; verified: boolean; badge?: string | null; anonymous?: boolean };
  /** The business behind a portal listing: its "Message" opens the inquiry chat with the whole team. */
  businessId?: string | null;
  /** e.g. "0.4 mi from campus · San Marcos" */
  subtitle?: string;
  media: FeedMedia[];
  /** Listings have a title; Home-feed posts do not (the body links to `href` instead). */
  title?: string;
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

/** The first photo, or a still from the first video, for the card a friend gets when this is shared. */
function firstFrame(media: FeedMedia[]): string | null {
  for (const m of media) {
    if (m.type === "photo") return m.url;
    if (m.type === "video" && m.poster) return m.poster;
  }
  return null;
}

/** What the share sheet sends: everything the card already has, so no extra query is needed. */
function sharedPostOfCard({ targetType, targetId, href, poster, media, title, caption }: PostCardProps): SharedPost {
  const author = poster.anonymous ? ANONYMOUS_POSTER : { id: poster.id, name: poster.name, avatar_url: poster.avatarUrl };
  if (targetType === "post") {
    return { target_type: "post", target_id: targetId, kind: "post", path: href, title: title ?? null, caption: caption?.trim() ? caption.trim() : null, image_url: firstFrame(media), author };
  }
  return sharedPostFromListing({ targetType, targetId, title: title ?? `Post by ${poster.name}`, caption, imageUrl: firstFrame(media), author });
}

/** A feed post. Instagram-style by default; `layout="facebook"` for text-first posts with likes and comments. */
export function PostCard(props: PostCardProps) {
  const { href, poster, media, title, caption, lead, createdAt, compact } = props;
  /** Used for alt text and the share sheet when the post has no title. */
  const label = title ?? `Post by ${poster.name}`;
  const save = useSaveToggle(props.targetType, props.targetId, props.saved, props.signedIn);
  const [burst, setBurst] = useState(0);
  const [expanded, setExpanded] = useState(Boolean(props.commentsOpen));
  const video = hasVideo(media);
  const text = caption?.trim() ?? "";
  const long = text.length > CAPTION_LIMIT;
  const facebook = props.layout === "facebook";

  const header = (
    <div className={cn("flex items-center gap-2.5", compact ? "px-2 py-1.5" : "px-3 py-2.5")}>
      {poster.anonymous ? (
        <span aria-label="Anonymous" className={cn("flex shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500", compact ? "h-6 w-6" : facebook ? "h-10 w-10" : "h-8 w-8")}>
          <EyeOff className={compact ? "h-3 w-3" : "h-4 w-4"} />
        </span>
      ) : poster.badge && props.businessId ? (
        // A business's listing: the business's public profile (migration 50), not the person who posted it.
        <Link href={`/businesses/${props.businessId}`} className="shrink-0">
          <Avatar name={poster.name} src={poster.avatarUrl} size={compact ? "xs" : facebook ? "md" : "sm"} />
        </Link>
      ) : poster.badge ? (
        <span className="shrink-0">
          <Avatar name={poster.name} src={poster.avatarUrl} size={compact ? "xs" : facebook ? "md" : "sm"} />
        </span>
      ) : (
        <Link href={`/profile/${poster.id}`} className="shrink-0">
          <Avatar name={poster.name} src={poster.avatarUrl} size={compact ? "xs" : facebook ? "md" : "sm"} />
        </Link>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        {poster.badge ? (
          // Like Instagram's "Sponsored": the label sits under the business's name, so the name keeps the whole line.
          <span className="flex min-w-0 flex-col" data-testid="sponsor">
            {props.businessId ? (
              <Link href={`/businesses/${props.businessId}`} className={cn("truncate font-semibold text-gray-900 hover:underline", compact ? "text-xs" : "text-sm")}>
                {poster.name}
              </Link>
            ) : (
              <span className={cn("truncate font-semibold text-gray-900", compact ? "text-xs" : "text-sm")}>{poster.name}</span>
            )}
            <span className="flex min-w-0 items-center gap-1 text-xs text-gray-500">
              <span className={cn("shrink-0 font-semibold", poster.badge === "Business" ? "text-gray-500" : "text-brand-700", compact && "text-[10px]")}>{poster.badge}</span>
              {props.subtitle && !compact ? <span className="truncate">· {props.subtitle}</span> : null}
            </span>
          </span>
        ) : poster.anonymous ? (
          <span className={cn("block truncate font-semibold text-gray-900", compact ? "text-xs" : "text-sm")}>{poster.name}</span>
        ) : (
          <Link href={`/profile/${poster.id}`} className={cn("flex items-center gap-1 font-semibold text-gray-900", compact ? "text-xs" : "text-sm")}>
            <span className="truncate">{poster.name}</span>
            {poster.verified ? <BadgeCheck className={cn("shrink-0 text-brand-600", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-label="Verified student" /> : null}
          </Link>
        )}
        {poster.badge ? null : facebook ? (
          <p className="truncate text-xs text-gray-500">
            <span suppressHydrationWarning>{timeAgo(createdAt)}</span>
            {props.subtitle ? <span> · {props.subtitle}</span> : null}
          </p>
        ) : props.subtitle && !compact ? (
          <p className="truncate text-xs text-gray-500">{props.subtitle}</p>
        ) : null}
      </div>
      {!compact && !facebook ? (
        <span className="shrink-0 text-xs text-gray-500" suppressHydrationWarning>
          {timeAgo(createdAt)}
        </span>
      ) : null}
      <PostMenu save={save} path={href} title={label} className={compact ? "-mr-1" : "-mr-1.5"} report={props.currentUserId !== poster.id ? { targetType: props.targetType, targetId: props.targetId } : undefined} />
    </div>
  );

  const shown = expanded || !long ? text : `${text.slice(0, CAPTION_LIMIT).trimEnd()}… `;
  const description = text ? (
    <p className={cn("mt-0.5 whitespace-pre-line break-words text-gray-800", facebook && "text-[15px] leading-snug")}>
      {/* Without a title the text itself opens the post. */}
      {title === undefined ? (
        <Link href={href} className="text-gray-900">
          {shown}
        </Link>
      ) : (
        shown
      )}
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
          alt={label}
          aspect="4 / 5"
          href={href}
          priority={props.priority}
          sizes={compact ? "(min-width: 640px) 320px, 50vw" : "(min-width: 640px) 640px, 100vw"}
          onDoubleTap={() => {
            if (!save.saved) save.toggle();
            setBurst((b) => b + 1);
          }}
        >
          {/* "Video tour" is for listings; a student's own post or reel is not a tour. */}
          {video && props.targetType !== "post" ? (
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
      <FacebookBody {...props} header={header} description={description} mediaBlock={mediaBlock} />
    );
  }

  if (compact) {
    return (
      <article className="flex flex-col overflow-hidden bg-white ring-1 ring-gray-200 sm:rounded-xl">
        {mediaBlock}
        {header}
        {title !== undefined ? (
          <Link href={href} className="px-2 pb-2 text-sm font-semibold leading-snug text-gray-900">
            <span className="line-clamp-2">{title}</span>
          </Link>
        ) : null}
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
        <MessageButton userId={poster.id} currentUserId={props.currentUserId} returnTo={href} prefill={props.messagePrefill} variant="action" target={{ type: props.targetType, id: props.targetId }} businessId={props.businessId} anonymous={poster.anonymous} />
        <ShareButton path={href} title={label} sharedPost={sharedPostOfCard(props)} currentUserId={props.currentUserId} />
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
  props: PostCardProps & { header: ReactNode; description: ReactNode; mediaBlock: ReactNode },
) {
  const { href, title, lead, poster, header, description, mediaBlock } = props;
  const engagement = props.engagement ?? NO_ENGAGEMENT;
  const like = useLikeToggle(props.targetType, props.targetId, { liked: engagement.likedByMe, likes: engagement.likes }, props.signedIn);
  const [open, setOpen] = useState(Boolean(props.commentsOpen));
  // Roommate posts have no public comments: their posters are reached in private (the Message button).
  const publicComments = hasPublicComments(props.targetType);
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
      <div className={cn("px-3 text-gray-900", title !== undefined || lead || description || props.details ? "pb-3" : "hidden")}>
        {title !== undefined ? (
          <Link href={href} className="block text-[17px] font-semibold leading-snug">
            {title}
          </Link>
        ) : null}
        {lead ? <p className="mt-0.5 text-sm font-semibold text-brand-700">{lead}</p> : null}
        {description}
        {props.details ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">{props.details}</div> : null}
      </div>
      {mediaBlock}
      <EngagementSummary likes={like.likes} comments={publicComments ? commentCount : 0} onComments={publicComments ? openComments : undefined} className={mediaBlock ? undefined : "border-t border-gray-100"} />
      <EngagementBar
        like={like}
        onComment={publicComments ? openComments : undefined}
        message={{ userId: poster.id, currentUserId: props.currentUserId, returnTo: href, prefill: props.messagePrefill, target: { type: props.targetType, id: props.targetId } }}
      />
      {open && publicComments ? (
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
