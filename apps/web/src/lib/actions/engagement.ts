"use server";

import { addComment, commentSchema, deleteComment, getPostEngagement, likePost, unlikePost, voteComment, type CommentVote, type PostCommentWithAuthor, type PostTargetType } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";

export async function toggleLikeAction(targetType: PostTargetType, targetId: string, like: boolean): Promise<{ liked: boolean; likes: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { liked: false, likes: 0, error: "Log in to like posts." };
  try {
    const supabase = await createClient();
    if (like) await likePost(supabase, user.id, targetType, targetId);
    else await unlikePost(supabase, user.id, targetType, targetId);
    const engagement = await getPostEngagement(supabase, targetType, targetId);
    return { liked: engagement.likedByMe, likes: engagement.likes };
  } catch (error) {
    return { liked: !like, likes: 0, error: errorMessage(error, "Could not update your like.") };
  }
}

/** A comment on the post, or with `parentId` a reply to one of its comments (the server checks it belongs to the same post). */
export async function addCommentAction(targetType: PostTargetType, targetId: string, body: string, parentId: string | null = null): Promise<{ comment?: PostCommentWithAuthor; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to comment." };
  const parsed = commentSchema.safeParse({ body });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Write a comment" };
  try {
    const supabase = await createClient();
    return { comment: await addComment(supabase, user.id, targetType, targetId, parsed.data.body, parentId) };
  } catch (error) {
    return { error: errorMessage(error, "Could not post your comment.") };
  }
}

export async function deleteCommentAction(id: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in first." };
  try {
    await deleteComment(await createClient(), id);
    return {};
  } catch (error) {
    return { error: errorMessage(error, "Could not delete the comment.") };
  }
}

/** Thumbs up (1), thumbs down (-1) or clear (0) on a comment; answers with the server's score and your vote. */
export async function voteCommentAction(commentId: string, value: -1 | 0 | 1): Promise<{ error?: string; vote?: CommentVote }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to rate comments." };
  // Server functions are reachable without the UI, so do not trust the type alone.
  if (value !== -1 && value !== 0 && value !== 1) return { error: "Could not save your vote." };
  try {
    return { vote: await voteComment(await createClient(), commentId, value) };
  } catch (error) {
    return { error: errorMessage(error, "Could not save your vote.") };
  }
}
