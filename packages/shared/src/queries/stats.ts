import type { Client, SavedTargetType } from "../types/models";

export type ListingStats = { views: number; saves: number; contacts: number };
export type VideoVsPhotoStats = {
  videoListings: number;
  photoListings: number;
  /** Average messages per listing; null until there is enough data. */
  videoContactRate: number | null;
  photoContactRate: number | null;
  /** How many times more messages video listings get; null until there is enough data. */
  contactMultiplier: number | null;
};

/**
 * Count a view of a listing. Signed-in viewers are deduplicated by user, others
 * by the `viewerKey` the client keeps (one per browser/app install). Once per day.
 */
export async function recordView(supabase: Client, targetType: SavedTargetType, targetId: string, viewerKey?: string | null): Promise<void> {
  const { error } = await supabase.rpc("record_view", { p_target_type: targetType, p_target_id: targetId, p_viewer_key: viewerKey ?? null });
  if (error) throw error;
}

/** Record that the signed-in user started a conversation from a listing. */
export async function recordContact(supabase: Client, targetType: SavedTargetType, targetId: string): Promise<void> {
  const { error } = await supabase.rpc("record_contact", { p_target_type: targetType, p_target_id: targetId });
  if (error) throw error;
}

/** Views, saves and messages for a listing (owner only). */
export async function getListingStats(supabase: Client, targetType: SavedTargetType, targetId: string): Promise<ListingStats> {
  const { data, error } = await supabase.rpc("listing_stats", { p_target_type: targetType, p_target_id: targetId });
  if (error) throw error;
  const row = data?.[0];
  return { views: Number(row?.views ?? 0), saves: Number(row?.saves ?? 0), contacts: Number(row?.contacts ?? 0) };
}

/** Our own numbers on video vs photo-only apartment listings, for the nudge. */
export async function getVideoVsPhotoStats(supabase: Client, minListings = 20): Promise<VideoVsPhotoStats> {
  const { data, error } = await supabase.rpc("video_vs_photo_stats", { p_min: minListings });
  if (error) throw error;
  const row = data?.[0];
  return {
    videoListings: Number(row?.video_listings ?? 0),
    photoListings: Number(row?.photo_listings ?? 0),
    videoContactRate: row?.video_contact_rate ?? null,
    photoContactRate: row?.photo_contact_rate ?? null,
    contactMultiplier: row?.contact_multiplier ?? null,
  };
}
