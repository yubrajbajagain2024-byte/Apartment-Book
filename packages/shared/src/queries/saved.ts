import type { Client, SavedTargetType } from "../types/models";

export async function getSavedIds(
  supabase: Client,
  userId: string,
  targetType?: SavedTargetType,
): Promise<Set<string>> {
  let query = supabase.from("saved_listings").select("target_id, target_type").eq("user_id", userId);
  if (targetType) query = query.eq("target_type", targetType);
  const { data, error } = await query;
  if (error) throw error;
  return new Set(data.map((row) => row.target_id));
}

export async function listSaved(
  supabase: Client,
  userId: string,
): Promise<{ apartment: string[]; item: string[]; roommate: string[] }> {
  const { data, error } = await supabase
    .from("saved_listings")
    .select("target_id, target_type, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const result = { apartment: [] as string[], item: [] as string[], roommate: [] as string[] };
  for (const row of data) {
    if (row.target_type === "apartment" || row.target_type === "item" || row.target_type === "roommate") {
      result[row.target_type].push(row.target_id);
    }
  }
  return result;
}

export async function isSaved(
  supabase: Client,
  userId: string,
  targetType: SavedTargetType,
  targetId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("saved_listings")
    .select("target_id")
    .eq("user_id", userId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Toggle a bookmark; returns the new saved state. */
export async function toggleSaved(
  supabase: Client,
  userId: string,
  targetType: SavedTargetType,
  targetId: string,
): Promise<boolean> {
  const saved = await isSaved(supabase, userId, targetType, targetId);
  if (saved) {
    const { error } = await supabase
      .from("saved_listings")
      .delete()
      .eq("user_id", userId)
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase
    .from("saved_listings")
    .insert({ user_id: userId, target_type: targetType, target_id: targetId });
  if (error) throw error;
  return true;
}
