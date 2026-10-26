import { DISCOVER_PAGE, normalizeTopic } from "../discover";
import { captionParts } from "../format";
import { listingMedia } from "../media";
import { tileFromFeedPost } from "../profile";
import type { Client, FeedPostWithAuthor, PosterSummary, ProfileTile } from "../types/models";
import { getFeedPostsByIds } from "./feed";
import { FEED_POST_SELECT } from "./feed-select";
import { getPostViewCounts, isMissingInDatabase } from "./profile-page";
import { searchPeople } from "./profiles";

/**
 * The Discover tab (migration 44): what is popular on every campus, and search for people, topics and posts. The
 * rankings live in the database (discover_refresh(), every 10 minutes) and every read obeys the rules on posts and
 * profiles. On a database without migration 44 each read falls back to the newest posts and people, and topics are
 * empty, so the tab still works while the update is on its way.
 */

/** A trending or searched topic: the tag without its "#" and how many posts carry it. */
export type DiscoverTopic = { tag: string; posts: number };
/** An account to follow: what a person row shows, plus the university's name and the follower count (null when unknown). */
export type DiscoverAccount = PosterSummary & { universityName: string | null; followers: number | null };
/** Where the next page of a grid starts: an offset into the ranking, or "newest:<offset>" once it fell back to newest first. */
export type DiscoverCursor = number | string;
export type DiscoverTilePage = { tiles: ProfileTile[]; next: DiscoverCursor | null };

const NEWEST = "newest:";

/** Posts as grid squares, in the order given, with view counts. Posts the reader may not see drop out. No pins here. */
function tilesOf(posts: FeedPostWithAuthor[], views: Record<string, number>): ProfileTile[] {
  return posts.map((p) => ({ ...tileFromFeedPost(p, listingMedia(p.images, p.image_meta, p.videos), views[p.id] ?? 0), pinned: false }));
}

async function viewsOf(supabase: Client, posts: FeedPostWithAuthor[]): Promise<Record<string, number>> {
  return getPostViewCounts(supabase, posts.map((p) => p.id)).catch((): Record<string, number> => ({}));
}

