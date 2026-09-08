"use client";

import { useState } from "react";
import type { PostCommentWithAuthor, PostEngagement, SavedTargetType } from "@apartment-book/shared";
import { CommentsSection } from "./comments-section";
import { EngagementBar, EngagementSummary } from "./engagement-bar";
import { useLikeToggle } from "./like-button";

/** Detail pages: Like / Comment / Share plus the full comment thread, always open. */
export function PostEngagementPanel({
  targetType,
  targetId,
  href,
  title,
  ownerId,
  engagement,
  initialComments,
  signedIn,
  currentUser,
}: {
  targetType: SavedTargetType;
  targetId: string;
  href: string;
  title: string;
  ownerId: string;
  engagement: PostEngagement;
  initialComments: PostCommentWithAuthor[];
  signedIn: boolean;
  currentUser: { id: string; name: string; avatarUrl: string | null } | null;
}) {
  const like = useLikeToggle(targetType, targetId, { liked: engagement.likedByMe, likes: engagement.likes }, signedIn);
  const [commentCount, setCommentCount] = useState(engagement.comments);
  const [focusToken, setFocusToken] = useState(0);
  return (
    <div className="flex flex-col">
      <EngagementSummary likes={like.likes} comments={commentCount} onComments={() => setFocusToken((n) => n + 1)} className="pt-2.5" />
      <EngagementBar like={like} onComment={() => setFocusToken((n) => n + 1)} share={{ path: href, title }} className={like.likes === 0 && commentCount === 0 ? "border-t-0" : undefined} />
      <CommentsSection
        targetType={targetType}
        targetId={targetId}
        totalComments={commentCount}
        onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))}
        currentUser={currentUser}
        ownerId={ownerId}
        focusToken={focusToken}
        initialComments={initialComments}
      />
    </div>
  );
}
