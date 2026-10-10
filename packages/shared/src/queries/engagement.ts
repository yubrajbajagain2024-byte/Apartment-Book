import type { Client, CommentVote, PostCommentNode, PostCommentWithAuthor, PostEngagement, PostLiker, PostPreview, PostTargetType } from "../types/models";

export const COMMENT_SELECT = "*, author:profiles!post_comments_user_id_fkey(id, full_name, avatar_url)";

/** Like and comment counts for a post, plus whether the signed-in user liked it. */
export async function getPostEngagement(supabase: Client, targetType: PostTargetType, targetId: string): Promise<PostEngagement> {
  const { data, error } = await supabase.rpc("post_engagement", { p_target_type: targetType, p_target_id: targetId });
  if (error) throw error;
  const row = data?.[0];
  return { likes: Number(row?.likes ?? 0), comments: Number(row?.comments ?? 0), likedByMe: Boolean(row?.liked_by_me) };
}

/** Counts for many posts of one type at once (feed pages). Missing ids come back as zeros. */
export async function getPostEngagementMany(supabase: Client, targetType: PostTargetType, targetIds: string[]): Promise<Record<string, PostEngagement>> {
  const out: Record<string, PostEngagement> = {};
  if (targetIds.length === 0) return out;
  const { data, error } = await supabase.rpc("post_engagement_many", { p_target_type: targetType, p_target_ids: targetIds });
  if (error) throw error;
  for (const row of data ?? []) out[row.target_id] = { likes: Number(row.likes), comments: Number(row.comments), likedByMe: Boolean(row.liked_by_me) };
  for (const id of targetIds) out[id] ??= { likes: 0, comments: 0, likedByMe: false };
  return out;
}

const PREVIEW_LIKERS = 3;

/**
 * The "Liked by Maya and others" faces and the newest comment for many posts of one type (feed pages).
 * Two small queries for the whole page. Likers come from post_likers_many, which leaves out anyone whose
 * Liked setting hides their likes from the viewer, and anyone blocked either way; comments follow row-level security.
 */
export async function getPostPreviewsMany(supabase: Client, targetType: PostTargetType, targetIds: string[]): Promise<Record<string, PostPreview>> {
  const out: Record<string, PostPreview> = {};
  if (targetIds.length === 0) return out;
  for (const id of targetIds) out[id] = { likers: [], lastComment: null };
  const [likes, comments] = await Promise.all([
    supabase.rpc("post_likers_many", { p_target_type: targetType, p_target_ids: targetIds, p_per: PREVIEW_LIKERS }),
    supabase
      .from("post_comments")
      .select(COMMENT_SELECT)
      .eq("target_type", targetType)
      .in("target_id", targetIds)
      .order("created_at", { ascending: false })
      .limit(Math.min(400, targetIds.length * 15)),
  ]);
  if (likes.error) throw likes.error;
  if (comments.error) throw comments.error;
  for (const row of likes.data ?? []) {
    const entry = out[row.target_id];
    if (!entry || entry.likers.length >= PREVIEW_LIKERS) continue;
    const person: PostLiker = { id: row.user_id, name: row.full_name, avatarUrl: row.avatar_url };
    entry.likers.push(person);
  }
  for (const row of (comments.data ?? []) as PostCommentWithAuthor[]) {
    const entry = out[row.target_id];
    if (entry && !entry.lastComment && row.author) entry.lastComment = row;
  }
  return out;
}

