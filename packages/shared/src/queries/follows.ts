import { DEFAULT_PAGE_SIZE } from "../constants";
import type { Client, FeedPostWithAuthor, Paginated, PosterSummary, ProfileSummary } from "../types/models";
import { pageRange } from "../utils";
import { FEED_POST_SELECT } from "./feed";

/** Follower and following counts of one profile, plus the viewer's relationship with it. */
export type FollowStats = { followers: number; following: number; followedByMe: boolean; followsMe: boolean };
export const NO_FOLLOW_STATS: FollowStats = { followers: 0, following: 0, followedByMe: false, followsMe: false };

/** One row of a followers or following list. */
export type FollowListEntry = { profile: PosterSummary; followedAt: string };

/** What a row in a list of people shows: avatar, name and the verified badge (university domain). */
const PERSON_SELECT = "id, full_name, avatar_url, university:universities(email_domain)";
const FOLLOWER_SELECT = `created_at, profile:profiles!follows_follower_id_fkey(${PERSON_SELECT})`;
const FOLLOWING_SELECT = `created_at, profile:profiles!follows_followee_id_fkey(${PERSON_SELECT})`;

/** Start following someone. Following them already is not an error (two taps in a row, two devices). */
export async function followUser(supabase: Client, userId: string, followeeId: string): Promise<void> {
  const { error } = await supabase.from("follows").insert({ follower_id: userId, followee_id: followeeId });
  if (error && error.code !== "23505") throw error;
}

export async function unfollowUser(supabase: Client, userId: string, followeeId: string): Promise<void> {
  const { error } = await supabase.from("follows").delete().eq("follower_id", userId).eq("followee_id", followeeId);
  if (error) throw error;
}

/** Follow or unfollow, returning the fresh numbers for the button and the counts next to it. */
export async function setFollowing(supabase: Client, userId: string, followeeId: string, follow: boolean): Promise<FollowStats> {
  if (follow) await followUser(supabase, userId, followeeId);
  else await unfollowUser(supabase, userId, followeeId);
  return getFollowStats(supabase, followeeId);
}

/** Counts and relationship for many profiles in one request (a feed, a follower list). Ids that came back empty get zeros. */
export async function getFollowStatsMany(supabase: Client, userIds: string[]): Promise<Record<string, FollowStats>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("follow_stats", { p_user_ids: ids });
  if (error) throw error;
  const out: Record<string, FollowStats> = {};
  for (const id of ids) out[id] = NO_FOLLOW_STATS;
  for (const row of data ?? []) out[row.user_id] = { followers: Number(row.followers), following: Number(row.following), followedByMe: row.followed_by_me, followsMe: row.follows_me };
  return out;
}

export async function getFollowStats(supabase: Client, userId: string): Promise<FollowStats> {
  return (await getFollowStatsMany(supabase, [userId]))[userId] ?? NO_FOLLOW_STATS;
}

type FollowRow = { created_at: string; profile: PosterSummary | null };

function toEntries(rows: FollowRow[] | null): FollowListEntry[] {
  return (rows ?? []).flatMap((r) => (r.profile ? [{ profile: r.profile, followedAt: r.created_at }] : []));
}

/**
 * People who follow `userId`, newest first: the owner's own list. Follows are private to the two people in them, so
 * for anyone else the database returns only the rows that involve the viewer; they get listMutualFriends instead.
 */
export async function listFollowers(supabase: Client, userId: string, opts: { page?: number; pageSize?: number } = {}): Promise<Paginated<FollowListEntry>> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const { from, to } = pageRange(page, pageSize);
  const { data, error, count } = await supabase.from("follows").select(FOLLOWER_SELECT, { count: "exact" }).eq("followee_id", userId).order("created_at", { ascending: false }).range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return { data: toEntries(data as unknown as FollowRow[]), count: total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** People `userId` follows, newest first: the owner's own list, private like listFollowers. */
export async function listFollowing(supabase: Client, userId: string, opts: { page?: number; pageSize?: number } = {}): Promise<Paginated<FollowListEntry>> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const { from, to } = pageRange(page, pageSize);
  const { data, error, count } = await supabase.from("follows").select(FOLLOWING_SELECT, { count: "exact" }).eq("follower_id", userId).order("created_at", { ascending: false }).range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return { data: toEntries(data as unknown as FollowRow[]), count: total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Home → Posts → "Following": posts (or reels) by the people the signed-in user follows, newest first.
 * Goes through the following_posts() function so the author is embedded like the plain feed; signed out it is empty.
 */
export async function listFollowingPosts(supabase: Client, filters: { kind?: "post" | "reel"; universityId?: string; page?: number; pageSize?: number } = {}): Promise<Paginated<FeedPostWithAuthor>> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const { from, to } = pageRange(page, pageSize);
  const { data, error, count } = await supabase
    .rpc("following_posts", { p_kind: filters.kind ?? "post", p_university_id: filters.universityId ?? null }, { count: "exact" })
    .select(FEED_POST_SELECT)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return { data: data as unknown as FeedPostWithAuthor[], count: total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Behind the Followers and Following counts on someone else's profile: the friends (people who follow each other) the
 * signed-in viewer and `userId` have in common, by name. Empty signed out, on your own profile and when the two of you
 * are blocked either way; the database decides who is listed (the mutual_friends() function).
 */
export async function listMutualFriends(supabase: Client, userId: string, opts: { page?: number; pageSize?: number } = {}): Promise<Paginated<PosterSummary>> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const { from, to } = pageRange(page, pageSize);
  const { data, error, count } = await supabase
    .rpc("mutual_friends", { p_user_id: userId }, { count: "exact" })
    .select(PERSON_SELECT)
    .order("full_name")
    .order("id")
    .range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return { data: (data ?? []) as unknown as PosterSummary[], count: total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Friends = the people you follow who follow you back (blocks excluded), by name; `q` narrows by name. Signed out: none. */
export async function listFriends(supabase: Client, q?: string): Promise<ProfileSummary[]> {
  const { data, error } = await supabase.rpc("list_friends", { p_q: q?.trim() ? q.trim() : null }).select("id, full_name, avatar_url");
  if (error) throw error;
  return (data ?? []) as ProfileSummary[];
}