/** Ranked ids → squares in the same order. */
async function tilesInOrder(supabase: Client, ids: string[]): Promise<ProfileTile[]> {
  const posts = await getFeedPostsByIds(supabase, ids);
  const byId = new Map(posts.map((p) => [p.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter((p): p is FeedPostWithAuthor => Boolean(p));
  return tilesOf(ordered, await viewsOf(supabase, ordered));
}

/** A page of the newest posts and reels together (everywhere, or one campus), optionally only those `keep` accepts. */
async function newestTiles(supabase: Client, opts: { universityId?: string | null; offset: number; limit: number; bodyLike?: string; keep?: (p: FeedPostWithAuthor) => boolean }): Promise<DiscoverTilePage> {
  let query = supabase.from("feed_posts").select(FEED_POST_SELECT);
  if (opts.universityId) query = query.eq("university_id", opts.universityId);
  if (opts.bodyLike) query = query.ilike("body", opts.bodyLike);
  const { data, error } = await query.order("created_at", { ascending: false }).range(opts.offset, opts.offset + opts.limit - 1);
  if (error) throw error;
  const rows = data as unknown as FeedPostWithAuthor[];
  const posts = opts.keep ? rows.filter(opts.keep) : rows;
  return { tiles: tilesOf(posts, await viewsOf(supabase, posts)), next: rows.length < opts.limit ? null : `${NEWEST}${opts.offset + opts.limit}` };
}

/** A cursor from a previous page: an offset into the ranking, or one into newest-first. */
function readCursor(cursor: DiscoverCursor | null | undefined): { newest: boolean; offset: number } {
  if (typeof cursor === "string" && cursor.startsWith(NEWEST)) return { newest: true, offset: Math.max(0, Number(cursor.slice(NEWEST.length)) || 0) };
  return { newest: false, offset: typeof cursor === "number" ? Math.max(0, cursor) : 0 };
}

/**
 * Discover's grid: posts and reels from every campus (or `universityId`'s), hottest first. When nothing is ranked (no
 * post in the rankings' 90 days, or a database before migration 44) it shows the newest instead, and keeps paging that way.
 */
export async function listDiscoverTiles(supabase: Client, opts: { universityId?: string | null; cursor?: DiscoverCursor | null; limit?: number } = {}): Promise<DiscoverTilePage> {
  const limit = opts.limit ?? DISCOVER_PAGE.tiles;
  const { newest, offset } = readCursor(opts.cursor);
  if (newest) return newestTiles(supabase, { universityId: opts.universityId, offset, limit });
  const { data, error } = await supabase.rpc("discover_feed", { p_university_id: opts.universityId ?? null, p_limit: limit, p_offset: offset });
  if (error) {
    if (isMissingInDatabase(error)) return newestTiles(supabase, { universityId: opts.universityId, offset, limit });
    throw error;
  }
  const rows = data ?? [];
  if (rows.length === 0 && offset === 0) return newestTiles(supabase, { universityId: opts.universityId, offset: 0, limit });
  return { tiles: await tilesInOrder(supabase, rows.map((r) => r.post_id)), next: rows.length < limit ? null : offset + limit };
}

/**
 * Accounts to follow from every campus (or one): never you, someone you follow or have blocked, or a business. Before
 * migration 44, the newest people instead (without follower counts).
 */
export async function listDiscoverAccounts(supabase: Client, opts: { universityId?: string | null; limit?: number; viewerId?: string | null } = {}): Promise<DiscoverAccount[]> {
  const limit = opts.limit ?? DISCOVER_PAGE.accounts;
  const { data, error } = await supabase.rpc("discover_accounts", { p_university_id: opts.universityId ?? null, p_limit: limit, p_offset: 0 });
  if (error) {
    if (!isMissingInDatabase(error)) throw error;
    const people = await searchPeople(supabase, "", { universityId: opts.universityId ?? undefined, sort: "newest", limit, excludeIds: opts.viewerId ? [opts.viewerId] : [] });
    return people.map((p) => ({ ...p, universityName: null, followers: null }));
  }
  return (data ?? []).map((r) => ({ id: r.id, full_name: r.full_name, avatar_url: r.avatar_url, university: { email_domain: r.email_domain }, universityName: r.university_name, followers: Number(r.followers) }));
}

/** Trending topics, everywhere. None before migration 44. */
export async function listTrendingTopics(supabase: Client, limit: number = DISCOVER_PAGE.topics): Promise<DiscoverTopic[]> {
  const { data, error } = await supabase.rpc("discover_topics", { p_limit: limit });
  if (error) {
    if (isMissingInDatabase(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => ({ tag: r.tag, posts: Number(r.posts) }));
}

/** Topics starting with what was typed ("#" optional), the exact one first. None before migration 44. */
export async function searchTopics(supabase: Client, query: string, limit: number = DISCOVER_PAGE.searchTopics): Promise<DiscoverTopic[]> {
  const q = query.trim().replace(/^#+/, "").slice(0, 60);
  if (!q) return [];
  const { data, error } = await supabase.rpc("discover_search_topics", { p_q: q, p_limit: limit });
  if (error) {
    if (isMissingInDatabase(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => ({ tag: r.tag, posts: Number(r.posts) }));
}

/** What goes inside an ilike pattern: the words, without the characters that mean something to ilike or to or(). */
const likeSafe = (q: string) => q.replace(/[%_,()"'\\]/g, " ").replace(/\s+/g, " ").trim();

/** Posts and reels whose words start with every word typed, hottest first. Before migration 44, the newest containing the text. */
export async function searchPostTiles(supabase: Client, query: string, opts: { cursor?: DiscoverCursor | null; limit?: number } = {}): Promise<DiscoverTilePage> {
  const q = query.trim().slice(0, 80);
  const limit = opts.limit ?? DISCOVER_PAGE.tiles;
  if (!q) return { tiles: [], next: null };
  const { newest, offset } = readCursor(opts.cursor);
  const fallback = () => (likeSafe(q) ? newestTiles(supabase, { offset, limit, bodyLike: `%${likeSafe(q)}%` }) : Promise.resolve({ tiles: [], next: null }));
  if (newest) return fallback();
  const { data, error } = await supabase.rpc("discover_search_posts", { p_q: q, p_limit: limit, p_offset: offset });
  if (error) {
    if (isMissingInDatabase(error)) return fallback();
    throw error;
  }
  const rows = data ?? [];
  return { tiles: await tilesInOrder(supabase, rows.map((r) => r.post_id)), next: rows.length < limit ? null : offset + limit };
}

/** Does this caption carry the tag (as the apps read tags)? For the fallback before migration 44. */
const carries = (body: string, tag: string) => captionParts(body).some((p) => p.tag && p.text.slice(1).toLowerCase() === tag);

/** A topic page's header: the tag and how many posts you can see carry it. Null for something that is not a tag. */
export async function getTopic(supabase: Client, input: string): Promise<DiscoverTopic | null> {
  const tag = normalizeTopic(input);
  if (!tag) return null;
  const { data, error } = await supabase.rpc("discover_topic", { p_tag: tag });
  if (error) {
    if (!isMissingInDatabase(error)) throw error;
    const { data: rows, error: e2 } = await supabase.from("feed_posts").select("body").ilike("body", `%#${likeSafe(tag)}%`).limit(1000);
    if (e2) throw e2;
    return { tag, posts: (rows ?? []).filter((r) => carries(r.body, tag)).length };
  }
  const row = data?.[0];
  return { tag, posts: Number(row?.posts ?? 0) };
}

/** A topic page's grid: its posts and reels, hottest first ("top") or newest first ("recent"). */
export async function listTopicTiles(supabase: Client, input: string, opts: { order?: "top" | "recent"; cursor?: DiscoverCursor | null; limit?: number } = {}): Promise<DiscoverTilePage> {
  const tag = normalizeTopic(input);
  const limit = opts.limit ?? DISCOVER_PAGE.tiles;
  if (!tag) return { tiles: [], next: null };
  const { newest, offset } = readCursor(opts.cursor);
  const fallback = () => newestTiles(supabase, { offset, limit, bodyLike: `%#${likeSafe(tag)}%`, keep: (p) => carries(p.body, tag) });
  if (newest) return fallback();
  const { data, error } = await supabase.rpc("discover_topic_posts", { p_tag: tag, p_order: opts.order ?? "top", p_limit: limit, p_offset: offset });
  if (error) {
    if (isMissingInDatabase(error)) return fallback();
    throw error;
  }
  const rows = data ?? [];
  return { tiles: await tilesInOrder(supabase, rows.map((r) => r.post_id)), next: rows.length < limit ? null : offset + limit };
}