export async function likePost(supabase: Client, userId: string, targetType: PostTargetType, targetId: string): Promise<void> {
  const { error } = await supabase.from("post_likes").upsert({ user_id: userId, target_type: targetType, target_id: targetId }, { onConflict: "target_type,target_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function unlikePost(supabase: Client, userId: string, targetType: PostTargetType, targetId: string): Promise<void> {
  const { error } = await supabase.from("post_likes").delete().match({ user_id: userId, target_type: targetType, target_id: targetId });
  if (error) throw error;
}

/** Oldest first, like a comment thread. Pass `after` (created_at of the last row) to load newer ones. */
export async function listComments(supabase: Client, targetType: PostTargetType, targetId: string, opts: { limit?: number; after?: string } = {}): Promise<PostCommentWithAuthor[]> {
  let query = supabase
    .from("post_comments")
    .select(COMMENT_SELECT)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 500);
  if (opts.after) query = query.gt("created_at", opts.after);
  const { data, error } = await query;
  if (error) throw error;
  return data as PostCommentWithAuthor[];
}

/** A comment on the post, or with `parentId` a reply to another comment of the same post (the server checks). */
export async function addComment(supabase: Client, userId: string, targetType: PostTargetType, targetId: string, body: string, parentId?: string | null): Promise<PostCommentWithAuthor> {
  const { data, error } = await supabase
    .from("post_comments")
    .insert({ user_id: userId, target_type: targetType, target_id: targetId, body, parent_id: parentId ?? null })
    .select(COMMENT_SELECT)
    .single();
  if (error) throw error;
  return data as PostCommentWithAuthor;
}

/** The viewer's own votes on some comments: comment id -> 1 or -1. Nothing signed out. */
export async function getMyCommentVotes(supabase: Client, viewerId: string | null, commentIds: string[]): Promise<Record<string, -1 | 1>> {
  if (!viewerId || commentIds.length === 0) return {};
  const { data, error } = await supabase.from("post_comment_votes").select("comment_id, value").eq("user_id", viewerId).in("comment_id", commentIds);
  if (error) throw error;
  const out: Record<string, -1 | 1> = {};
  for (const row of data ?? []) out[row.comment_id] = row.value > 0 ? 1 : -1;
  return out;
}

/** Thumbs up (1), thumbs down (-1) or clear (0) on a comment. Returns the fresh score and your vote. */
export async function voteComment(supabase: Client, commentId: string, value: -1 | 0 | 1): Promise<CommentVote> {
  const { data, error } = await supabase.rpc("post_comment_vote", { p_comment_id: commentId, p_value: value });
  if (error) throw error;
  const row = data?.[0];
  return { score: Number(row?.score ?? 0), likes: Number(row?.likes ?? 0), myVote: ((row?.my_vote ?? 0) > 0 ? 1 : (row?.my_vote ?? 0) < 0 ? -1 : 0) as -1 | 0 | 1 };
}

/** Replies that nest deeper than this stay at the same indent, so phones stay readable. */
export const COMMENT_MAX_DEPTH = 3;

/**
 * Puts comments in thread order: each comment is followed by its replies, oldest first on every level (Instagram's
 * order), with `depth`, `replyCount` (all descendants) and the viewer's vote. A reply whose parent is not in the list
 * (hidden by a block, say) is shown at the top level rather than dropped.
 */
/** How the top-level comments are ordered. Replies always read oldest first, like a conversation. */
export type CommentSort = "top" | "new";
export const COMMENT_SORTS: { value: CommentSort; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "new", label: "Newest" },
];

export function threadComments(comments: PostCommentWithAuthor[], myVotes: Record<string, -1 | 1> = {}, opts: { sort?: CommentSort } = {}): PostCommentNode[] {
  const sort = opts.sort ?? "top";
  const byTime = (a: PostCommentWithAuthor, b: PostCommentWithAuthor) => a.created_at.localeCompare(b.created_at);
  // Top: most hearts first, ties oldest first. Newest: the latest comment first.
  const topLevel = (a: PostCommentWithAuthor, b: PostCommentWithAuthor) => (sort === "new" ? -byTime(a, b) : b.likes - a.likes || byTime(a, b));
  const ids = new Set(comments.map((c) => c.id));
  const children = new Map<string | null, PostCommentWithAuthor[]>();
  for (const c of comments) {
    const key = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
    const list = children.get(key) ?? [];
    list.push(c);
    children.set(key, list);
  }
  const countBelow = (id: string): number => (children.get(id) ?? []).reduce((n, c) => n + 1 + countBelow(c.id), 0);
  const out: PostCommentNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of [...(children.get(parent) ?? [])].sort(depth === 0 ? topLevel : byTime)) {
      out.push({ ...c, depth: Math.min(depth, COMMENT_MAX_DEPTH), replyCount: countBelow(c.id), myVote: myVotes[c.id] ?? 0 });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Your own comment, or any comment on your post. */
export async function deleteComment(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("post_comments").delete().eq("id", id);
  if (error) throw error;
}
