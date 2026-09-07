import type { Client, Media } from "../types/models";

export async function getMedia(supabase: Client, id: string): Promise<Media | null> {
  const { data, error } = await supabase.from("media").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listMyMedia(supabase: Client, ownerId: string): Promise<Media[]> {
  const { data, error } = await supabase.from("media").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Create the media row that a provider upload will fill in. */
export async function createMediaRecord(
  supabase: Client,
  input: { ownerId: string; provider: string; providerUploadId: string; sizeBytes?: number | null },
): Promise<Media> {
  const { data, error } = await supabase
    .from("media")
    .insert({ owner_id: input.ownerId, provider: input.provider, provider_upload_id: input.providerUploadId, size_bytes: input.sizeBytes ?? null, status: "uploading" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateMediaRecord(
  supabase: Client,
  id: string,
  patch: Partial<Pick<Media, "provider_asset_id" | "playback_id" | "status" | "error" | "duration_seconds" | "width" | "height" | "aspect_ratio" | "poster_url">>,
): Promise<Media> {
  const { data, error } = await supabase.from("media").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteMedia(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("media").delete().eq("id", id);
  if (error) throw error;
}
