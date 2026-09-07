import { muxPosterUrl, updateMediaRecord, type Client, type Media } from "@apartment-book/shared";
import { getAsset, getUpload, type MuxAsset } from "@/lib/mux";

function assetPatch(asset: MuxAsset) {
  const playback = asset.playback_ids?.find((p) => p.policy === "public")?.id ?? null;
  const video = asset.tracks?.find((t) => t.type === "video");
  if (asset.status === "ready" && playback) {
    return {
      status: "ready" as const,
      provider_asset_id: asset.id,
      playback_id: playback,
      duration_seconds: asset.duration ?? null,
      width: video?.max_width ?? null,
      height: video?.max_height ?? null,
      aspect_ratio: asset.aspect_ratio ?? null,
      poster_url: muxPosterUrl(playback),
      error: null,
    };
  }
  if (asset.status === "errored") {
    return { status: "failed" as const, provider_asset_id: asset.id, error: asset.errors?.messages?.join("; ") ?? "Video could not be processed" };
  }
  return { status: "processing" as const, provider_asset_id: asset.id };
}

/** Ask the provider how the video is doing and store the answer. */
export async function syncMediaStatus(supabase: Client, media: Media): Promise<Media> {
  if (media.status === "ready" || media.status === "failed") return media;
  if (media.provider_asset_id) {
    const asset = await getAsset(media.provider_asset_id);
    return updateMediaRecord(supabase, media.id, assetPatch(asset));
  }
  if (media.provider_upload_id) {
    const upload = await getUpload(media.provider_upload_id);
    if (upload.status === "asset_created" && upload.asset_id) {
      const asset = await getAsset(upload.asset_id);
      return updateMediaRecord(supabase, media.id, assetPatch(asset));
    }
    if (upload.status === "errored" || upload.status === "cancelled" || upload.status === "timed_out") {
      return updateMediaRecord(supabase, media.id, { status: "failed", error: upload.error?.message ?? `Upload ${upload.status}` });
    }
  }
  return media;
}
