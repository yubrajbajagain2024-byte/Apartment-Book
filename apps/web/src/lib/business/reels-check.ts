import "server-only";
import { getAd, isVerticalVideo, mediaItems } from "@apartment-book/shared";
import { getAsset } from "@/lib/mux";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Before a Reels ad is approved, the video's size as the provider reports it: it must be taller than it is wide. Null
 * when it is, or when the provider cannot be asked (no credentials here: the reviewer looks at the video). Shared by
 * the portal's admin pages and the staff console, which both approve ads; call it only after checking the caller is
 * an admin.
 */
export async function reelsVideoProblem(adId: string): Promise<string | null> {
  const supabase = await createClient();
  const ad = await getAd(supabase, adId);
  if (!ad || !ad.placements.includes("reels")) return null;
  const video = mediaItems(ad.media).find((m) => m.type === "video");
  if (!video || video.type !== "video") return "Reels needs one vertical video.";
  // The media row is its uploader's alone to read (migration 11): the server's key reads it, after the admin check.
  const admin = createAdminClient();
  if (!admin) return null;
  const { data: media } = await admin.from("media").select("provider_asset_id").eq("id", video.media_id).maybeSingle();
  if (!media?.provider_asset_id) return null;
  try {
    const asset = await getAsset(media.provider_asset_id);
    const track = asset.tracks?.find((t) => t.type === "video");
    if (track && !isVerticalVideo({ width: track.max_width ?? null, height: track.max_height ?? null })) {
      return `The video is ${track.max_width}×${track.max_height}: Reels needs a vertical one. Reject the ad and ask for a vertical video.`;
    }
  } catch {
    return null;
  }
  return null;
}
