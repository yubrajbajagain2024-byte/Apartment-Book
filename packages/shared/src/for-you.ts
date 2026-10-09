import type { BuzzPost, FeedPostWithAuthor } from "./types/models";

/**
 * One row of Home → For you: a student's post or reel (identified; a reel is shown like a post with a
 * video), or an anonymous Buzz thread. Reels here are feed posts of kind "reel"; listing video tours
 * stay on the Reels tab.
 */
export type ForYouItem = { type: "post"; post: FeedPostWithAuthor } | { type: "buzz"; post: BuzzPost };

/** Stable key for lists and de-duplication. A post and a Buzz thread can never share one. */
export function forYouKey(item: ForYouItem): string {
  return `${item.type}:${item.post.id}`;
}

export type ForYouSources = { posts: FeedPostWithAuthor[]; buzz: BuzzPost[]; reels: FeedPostWithAuthor[] };
export type ForYouQuotas = { posts: number; buzz: number; reels: number };

/**
 * Spreads Buzz threads and reels evenly between posts. Every list keeps its own order (posts and reels
 * newest first, Buzz by "hot"). Stride scheduling: the next row comes from the kind that is furthest
 * behind its share of the page, measured as (taken + ½) / quota; ties go to posts, then Buzz, then reels.
 * A kind with fewer rows than its share simply runs out and the others fill in. With the default quotas
 * (6 / 3 / 2) a full page reads: post, Buzz, post, reel, post, Buzz, post, post, reel, Buzz, post.
 * Deterministic, so a page looks the same on every device and every reload.
 */
export function blendForYou(sources: ForYouSources, quotas: ForYouQuotas): ForYouItem[] {
  const lanes: { rows: ForYouItem[]; quota: number; taken: number }[] = [
    { rows: sources.posts.map((post) => ({ type: "post", post })), quota: Math.max(1, quotas.posts), taken: 0 },
    { rows: sources.buzz.map((post) => ({ type: "buzz", post })), quota: Math.max(1, quotas.buzz), taken: 0 },
    { rows: sources.reels.map((post) => ({ type: "post", post })), quota: Math.max(1, quotas.reels), taken: 0 },
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
    const key = forYouKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
