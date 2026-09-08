"use server";

import { addComment, commentSchema, deleteComment, getPostEngagement, likePost, unlikePost, type PostCommentWithAuthor, type SavedTargetType } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";

export async function toggleLikeAction(targetType: SavedTargetType, targetId: string, like: boolean): Promise<{ liked: boolean; likes: number; error?: string }> {
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

export async function addCommentAction(targetType: SavedTargetType, targetId: string, body: string): Promise<{ comment?: PostCommentWithAuthor; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to comment." };
  const parsed = commentSchema.safeParse({ body });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Write a comment" };
  try {
    const supabase = await createClient();
    return { comment: await addComment(supabase, user.id, targetType, targetId, parsed.data.body) };
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
