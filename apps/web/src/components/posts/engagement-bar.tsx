"use client";

import Link from "next/link";
import { MessageCircle, MessageSquare, ThumbsUp } from "lucide-react";
import type { SavedTargetType } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { MessageButton } from "@/components/common/message-button";
import { actionButtonClasses, LikeButton, type LikeController } from "./like-button";

/** "12 likes · 3 comments" line shown between the media and the buttons. */
export function EngagementSummary({ likes, comments, onComments, className }: { likes: number; comments: number; onComments?: () => void; className?: string }) {
  if (likes === 0 && comments === 0) return null;
  return (
    <div className={cn("flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-gray-600", className)}>
      <span className="inline-flex items-center gap-1.5">
        {likes > 0 ? (
          <>
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-white">
              <ThumbsUp className="h-2.5 w-2.5 fill-current" />
            </span>
            <span className="tabular-nums" data-testid="like-count">
              {likes}
            </span>
          </>
        ) : null}
      </span>
      {comments > 0 ? (
        <button type="button" onClick={onComments} className="tabular-nums hover:underline" data-testid="comment-count">
          {comments} {comments === 1 ? "comment" : "comments"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Facebook-style action row: Like · Comment · Message share the width equally.
 * Save and Share live in the post's ••• menu. On your own post, Message opens
 * your inbox instead (you cannot message yourself).
 */
export function EngagementBar({
  like,
  onComment,
  message,
  className,
}: {
  like: LikeController;
  onComment: () => void;
  message?: { userId: string; currentUserId: string | null; returnTo: string; prefill?: string; target: { type: SavedTargetType; id: string } };
  className?: string;
}) {
  const own = message !== undefined && message.currentUserId !== null && message.currentUserId === message.userId;
  return (
    <div className={cn("flex items-center gap-0.5 border-t border-gray-100 px-1.5 py-1", className)} data-testid="engagement-bar">
      <LikeButton controller={like} className="flex-1" />
      <button type="button" onClick={onComment} className={cn(actionButtonClasses, "flex-1")} aria-label="Comment">
        <MessageSquare className="h-5 w-5 shrink-0" /> <span>Comment</span>
      </button>
      {own ? (
        <Link href="/messages" className={cn(actionButtonClasses, "flex-1")} aria-label="Message">
          <MessageCircle className="h-5 w-5 shrink-0" /> <span>Message</span>
        </Link>
      ) : message ? (
        <MessageButton
          userId={message.userId}
          currentUserId={message.currentUserId}
          returnTo={message.returnTo}
          prefill={message.prefill}
          variant="action"
          target={message.target}
          className="min-w-0 flex-1 justify-center px-1.5 text-[13px] sm:px-2 sm:text-sm"
        />
      ) : null}
    </div>
  );
}
