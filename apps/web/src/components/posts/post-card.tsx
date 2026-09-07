"use client";

import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, Bookmark, Video } from "lucide-react";
import { hasVideo, timeAgo, type FeedMedia, type SavedTargetType } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { MessageButton } from "@/components/common/message-button";
import { SaveBurst, SaveToggleButton, useSaveToggle } from "@/components/common/save-button";
import { ShareButton } from "@/components/common/share-button";
import { PhotoCarousel } from "@/components/photos/photo-carousel";

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
};

const CAPTION_LIMIT = 140;

/** Instagram-style post: media first and edge to edge, small header, actions, caption. */
export function PostCard(props: PostCardProps) {
  const { href, poster, media, title, caption, lead, createdAt, compact } = props;
  const save = useSaveToggle(props.targetType, props.targetId, props.saved, props.signedIn);
  const [burst, setBurst] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const video = hasVideo(media);
  const text = caption?.trim() ?? "";
  const long = text.length > CAPTION_LIMIT;

  const header = (
    <div className={cn("flex items-center gap-2.5", compact ? "px-2 py-1.5" : "px-3 py-2.5")}>
      <Link href={`/profile/${poster.id}`} className="shrink-0">
        <Avatar name={poster.name} src={poster.avatarUrl} size={compact ? "xs" : "sm"} />
      </Link>
      <div className="min-w-0 flex-1 leading-tight">
        <Link href={`/profile/${poster.id}`} className={cn("flex items-center gap-1 font-semibold text-gray-900", compact ? "text-xs" : "text-sm")}>
          <span className="truncate">{poster.name}</span>
          {poster.verified ? <BadgeCheck className={cn("shrink-0 text-brand-600", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-label="Verified student" /> : null}
        </Link>
        {props.subtitle && !compact ? <p className="truncate text-xs text-gray-500">{props.subtitle}</p> : null}
      </div>
      {!compact ? (
        <span className="shrink-0 text-xs text-gray-400" suppressHydrationWarning>
          {timeAgo(createdAt)}
        </span>
      ) : null}
    </div>
  );

  const mediaBlock = (
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
  );

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
        <MessageButton userId={poster.id} currentUserId={props.currentUserId} returnTo={href} prefill={props.messagePrefill} variant="action" />
        <ShareButton path={href} title={title} />
      </div>
      <div className="px-3 pb-3 pt-1 text-sm text-gray-900">
        <Link href={href} className="font-semibold">
          {lead ? <span>{lead} · </span> : null}
          {title}
        </Link>
        {text ? (
          <p className="mt-0.5 whitespace-pre-line text-gray-800">
            {expanded || !long ? text : `${text.slice(0, CAPTION_LIMIT).trimEnd()}… `}
            {long && !expanded ? (
              <button type="button" onClick={() => setExpanded(true)} className="font-medium text-gray-500 hover:text-gray-800">
                more
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}
