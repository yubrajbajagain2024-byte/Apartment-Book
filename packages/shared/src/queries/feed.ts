import { DEFAULT_PAGE_SIZE, DEFAULT_POST_AUDIENCE, REELS_PAGE_SIZE, type PostAudience } from "../constants";
import type { FeedPostInput, ReelInput } from "../schemas";
import type { Client, FeedPost, FeedPostWithAuthor, ListingVideo, Paginated, Reel } from "../types/models";
import type { Json } from "../types/database";
import { pageRange } from "../utils";
import { FEED_POST_SELECT } from "./feed-select";
import { listFollowingPosts } from "./follows";

export { FEED_POST_SELECT };

export type FeedPostFilters = {
  /** "post" (default) for the Posts tab; "reel" lists someone's reels on their profile. */
  kind?: "post" | "reel";
  universityId?: string;
  authorId?: string;
  /** Only posts by the people the signed-in user follows (Home → Posts → "Following"). Ignored when `authorId` is set. */
  following?: boolean;
  page?: number;
  pageSize?: number;
};

/** Home → Posts: newest first. With `following`, only the people you follow (see listFollowingPosts). */
export async function listFeedPosts(supabase: Client, filters: FeedPostFilters = {}): Promise<Paginated<FeedPostWithAuthor>> {
  if (filters.following && !filters.authorId) return listFollowingPosts(supabase, filters);
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

/** Said when a post asks for a title, link, audience or comment setting the database cannot store yet (before migration 44). */
export const POST_DETAILS_UNAVAILABLE = "Titles, links, audience and comment settings are not on yet. Leave them as they are to post now.";

/**
 * The composer's extra settings as columns, only those that differ from a plain post: a post without them inserts the
 * same row as before migration 44, so posting keeps working on a database that does not have it yet.
 */
function postDetailColumns(input: Pick<FeedPostInput, "title" | "linkUrl" | "audience" | "commentsOff">) {
  return {
    ...(input.title ? { title: input.title } : {}),
    ...(input.linkUrl ? { link_url: input.linkUrl } : {}),
    ...(input.audience && input.audience !== DEFAULT_POST_AUDIENCE ? { audience: input.audience } : {}),
    ...(input.commentsOff ? { comments_off: true } : {}),
  };
}

/** PostgREST's "column not in the schema cache" (PGRST204) or Postgres's undefined column (42703): migration 44 is missing. */
function missingDetailColumns(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

const detailsSupport = new WeakMap<Client, Promise<boolean>>();

/**
 * Whether this database stores titles, links, audience and comment settings (migration 44). Asked once per client: a
 * select of those columns that reads no rows. The composer offers the settings only when it answers true.
 */
export function postDetailsAvailable(supabase: Client): Promise<boolean> {
  let known = detailsSupport.get(supabase);
  if (!known) {
    known = Promise.resolve(supabase.from("feed_posts").select("title, link_url, audience, comments_off").limit(0)).then(
      ({ error }) => !error,
      () => false,
    );
    // A network failure is not an answer: ask again next time.
    known.then((ok) => {
      if (!ok) detailsSupport.delete(supabase);
    });
    detailsSupport.set(supabase, known);
  }
  return known;
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
      ...postDetailColumns(input),
    })
    .select("*")
    .single();
  if (missingDetailColumns(error)) throw new Error(POST_DETAILS_UNAVAILABLE);
  if (error) throw error;
  return withViewers(supabase, data, input);
}

export async function createReel(supabase: Client, authorId: string, input: ReelInput): Promise<FeedPost> {
  const { data, error } = await supabase
    .from("feed_posts")
    .insert({ author_id: authorId, kind: "reel", body: input.body, university_id: input.universityId ?? null, videos: input.videos as unknown as Json, ...postDetailColumns(input) })
    .select("*")
    .single();
  if (missingDetailColumns(error)) throw new Error(POST_DETAILS_UNAVAILABLE);
  if (error) throw error;
  return withViewers(supabase, data, input);
}

/**
 * A "Selected people" post is created seen by nobody but its author, then given its people. If that second step fails
 * the post is deleted again, so it is never left up for an audience other than the one chosen.
 */
async function withViewers(supabase: Client, post: FeedPost, input: Pick<FeedPostInput, "audience" | "viewerIds">): Promise<FeedPost> {
  if (input.audience !== "selected") return post;
  try {
    // The database leaves out anyone blocked either way: a list left with nobody would show the post to no one.
    const kept = await setPostViewers(supabase, post.id, input.viewerIds);
    if (kept === 0) throw new Error("None of the people you chose can see your posts. Choose someone else.");
  } catch (e) {
    await supabase.from("feed_posts").delete().eq("id", post.id);
    throw e;
  }
  return post;
}

/**
 * Who a "Selected people" post is shown to (set by its author; at most MAX_POST_VIEWERS people), replacing any earlier
 * list. Returns how many were kept: people blocked either way with the author are left out.
 */
export async function setPostViewers(supabase: Client, postId: string, userIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc("set_post_viewers", { p_post_id: postId, p_user_ids: [...new Set(userIds)] });
  if (error) throw error;
  return typeof data === "number" ? data : userIds.length;
}

export async function deleteFeedPost(supabase: Client, id: string): Promise<void> {
  const { data, error } = await supabase.from("feed_posts").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("You can only delete your own posts.");
}

/** Home → Reels: posted reels plus listing video tours, newest first. `offset` = how many you already have. */
export async function listReels(supabase: Client, opts: { universityId?: string; limit?: number; offset?: number } = {}): Promise<Reel[]> {
  const { data, error } = await supabase.rpc("reels_feed", {
    p_university_id: opts.universityId ?? null,
    p_limit: opts.limit ?? REELS_PAGE_SIZE,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  const reels: Reel[] = (data ?? [])
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
      link: null,
    }));
  return withPostDetails(supabase, reels);
}

/**
 * reels_feed() returns no title or link for a posted reel: they are read here, in one select of the page's posted reels
 * (through the feed_posts policies, like the feed). On a database without migration 44 the reels come back as they were.
 */
async function withPostDetails(supabase: Client, reels: Reel[]): Promise<Reel[]> {
  const ids = reels.filter((r) => r.sourceType === "post").map((r) => r.sourceId);
  if (ids.length === 0) return reels;
  const { data, error } = await supabase.from("feed_posts").select("id, title, link_url, audience, comments_off").in("id", ids);
  if (error || !data) return reels;
  type Details = { id: string; title: string | null; link_url: string | null; audience: PostAudience; comments_off: boolean };
  const details = new Map((data as unknown as Details[]).map((d) => [d.id, d]));
  return reels.map((r) => {
    const d = r.sourceType === "post" ? details.get(r.sourceId) : undefined;
    return d ? { ...r, title: d.title ?? null, link: d.link_url ?? null, audience: d.audience, commentsOff: d.comments_off } : r;
  });
}

/** Where a reel's "open" action leads: the post itself, or the listing the tour belongs to. */
export function reelPath(reel: Pick<Reel, "sourceType" | "sourceId">): string {
  return reel.sourceType === "apartment" ? `/apartments/${reel.sourceId}` : reel.sourceType === "roommate" ? `/roommates/${reel.sourceId}` : `/posts/${reel.sourceId}`;
}
