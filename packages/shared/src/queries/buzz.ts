import { BUZZ_PAGE_SIZE } from "../constants";
import type { BuzzPostInput } from "../schemas";
import type { BuzzComment, BuzzPost, BuzzSort, BuzzTopic, Client } from "../types/models";
import type { Json } from "../types/database";

/**
 * Buzz is anonymous. Other people's threads and replies are only reachable
 * through the `buzz_*` database functions, which never return who wrote them.
 * Do not add queries that select from `buzz_posts` / `buzz_comments` for
 * anyone but the signed-in user: row-level security returns nothing anyway.
 */

type BuzzRow = {
  id: string;
  topic: string;
  title: string;
  body: string;
  images: string[];
  image_meta: Json;
  videos: Json;
  university_id: string | null;
  score: number;
  comment_count: number;
  created_at: string;
  my_vote: number;
  is_mine: boolean;
  alias: string;
};

function toBuzzPost(r: BuzzRow): BuzzPost {
  return {
    id: r.id,
    topic: r.topic as BuzzTopic,
    title: r.title,
    body: r.body,
    images: r.images ?? [],
    imageMeta: r.image_meta,
    videos: r.videos,
    universityId: r.university_id,
    score: r.score,
    commentCount: r.comment_count,
    createdAt: r.created_at,
    myVote: (r.my_vote > 0 ? 1 : r.my_vote < 0 ? -1 : 0) as -1 | 0 | 1,
    isMine: r.is_mine,
    alias: r.alias,
  };
}

export type BuzzFilters = { universityId?: string; topic?: BuzzTopic; sort?: BuzzSort; q?: string; limit?: number; offset?: number };

/** Home → Buzz. `offset` = how many you already have; a short page means the end. */
export async function listBuzz(supabase: Client, filters: BuzzFilters = {}): Promise<BuzzPost[]> {
  const { data, error } = await supabase.rpc("buzz_feed", {
    p_university_id: filters.universityId ?? null,
    p_topic: filters.topic ?? null,
    p_sort: filters.sort ?? "hot",
    p_limit: filters.limit ?? BUZZ_PAGE_SIZE,
    p_offset: filters.offset ?? 0,
    p_q: filters.q?.trim() || null,
  });
  if (error) throw error;
  return (data ?? []).map(toBuzzPost);
}

export async function getBuzz(supabase: Client, id: string): Promise<BuzzPost | null> {
  const { data, error } = await supabase.rpc("buzz_get", { p_id: id });
  if (error) throw error;
  const row = data?.[0];
  return row ? toBuzzPost(row) : null;
}

/** Post anonymously. Returns the new thread's id. Upload photos with `kind: "buzz"` after re-encoding them. */
export async function createBuzz(supabase: Client, userId: string, input: BuzzPostInput): Promise<string> {
  const { data, error } = await supabase
    .from("buzz_posts")
    .insert({
      author_id: userId,
      topic: input.topic,
      title: input.title,
      body: input.body,
      university_id: input.universityId ?? null,
      images: input.images,
      image_meta: input.imageMeta.filter((m) => input.images.includes(m.url)) as unknown as Json,
      videos: input.videos as unknown as Json,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Only works on your own threads. */
export async function deleteBuzz(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("buzz_posts").delete().eq("id", id);
  if (error) throw error;
}

/** 1 = upvote, -1 = downvote, 0 = clear. Returns the fresh score and your vote. */
export async function voteBuzz(supabase: Client, postId: string, value: -1 | 0 | 1): Promise<{ score: number; myVote: -1 | 0 | 1 }> {
  const { data, error } = await supabase.rpc("buzz_vote", { p_post_id: postId, p_value: value });
  if (error) throw error;
  const row = data?.[0];
  return { score: row?.score ?? 0, myVote: ((row?.my_vote ?? 0) > 0 ? 1 : (row?.my_vote ?? 0) < 0 ? -1 : 0) as -1 | 0 | 1 };
}

export async function listBuzzComments(supabase: Client, postId: string): Promise<BuzzComment[]> {
  const { data, error } = await supabase.rpc("buzz_comments_list", { p_post_id: postId });
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, parentId: c.parent_id, body: c.body, createdAt: c.created_at, alias: c.alias, isOp: c.is_op, isMine: c.is_mine }));
}

/** Reply anonymously. Re-fetch the list afterwards to get the reply with its alias. */
export async function addBuzzComment(supabase: Client, userId: string, postId: string, body: string, parentId?: string | null): Promise<void> {
  const { error } = await supabase.from("buzz_comments").insert({ post_id: postId, author_id: userId, body, parent_id: parentId ?? null });
  if (error) throw error;
}

/** Your own reply, or any reply on your thread. */
export async function deleteBuzzComment(supabase: Client, commentId: string): Promise<void> {
  const { error } = await supabase.rpc("buzz_delete_comment", { p_comment_id: commentId });
  if (error) throw error;
}

/** "Hide everything from this person" without learning who they are. Pass the thread or the reply. */
export async function muteBuzzAuthor(supabase: Client, target: { postId: string } | { commentId: string }): Promise<void> {
  const { error } = await supabase.rpc("buzz_mute", "postId" in target ? { p_post_id: target.postId } : { p_comment_id: target.commentId });
  if (error) throw error;
}
