import { listingMedia } from "../media";
import { normalizeClassCode, tileFromFeedPost, tileFromListing } from "../profile";
import type { Client, FeedPostWithAuthor, Paginated, ProfileClass, ProfileSection, ProfileSectionAccess, ProfileStats, ProfileTile, ProfileVisibility } from "../types/models";
import { pageRange } from "../utils";
import { getApartmentsByIds, listApartmentsByOwner } from "./apartments";
import { FEED_POST_SELECT, getFeedPostsByIds } from "./feed";
import { getItemsByIds, listItemsBySeller } from "./items";
import { getRoommatePostsByIds, listRoommatePostsByAuthor } from "./roommates";

/** Squares per page in the Posts and Reels grids (six rows of three). */
export const PROFILE_GRID_PAGE_SIZE = 18;
/** Squares per page in the Saved and Liked grids. */
export const PROFILE_LIST_PAGE_SIZE = 30;

/** Posts, reels and every like received. Nothing for people who blocked each other. */
export async function getProfileStats(supabase: Client, userId: string): Promise<ProfileStats> {
  const { data, error } = await supabase.rpc("profile_stats", { p_user_id: userId });
  if (error) throw error;
  const row = data?.[0];
  return { posts: Number(row?.posts ?? 0), reels: Number(row?.reels ?? 0), likesReceived: Number(row?.likes_received ?? 0) };
}

/** Which of Classes, Saved and Liked the signed-in person (or a signed-out visitor) may open. */
export async function getProfileSectionAccess(supabase: Client, ownerId: string): Promise<ProfileSectionAccess> {
  const { data, error } = await supabase.rpc("profile_section_access", { p_owner: ownerId });
  if (error) throw error;
  const row = data?.[0];
  return { classes: Boolean(row?.classes), saved: Boolean(row?.saved), liked: Boolean(row?.liked) };
}

