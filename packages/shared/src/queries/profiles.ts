import type { Client, PosterSummary, Profile, ProfileSummary, ProfileWithUniversity } from "../types/models";

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
    showActiveStatus?: boolean;
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
      ...(input.showActiveStatus === undefined ? {} : { show_active_status: input.showActiveStatus }),
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

export type PeopleSearchOptions = {
  /** Only people at this university; default everyone. */
  universityId?: string;
  /** Leave out the viewer, people already in a list, and so on. */
  excludeIds?: string[];
  /** "name" (default) for a search box; "newest" for a "people to follow" list when the box is empty. */
  sort?: "name" | "newest";
  limit?: number;
};

/**
 * The Search tab: find accounts by name, like Instagram. With an empty query it lists people (newest first when
 * asked), so the tab is never blank. Returns enough for an avatar, a name and the verified badge (university domain).
 */
export async function searchPeople(supabase: Client, query: string, opts: PeopleSearchOptions = {}): Promise<PosterSummary[]> {
  const q = query.replace(/[%_,()"'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const exclude = new Set(opts.excludeIds ?? []);
  let request = supabase
    .from("profiles")
    .select("id, full_name, avatar_url, university:universities(email_domain)")
    .limit((opts.limit ?? 30) + exclude.size);
  if (q) request = request.ilike("full_name", `%${q}%`);
  if (opts.universityId) request = request.eq("university_id", opts.universityId);
  request = opts.sort === "newest" ? request.order("created_at", { ascending: false }) : request.order("full_name");
  const { data, error } = await request;
  if (error) throw error;
  return (data as unknown as PosterSummary[]).filter((p) => !exclude.has(p.id)).slice(0, opts.limit ?? 30);
}
