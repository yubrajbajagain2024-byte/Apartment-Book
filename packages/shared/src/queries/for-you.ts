import { FOR_YOU_PAGE } from "../constants";
import { blendForYou, type ForYouItem } from "../for-you";
import type { Client } from "../types/models";
import { listBuzz } from "./buzz";
import { listFeedPosts } from "./feed";

export type ForYouFilters = { universityId?: string; page?: number };
export type ForYouPage = { items: ForYouItem[]; page: number; hasMore: boolean };

/**
 * Home → For you: one page of posts, reels and hot Buzz threads, blended. Each kind is paged on its own
 * (page n of posts, page n of reels, Buzz rows (n-1)·quota onwards), then spread with blendForYou, so
 * page n+1 never repeats page n. The feed is over when every kind has run dry. Works signed out;
 * `universityId` limits it to one campus (Buzz threads without a campus show up everywhere).
 */
export async function listForYou(supabase: Client, filters: ForYouFilters = {}): Promise<ForYouPage> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const { universityId } = filters;
  const [posts, reels, buzz] = await Promise.all([
    listFeedPosts(supabase, { kind: "post", universityId, page, pageSize: FOR_YOU_PAGE.posts }),
    listFeedPosts(supabase, { kind: "reel", universityId, page, pageSize: FOR_YOU_PAGE.reels }),
    listBuzz(supabase, { universityId, sort: "hot", limit: FOR_YOU_PAGE.buzz, offset: (page - 1) * FOR_YOU_PAGE.buzz }),
  ]);
  return {
    items: blendForYou({ posts: posts.data, buzz, reels: reels.data }, FOR_YOU_PAGE),
    page,
    hasMore: page < posts.totalPages || page < reels.totalPages || buzz.length >= FOR_YOU_PAGE.buzz,
  };
}