/** Owner only: who can see one of the tabs. */
export async function setProfileVisibility(supabase: Client, userId: string, section: ProfileSection, value: ProfileVisibility): Promise<void> {
  const patch =
    section === "classes" ? { classes_visibility: value } : section === "saved" ? { saved_visibility: value } : { liked_visibility: value };
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// Classes
// -----------------------------------------------------------------------------
/** Someone's classes, as far as their setting lets the reader see them (none otherwise). */
export async function listProfileClasses(supabase: Client, userId: string): Promise<ProfileClass[]> {
  const { data, error } = await supabase.from("profile_classes").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addProfileClass(supabase: Client, userId: string, input: { term: string; code: string; title?: string | null }): Promise<ProfileClass> {
  const { data, error } = await supabase
    .from("profile_classes")
    .insert({ user_id: userId, term: input.term, code: normalizeClassCode(input.code), title: input.title?.trim() || null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function removeProfileClass(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("profile_classes").delete().eq("id", id);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// Posts and Reels grids
// -----------------------------------------------------------------------------
/** Someone's posts or reels for their profile: pinned ones first (latest pin on top), then newest. */
export async function listProfileFeedPosts(supabase: Client, userId: string, opts: { kind: "post" | "reel"; page?: number; pageSize?: number }): Promise<Paginated<FeedPostWithAuthor>> {
  const pageSize = opts.pageSize ?? PROFILE_GRID_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const { from, to } = pageRange(page, pageSize);
  const { data, error, count } = await supabase
    .from("feed_posts")
    .select(FEED_POST_SELECT, { count: "exact" })
    .eq("author_id", userId)
    .eq("kind", opts.kind)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return { data: data as unknown as FeedPostWithAuthor[], count: total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** How many people viewed each post or reel. */
export async function getPostViewCounts(supabase: Client, postIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (postIds.length === 0) return out;
  const { data, error } = await supabase.rpc("post_view_counts", { p_target_type: "post", p_target_ids: postIds });
  if (error) throw error;
  for (const row of data ?? []) out[row.target_id] = Number(row.views);
  return out;
}

/** One page of the Posts or Reels grid, with view counts. */
export async function listProfilePostTiles(supabase: Client, userId: string, kind: "post" | "reel", page = 1): Promise<{ tiles: ProfileTile[]; total: number; hasMore: boolean }> {
  const result = await listProfileFeedPosts(supabase, userId, { kind, page });
  const views = await getPostViewCounts(supabase, result.data.map((p) => p.id)).catch((): Record<string, number> => ({}));
  const tiles = result.data.map((p) => tileFromFeedPost(p, listingMedia(p.images, p.image_meta, p.videos), views[p.id] ?? 0));
  return { tiles, total: result.count, hasMore: page < result.totalPages };
}

/** Pin a post or reel to the top of your profile (three at most; the database says so), or unpin it. */
export async function setPostPinned(supabase: Client, postId: string, pinned: boolean): Promise<void> {
  const { data, error } = await supabase
    .from("feed_posts")
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq("id", postId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Only the author can pin this post.");
}

// -----------------------------------------------------------------------------
// Saved and Liked grids
// -----------------------------------------------------------------------------
type TargetRow = { target_type: string; target_id: string; created_at: string };

/** Turns saved or liked rows into grid squares in the same order. Things the reader may no longer see drop out. */
async function tilesForTargets(supabase: Client, rows: TargetRow[]): Promise<ProfileTile[]> {
  const ids = (type: string) => rows.filter((r) => r.target_type === type).map((r) => r.target_id);
  const [posts, apartments, roommates, items] = await Promise.all([
    getFeedPostsByIds(supabase, ids("post")),
    getApartmentsByIds(supabase, ids("apartment")),
    getRoommatePostsByIds(supabase, ids("roommate")),
    getItemsByIds(supabase, ids("item")),
  ]);
  const views = await getPostViewCounts(supabase, posts.map((p) => p.id)).catch((): Record<string, number> => ({}));
  const byKey = new Map<string, ProfileTile>();
  for (const p of posts) byKey.set(`post:${p.id}`, tileFromFeedPost(p, listingMedia(p.images, p.image_meta, p.videos), views[p.id] ?? 0));
  for (const a of apartments) byKey.set(`apartment:${a.id}`, tileFromListing("apartment", a, listingMedia(a.images, a.image_meta, a.videos)));
  for (const r of roommates) byKey.set(`roommate:${r.id}`, tileFromListing("roommate", r, listingMedia(r.images, r.image_meta, r.videos)));
  for (const i of items) byKey.set(`item:${i.id}`, tileFromListing("item", i, listingMedia(i.images, i.image_meta)));
  return rows.map((r) => byKey.get(`${r.target_type}:${r.target_id}`)).filter((t): t is ProfileTile => Boolean(t));
}

async function listProfileTargets(
  supabase: Client,
  fn: "profile_saved_items" | "profile_liked_items",
  userId: string,
  opts: { before?: string | null; limit?: number },
): Promise<{ tiles: ProfileTile[]; next: string | null }> {
  const limit = opts.limit ?? PROFILE_LIST_PAGE_SIZE;
  const { data, error } = await supabase.rpc(fn, { p_user_id: userId, p_limit: limit, p_before: opts.before ?? null });
  if (error) throw error;
  const rows = (data ?? []) as TargetRow[];
  return { tiles: await tilesForTargets(supabase, rows), next: rows.length === limit ? rows[rows.length - 1].created_at : null };
}

/** What someone saved, newest first, if their setting lets the reader see it (an error says the list is private). */
export async function listProfileSaved(supabase: Client, userId: string, opts: { before?: string | null; limit?: number } = {}) {
  return listProfileTargets(supabase, "profile_saved_items", userId, opts);
}

/** What someone liked, newest first, if their setting lets the reader see it (an error says the list is private). */
export async function listProfileLiked(supabase: Client, userId: string, opts: { before?: string | null; limit?: number } = {}) {
  return listProfileTargets(supabase, "profile_liked_items", userId, opts);
}

// -----------------------------------------------------------------------------
// Listings row
// -----------------------------------------------------------------------------
/** Someone's live apartments, roommate posts and items, newest first, for the Listings row on their profile. */
export async function listProfileListings(supabase: Client, userId: string): Promise<ProfileTile[]> {
  const [apartments, roommates, items] = await Promise.all([
    listApartmentsByOwner(supabase, userId),
    listRoommatePostsByAuthor(supabase, userId),
    listItemsBySeller(supabase, userId),
  ]);
  const dated = [
    ...apartments.map((a) => ({ at: a.created_at, tile: tileFromListing("apartment", a, listingMedia(a.images, a.image_meta, a.videos)) })),
    ...roommates.map((r) => ({ at: r.created_at, tile: tileFromListing("roommate", r, listingMedia(r.images, r.image_meta, r.videos)) })),
    ...items.map((i) => ({ at: i.created_at, tile: tileFromListing("item", i, listingMedia(i.images, i.image_meta)) })),
  ];
  return dated.sort((a, b) => b.at.localeCompare(a.at)).map((d) => d.tile);
}
