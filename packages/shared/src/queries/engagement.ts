import type { Client, PostCommentWithAuthor, PostEngagement, SavedTargetType } from "../types/models";

export const COMMENT_SELECT = "*, author:profiles!post_comments_user_id_fkey(id, full_name, avatar_url)";

/** Like and comment counts for a post, plus whether the signed-in user liked it. */
export async function getPostEngagement(supabase: Client, targetType: SavedTargetType, targetId: string): Promise<PostEngagement> {
  const { data, error } = await supabase.rpc("post_engagement", { p_target_type: targetType, p_target_id: targetId });
  if (error) throw error;
  const row = data?.[0];
  return { likes: Number(row?.likes ?? 0), comments: Number(row?.comments ?? 0), likedByMe: Boolean(row?.liked_by_me) };
}

/** Counts for many posts of one type at once (feed pages). Missing ids come back as zeros. */
export async function getPostEngagementMany(supabase: Client, targetType: SavedTargetType, targetIds: string[]): Promise<Record<string, PostEngagement>> {
  const out: Record<string, PostEngagement> = {};
  if (targetIds.length === 0) return out;
  const { data, error } = await supabase.rpc("post_engagement_many", { p_target_type: targetType, p_target_ids: targetIds });
  if (error) throw error;
  for (const row of data ?? []) out[row.target_id] = { likes: Number(row.likes), comments: Number(row.comments), likedByMe: Boolean(row.liked_by_me) };
  for (const id of targetIds) out[id] ??= { likes: 0, comments: 0, likedByMe: false };
  return out;
}

export async function likePost(supabase: Client, userId: string, targetType: SavedTargetType, targetId: string): Promise<void> {
  const { error } = await supabase.from("post_likes").upsert({ user_id: userId, target_type: targetType, target_id: targetId }, { onConflict: "target_type,target_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function unlikePost(supabase: Client, userId: string, targetType: SavedTargetType, targetId: string): Promise<void> {
  const { error } = await supabase.from("post_likes").delete().match({ user_id: userId, target_type: targetType, target_id: targetId });
  if (error) throw error;
}

/** Oldest first, like a comment thread. Pass `after` (created_at of the last row) to load newer ones. */
export async function listComments(supabase: Client, targetType: SavedTargetType, targetId: string, opts: { limit?: number; after?: string } = {}): Promise<PostCommentWithAuthor[]> {
  let query = supabase
    .from("post_comments")
    .select(COMMENT_SELECT)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 50);
  if (opts.after) query = query.gt("created_at", opts.after);
  const { data, error } = await query;
  if (error) throw error;
  return data as PostCommentWithAuthor[];
}

export async function addComment(supabase: Client, userId: string, targetType: SavedTargetType, targetId: string, body: string): Promise<PostCommentWithAuthor> {
  const { data, error } = await supabase
    .from("post_comments")
    .insert({ user_id: userId, target_type: targetType, target_id: targetId, body })
    .select(COMMENT_SELECT)
    .single();
  if (error) throw error;
  return data as PostCommentWithAuthor;
}

/** Your own comment, or any comment on your post. */
export async function deleteComment(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("post_comments").delete().eq("id", id);
  if (error) throw error;
}
