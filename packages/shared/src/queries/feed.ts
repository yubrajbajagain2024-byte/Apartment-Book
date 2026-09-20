import { DEFAULT_PAGE_SIZE, REELS_PAGE_SIZE } from "../constants";
import type { FeedPostInput, ReelInput } from "../schemas";
import type { Client, FeedPost, FeedPostWithAuthor, ListingVideo, Paginated, Reel } from "../types/models";
import type { Json } from "../types/database";
import { pageRange } from "../utils";

export const FEED_POST_SELECT = "*, author:profiles!feed_posts_author_id_fkey(id, full_name, avatar_url, university:universities(email_domain))";

export type FeedPostFilters = {
  /** "post" (default) for the Posts tab; "reel" lists someone's reels on their profile. */
  kind?: "post" | "reel";
  universityId?: string;
  authorId?: string;
  page?: number;
  pageSize?: number;
};

/** Home → Posts: newest first. */
export async function listFeedPosts(supabase: Client, filters: FeedPostFilters = {}): Promise<Paginated<FeedPostWithAuthor>> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const { from, to } = pageRange(page, pageSize);
  let query = supabase.from("feed_posts").select(FEED_POST_SELECT, { count: "exact" }).eq("kind", filters.kind ?? "post");
  if (filters.universityId) query = query.eq("university_id", filters.universityId);
  if (filters.authorId) query = query.eq("author_id", filters.authorId);
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return { data: data as unknown as FeedPostWithAuthor[], count: total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getFeedPost(supabase: Client, id: string): Promise<FeedPostWithAuthor | null> {
  const { data, error } = await supabase.from("feed_posts").select(FEED_POST_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as FeedPostWithAuthor | null;
}

export async function getFeedPostsByIds(supabase: Client, ids: string[]): Promise<FeedPostWithAuthor[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("feed_posts").select(FEED_POST_SELECT).in("id", ids);
  if (error) throw error;
  return data as unknown as FeedPostWithAuthor[];
}

export async function createFeedPost(supabase: Client, authorId: string, input: FeedPostInput): Promise<FeedPost> {
  const { data, error } = await supabase
    .from("feed_posts")
    .insert({
      author_id: authorId,
      kind: "post",
      body: input.body,
      university_id: input.universityId ?? null,
      images: input.images,
      image_meta: input.imageMeta.filter((m) => input.images.includes(m.url)) as unknown as Json,
      videos: input.videos as unknown as Json,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function createReel(supabase: Client, authorId: string, input: ReelInput): Promise<FeedPost> {
  const { data, error } = await supabase
    .from("feed_posts")
    .insert({ author_id: authorId, kind: "reel", body: input.body, university_id: input.universityId ?? null, videos: input.videos as unknown as Json })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFeedPost(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("feed_posts").delete().eq("id", id);
  if (error) throw error;
}

/** Home → Reels: posted reels plus listing video tours, newest first. `offset` = how many you already have. */
export async function listReels(supabase: Client, opts: { universityId?: string; limit?: number; offset?: number } = {}): Promise<Reel[]> {
  const { data, error } = await supabase.rpc("reels_feed", {
    p_university_id: opts.universityId ?? null,
    p_limit: opts.limit ?? REELS_PAGE_SIZE,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.video !== null && typeof r.video === "object")
    .map((r) => ({
      sourceType: r.source_type as Reel["sourceType"],
      sourceId: r.source_id,
      author: { id: r.author_id, name: r.author_name, avatarUrl: r.author_avatar_url, verified: r.author_verified },
      title: r.title,
      caption: r.caption,
      video: r.video as unknown as ListingVideo,
      createdAt: r.created_at,
      likes: Number(r.likes),
      comments: Number(r.comments),
      likedByMe: r.liked_by_me,
      savedByMe: r.saved_by_me,
    }));
}

/** Where a reel's "open" action leads: the post itself, or the listing the tour belongs to. */
export function reelPath(reel: Pick<Reel, "sourceType" | "sourceId">): string {
  return reel.sourceType === "apartment" ? `/apartments/${reel.sourceId}` : reel.sourceType === "roommate" ? `/roommates/${reel.sourceId}` : `/posts/${reel.sourceId}`;
}
