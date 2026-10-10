"use client";

import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, Bookmark, Check, Heart, MessageCircle, Send } from "lucide-react";
import { captionParts, compactCount, isVerifiedPoster, listingMedia, timeAgo, type FeedMedia, type FeedPostWithAuthor, type PostCommentWithAuthor, type PostEngagement, type PostPreview } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { MessageButton } from "@/components/common/message-button";
import { useSaveToggle } from "@/components/common/save-button";
import { useShare } from "@/components/common/share-button";
import { PhotoCarousel } from "@/components/photos/photo-carousel";
import { CommentsSection } from "@/components/posts/comments-section";
import { useLikeToggle } from "@/components/posts/like-button";
import { PostMenu } from "@/components/posts/post-menu";

export type InstaPostProps = {
  post: FeedPostWithAuthor;
  saved: boolean;
  signedIn: boolean;
  currentUserId: string | null;
  currentUser: { id: string; name: string; avatarUrl: string | null } | null;
  engagement?: PostEngagement;
  /** Faces for "Liked by …" and the newest comment. */
  preview?: PostPreview;
  /** Small line under the name, e.g. the university. */
  subtitle?: string;
  priority?: boolean;
  /** The post's own page: whole caption and the comment thread straight away. */
  commentsOpen?: boolean;
  initialComments?: PostCommentWithAuthor[];
};

const CAPTION_LIMIT = 110;
const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };
const TALLEST = 4 / 5;
const WIDEST = 1.91;

/** Instagram shows a photo in its own shape, but never taller than 4:5 or wider than 1.91:1. */
function frameAspect(media: FeedMedia[], reel: boolean): string {
  if (reel) return "9 / 16";
  const first = media[0];
  if (!first?.width || !first.height) return "4 / 5";
  const ratio = Math.min(WIDEST, Math.max(TALLEST, first.width / first.height));
  return `${Math.round(ratio * 1000)} / 1000`;
}

const icon = "flex h-9 items-center gap-1.5 rounded-lg text-gray-900 transition-transform hover:text-gray-500 active:scale-90";

/**
 * Instagram-style post: avatar and name → photo or video → heart, comment, share and bookmark → "Liked by …" → caption → comments → age.
 * Edge to edge on phones; a plain white block in the centre column on wider screens.
 */
