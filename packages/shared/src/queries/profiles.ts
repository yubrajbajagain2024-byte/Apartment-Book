import { isMissingInDatabase, isMissingRelation, LISTINGS_VISIBILITY_NOT_READY } from "./profile-page";
import type { Client, PosterSummary, Profile, ProfileSummary, ProfileVisibility, ProfileWithUniversity } from "../types/models";

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
    /** The @handle. The database tidies it and explains a refusal ("That username is taken."). */
    username?: string;
    classesVisibility?: ProfileVisibility;
    savedVisibility?: ProfileVisibility;
    likedVisibility?: ProfileVisibility;
    /** Sent only when it changed: a database before migration 37 has no such column. */
    listingsVisibility?: ProfileVisibility;
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
      ...(input.username === undefined ? {} : { username: input.username }),
      ...(input.classesVisibility === undefined ? {} : { classes_visibility: input.classesVisibility }),
      ...(input.savedVisibility === undefined ? {} : { saved_visibility: input.savedVisibility }),
      ...(input.likedVisibility === undefined ? {} : { liked_visibility: input.likedVisibility }),
      ...(input.listingsVisibility === undefined ? {} : { listings_visibility: input.listingsVisibility }),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw input.listingsVisibility !== undefined && isMissingInDatabase(error) ? new Error(LISTINGS_VISIBILITY_NOT_READY) : error;
  return data;
}

/**
 * Show or hide my activity status: the Settings switch, sent only when it is flipped. Since migration 22 this is the
 * only way to show it again (a profile update cannot), so a stale save from an installed old build cannot undo a hide.
 */
export async function setShowActiveStatus(supabase: Client, show: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_show_active_status", { p_show: show });
  if (error) throw error;
}

/**
 * The name part uses the sanitised query; the @handle part comes from the raw query, keeping "_" (usernames may contain
 * it; inside ilike it matches any one character, "_" included) and dropping what or() cannot take.
 */
function nameOrHandle(q: string, raw: string): string {
  const handle = raw.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9._]/g, "");
  return handle ? `full_name.ilike.%${q}%,username.ilike.%${handle}%` : `full_name.ilike.%${q}%`;
}

/** Search people by name or @handle (for starting chats / adding group members). */
export async function searchProfiles(
  supabase: Client,
  query: string,
  opts: { excludeIds?: string[]; limit?: number } = {},
): Promise<ProfileSummary[]> {
  const q = query.replace(/[%_,()"'\\]/g, " ").trim();
  const build = (studentsOnly: boolean) => {
    let request = supabase
      .from("profiles")
      .select(PROFILE_SUMMARY_COLUMNS)
      .order("full_name")
      .limit(opts.limit ?? 10);
    if (q) request = request.or(nameOrHandle(q, query));
    return studentsOnly ? request.not("role", "in", BUSINESS_ROLES_FILTER) : request;
  };
  const { data, error } = await studentsOnly(build);
  if (error) throw error;
  const exclude = new Set(opts.excludeIds ?? []);
  return data.filter((p) => !exclude.has(p.id));
}

/** Business accounts (migration 39) stay out of people search: nobody messages, follows or adds them to groups. */
const BUSINESS_ROLES_FILTER = "(business_owner,business_staff)";
/** The search with that filter; on a database before migration 39 (no role column) the plain one. */
async function studentsOnly<T extends { error: { code?: string } | null }>(build: (studentsOnly: boolean) => PromiseLike<T>): Promise<T> {
  const result = await build(true);
  if (result.error && isMissingRelation(result.error)) return build(false);
  return result;
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
 * The people search (the app's Search button on Home, the website's /search): find accounts by name, like Instagram.
 * With an empty query it lists people (newest first when asked), so it is never blank. Returns enough for an avatar, a name and the verified badge (university domain).
 */
export async function searchPeople(supabase: Client, query: string, opts: PeopleSearchOptions = {}): Promise<PosterSummary[]> {
  const q = query.replace(/[%_,()"'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const exclude = new Set(opts.excludeIds ?? []);
  const build = (onlyStudents: boolean) => {
    let request = supabase
      .from("profiles")
      .select("id, full_name, avatar_url, university:universities(email_domain)")
      .limit((opts.limit ?? 30) + exclude.size);
    if (q) request = request.or(nameOrHandle(q, query));
    if (opts.universityId) request = request.eq("university_id", opts.universityId);
    if (onlyStudents) request = request.not("role", "in", BUSINESS_ROLES_FILTER);
    return opts.sort === "newest" ? request.order("created_at", { ascending: false }) : request.order("full_name");
  };
  const { data, error } = await studentsOnly(build);
  if (error) throw error;
  return (data as unknown as PosterSummary[]).filter((p) => !exclude.has(p.id)).slice(0, opts.limit ?? 30);
}
