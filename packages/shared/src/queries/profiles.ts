import type { Client, Profile, ProfileSummary, ProfileWithUniversity } from "../types/models";

export const PROFILE_SUMMARY_COLUMNS = "id, full_name, avatar_url";

export async function getProfile(supabase: Client, id: string): Promise<ProfileWithUniversity | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*, university:universities(id, name, latitude, longitude, email_domain)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  supabase: Client,
  id: string,
  input: {
    fullName: string;
    universityId?: string | null;
    program?: string | null;
    graduationYear?: number | null;
    bio?: string | null;
    avatarUrl?: string | null;
    notifyNearbyListings?: boolean;
  },
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName,
      university_id: input.universityId ?? null,
      program: input.program ?? null,
      graduation_year: input.graduationYear ?? null,
      bio: input.bio ?? null,
      avatar_url: input.avatarUrl ?? null,
      ...(input.notifyNearbyListings === undefined ? {} : { notify_nearby_listings: input.notifyNearbyListings }),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Search people by name (for starting chats / adding group members). */
export async function searchProfiles(
  supabase: Client,
  query: string,
  opts: { excludeIds?: string[]; limit?: number } = {},
): Promise<ProfileSummary[]> {
  const q = query.replace(/[%_,()"'\\]/g, " ").trim();
  let request = supabase
    .from("profiles")
    .select(PROFILE_SUMMARY_COLUMNS)
    .order("full_name")
    .limit(opts.limit ?? 10);
  if (q) request = request.ilike("full_name", `%${q}%`);
  const { data, error } = await request;
  if (error) throw error;
  const exclude = new Set(opts.excludeIds ?? []);
  return data.filter((p) => !exclude.has(p.id));
}