export function InstaPost({ post, saved, signedIn, currentUserId, currentUser, engagement: given, preview, subtitle, priority, commentsOpen, initialComments }: InstaPostProps) {
  const engagement = given ?? NO_ENGAGEMENT;
  const author = post.author;
  const href = `/posts/${post.id}`;
  const reel = post.kind === "reel";
  const label = `${reel ? "Reel" : "Post"} by ${author.full_name}`;
  const media = listingMedia(post.images, post.image_meta, post.videos);
  const text = post.body?.trim() ?? "";

  const like = useLikeToggle("post", post.id, { liked: engagement.likedByMe, likes: engagement.likes }, signedIn);
  const save = useSaveToggle("post", post.id, saved, signedIn);
  const { share, copied } = useShare(href, label);
  const [slide, setSlide] = useState(0);
  const [burst, setBurst] = useState(0);
  const [expanded, setExpanded] = useState(Boolean(commentsOpen));
  const [open, setOpen] = useState(Boolean(commentsOpen));
  // Bumped every time the comment icon is pressed; the thread focuses its input when it changes.
  const [focusToken, setFocusToken] = useState(0);
  const [commentCount, setCommentCount] = useState(engagement.comments);
  // Feeds load counts for later pages after the post is already on screen: pick up the fresh number.
  const [seen, setSeen] = useState(given);
  if (seen !== given) {
    setSeen(given);
    setCommentCount(engagement.comments);
  }

  function openComments() {
    setOpen(true);
    setFocusToken((n) => n + 1);
  }
  function doubleTap() {
    if (!like.liked) like.toggle();
    if (signedIn) setBurst((b) => b + 1);
  }

  // "Liked by Maya and 11 others": somebody other than the viewer, newest first.
  const faces = (preview?.likers ?? []).filter((l) => l.id !== currentUserId).slice(0, 3);
  const face = faces[0];
  const others = like.likes - 1;

  const long = text.length > CAPTION_LIMIT || text.split("\n").length > 3;
  const shown = expanded || !long ? text : `${text.slice(0, CAPTION_LIMIT).split("\n").slice(0, 3).join("\n").trimEnd()}… `;
  const caption = (
    <>
      {captionParts(shown).map((part, i) =>
        part.tag ? (
          <span key={i} className="text-[#00376b]">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
      {long && !expanded ? (
        <button type="button" onClick={() => setExpanded(true)} className="text-gray-500 hover:text-gray-800">
          more
        </button>
      ) : null}
    </>
  );

  return (
    <article className="flex flex-col bg-white pb-3 sm:overflow-hidden sm:rounded-xl sm:ring-1 sm:ring-gray-200" data-testid="insta-post">
      <header className="flex items-center gap-2.5 px-3 py-2">
        <Link href={`/profile/${author.id}`} className="shrink-0">
          <Avatar name={author.full_name} src={author.avatar_url} size="sm" />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link href={`/profile/${author.id}`} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
            <span className="truncate">{author.full_name}</span>
            {isVerifiedPoster(author) ? <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-label="Verified student" /> : null}
          </Link>
          {subtitle ? <p className="truncate text-xs text-gray-700">{subtitle}</p> : null}
        </div>
        <PostMenu
          save={save}
          path={href}
          title={label}
          className="-mr-1.5"
          report={currentUserId !== author.id ? { targetType: "post", targetId: post.id } : undefined}
          extra={
            <MessageButton
              userId={author.id}
              currentUserId={currentUserId}
              returnTo={href}
              prefill={`Hi ${author.full_name.split(" ")[0]}! I saw your ${reel ? "reel" : "post"} on Apartment Book and wanted to say hi.`}
              variant="action"
              label={`Message ${author.full_name.split(" ")[0]}`}
              className="h-auto w-full justify-start gap-3 px-2.5 py-2 font-medium text-gray-900"
            />
          }
        />
      </header>

      {media.length > 0 ? (
        <PhotoCarousel photos={[]} media={media} alt={label} aspect={frameAspect(media, reel)} priority={priority} sizes="(min-width: 640px) 500px, 100vw" showDots={false} index={slide} onIndexChange={setSlide} onDoubleTap={doubleTap}>
          {burst > 0 ? (
            <span key={burst} className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
              <Heart className="ab-burst h-24 w-24 fill-white text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]" />
            </span>
          ) : null}
        </PhotoCarousel>
      ) : text ? (
        // Words only: the text is the post.
        <p className="whitespace-pre-line break-words px-3 pb-1 text-base leading-snug text-gray-900" onDoubleClick={doubleTap} data-testid="insta-text">
          {caption}
        </p>
      ) : null}

      {/* Instagram puts the carousel dots on their own line between the photo and the actions. */}
      {media.length > 1 ? (
        <div className="flex justify-center gap-1 pt-2.5" aria-label={`${slide + 1} of ${media.length}`}>
          {media.slice(0, 12).map((_, i) => (
            <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i === slide ? "bg-brand-600" : "bg-gray-300")} />
          ))}
        </div>
      ) : null}

      <div className={cn("flex items-center gap-[18px] px-3", media.length > 1 ? "pt-1" : "pt-1.5")}>
        <button type="button" onClick={like.toggle} disabled={like.pending} aria-pressed={like.liked} aria-label={like.liked ? "Unlike" : "Like"} className={cn(icon, like.liked && "text-[#ed4956] hover:text-[#ed4956]")}>
          <Heart className={cn("h-7 w-7", like.liked && "fill-current")} />
          {like.likes > 0 ? <span className="text-sm font-semibold tabular-nums text-gray-900">{compactCount(like.likes)}</span> : null}
        </button>
        <button type="button" onClick={openComments} aria-label="Comment" className={icon}>
          <MessageCircle className="h-[26px] w-[26px] -scale-x-100" />
          {commentCount > 0 ? <span className="text-sm font-semibold tabular-nums">{compactCount(commentCount)}</span> : null}
        </button>
        <button type="button" onClick={share} aria-label={copied ? "Link copied" : "Share"} className={icon}>
          {copied ? <Check className="h-[26px] w-[26px] text-brand-600" /> : <Send className="h-[26px] w-[26px]" />}
          {copied ? <span className="text-xs font-semibold text-brand-700">Link copied</span> : null}
        </button>
        <span className="flex-1" />
        {save.signedIn ? (
          <button type="button" onClick={save.toggle} disabled={save.pending} aria-pressed={save.saved} aria-label={save.saved ? "Unsave" : "Save"} className={icon}>
            <Bookmark className={cn("h-[26px] w-[26px]", save.saved && "fill-current")} />
          </button>
        ) : (
          <a href={`/login?next=${encodeURIComponent(href)}`} aria-label="Save" className={icon}>
            <Bookmark className="h-[26px] w-[26px]" />
          </a>
        )}
      </div>

      <div className="flex flex-col gap-1 px-3 pt-1 text-sm text-gray-900">
        {face && like.likes > 0 ? (
          <div className="flex items-center gap-1.5" data-testid="liked-by">
            <span className="flex">
              {faces.map((l, i) => (
                <span key={l.id} className={cn("rounded-full ring-2 ring-white", i > 0 && "-ml-2")}>
                  <Avatar name={l.name} src={l.avatarUrl} size="xs" />
                </span>
              ))}
            </span>
            <p className="min-w-0 truncate">
              Liked by{" "}
              <Link href={`/profile/${face.id}`} className="font-semibold">
                {face.name}
              </Link>
              {others > 0 ? (
                <>
                  {" "}
                  and <span className="font-semibold">{others === 1 ? "1 other" : `${compactCount(others)} others`}</span>
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        {media.length > 0 && text ? (
          <p className="whitespace-pre-line break-words" data-testid="insta-caption">
            <Link href={`/profile/${author.id}`} className="font-semibold">
              {author.full_name}
            </Link>{" "}
            {caption}
          </p>
        ) : null}

        {!open && commentCount > 1 ? (
          <button type="button" onClick={openComments} className="self-start text-gray-500 hover:text-gray-800">
            View all {compactCount(commentCount)} comments
          </button>
        ) : null}
        {!open && commentCount > 0 && preview?.lastComment ? (
          <p className="line-clamp-2 break-words">
            <Link href={`/profile/${preview.lastComment.author.id}`} className="font-semibold">
              {preview.lastComment.author.full_name}
            </Link>{" "}
            {preview.lastComment.body}
          </p>
        ) : null}

        <Link href={href} className="self-start text-xs text-gray-500 hover:underline" suppressHydrationWarning>
          {timeAgo(post.created_at)}
        </Link>
      </div>

      {open ? (
        <CommentsSection
          className="mt-2"
          targetType="post"
          targetId={post.id}
          totalComments={commentCount}
          onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))}
          currentUser={currentUser}
          ownerId={author.id}
          focusToken={focusToken}
          initialComments={initialComments}
        />
      ) : null}
    </article>
  );
}
