import type { FeedPostWithAuthor } from "./types/models";

/**
 * One row of Home → For you: a student's post or reel, both identified. A reel here is a feed post of kind "reel",
 * shown like a post with a video; listing video tours stay on the Reels tab. Anonymous Buzz threads are never part of
 * this feed: they live only on the Buzz tab.
 */
export type ForYouItem = FeedPostWithAuthor;

export type ForYouSources = { posts: FeedPostWithAuthor[]; reels: FeedPostWithAuthor[] };
export type ForYouQuotas = { posts: number; reels: number };

/**
 * Spreads reels evenly between posts. Both lists keep their own order (newest first). Stride scheduling: the next row
 * comes from the kind that is furthest behind its share of the page, measured as (taken + ½) / quota; ties go to posts.
 * A kind with fewer rows than its share simply runs out and the other fills in. With the default quotas (6 / 2) a full
 * page reads: post, post, reel, post, post, post, reel, post. Deterministic, so a page looks the same on every device
 * and every reload.
 */
export function blendForYou(sources: ForYouSources, quotas: ForYouQuotas): ForYouItem[] {
  const lanes: { rows: FeedPostWithAuthor[]; quota: number; taken: number }[] = [
    { rows: sources.posts, quota: Math.max(1, quotas.posts), taken: 0 },
    { rows: sources.reels, quota: Math.max(1, quotas.reels), taken: 0 },
  ];
  const out: ForYouItem[] = [];
  const seen = new Set<string>();
  for (;;) {
    let next: (typeof lanes)[number] | null = null;
    for (const lane of lanes) {
      if (lane.taken >= lane.rows.length) continue;
      if (!next || (lane.taken + 0.5) / lane.quota < (next.taken + 0.5) / next.quota) next = lane;
    }
    if (!next) break;
    const item = next.rows[next.taken++];
    // Posts and reels share one table, so the id alone tells rows apart.
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
