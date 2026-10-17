import { FOR_YOU_PAGE } from "../constants";
import { blendForYou, type ForYouItem } from "../for-you";
import type { Client } from "../types/models";
import { listFeedPosts } from "./feed";

export type ForYouFilters = { universityId?: string; page?: number };
export type ForYouPage = { items: ForYouItem[]; page: number; hasMore: boolean };

/**
 * Home → For you: one page of posts and reels, blended. Each kind is paged on its own (page n of posts, page n of
 * reels), then spread with blendForYou, so page n+1 never repeats page n. The feed is over when both kinds have run
 * dry. Buzz threads are never asked for here: they stay on the Buzz tab. Works signed out; `universityId` limits it
 * to one campus.
 */
export async function listForYou(supabase: Client, filters: ForYouFilters = {}): Promise<ForYouPage> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const { universityId } = filters;
  const [posts, reels] = await Promise.all([
    listFeedPosts(supabase, { kind: "post", universityId, page, pageSize: FOR_YOU_PAGE.posts }),
    listFeedPosts(supabase, { kind: "reel", universityId, page, pageSize: FOR_YOU_PAGE.reels }),
  ]);
  return {
    items: blendForYou({ posts: posts.data, reels: reels.data }, FOR_YOU_PAGE),
    page,
    hasMore: page < posts.totalPages || page < reels.totalPages,
  };
}
