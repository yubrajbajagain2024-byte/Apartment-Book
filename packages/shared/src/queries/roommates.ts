import { DEFAULT_PAGE_SIZE } from "../constants";
import type { RoommatePostInput } from "../schemas";
import type {
  Client,
  GenderPref,
  Paginated,
  RoommatePost,
  RoommatePostType,
  RoommatePostWithAuthor,
} from "../types/models";
import { pageRange, sanitizeSearch, searchOrFilter } from "../utils";

export const ROOMMATE_SELECT =
  "*, author:profiles!roommate_posts_author_id_fkey(id, full_name, avatar_url), university:universities(id, name, latitude, longitude)";

export type RoommateFilters = {
  q?: string;
  universityId?: string;
  postType?: RoommatePostType;
  maxBudget?: number;
  genderPreference?: GenderPref;
  /** Only posts pinned within this many kilometres of the university's campus (needs universityId). */
  radiusKm?: number;
  page?: number;
  pageSize?: number;
};

export async function listRoommatePosts(
  supabase: Client,
  filters: RoommateFilters = {},
): Promise<Paginated<RoommatePostWithAuthor>> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const { from, to } = pageRange(page, pageSize);

  const fromTable = supabase.from("roommate_posts").select(ROOMMATE_SELECT, { count: "exact" });
  const withinRadius = filters.radiusKm !== undefined && filters.radiusKm > 0 && filters.universityId;
  let query = withinRadius
    ? (supabase
        .rpc("roommate_posts_within", { p_university_id: filters.universityId as string, p_radius_m: (filters.radiusKm as number) * 1000 }, { count: "exact" })
        .select(ROOMMATE_SELECT) as unknown as typeof fromTable)
    : fromTable;
  query = query.eq("is_active", true);

  if (filters.universityId && !withinRadius) query = query.eq("university_id", filters.universityId);
  if (filters.postType) query = query.eq("post_type", filters.postType);
  if (filters.maxBudget !== undefined) query = query.lte("budget_max", filters.maxBudget);
  if (filters.genderPreference && filters.genderPreference !== "any") {
    query = query.in("gender_preference", ["any", filters.genderPreference]);
  }

  const q = sanitizeSearch(filters.q);
  if (q) query = query.or(searchOrFilter(["title", "description", "location"], q));

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return {
    data: data as RoommatePostWithAuthor[],
    count: total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getRoommatePost(supabase: Client, id: string): Promise<RoommatePostWithAuthor | null> {
  const { data, error } = await supabase
    .from("roommate_posts")
    .select(ROOMMATE_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as RoommatePostWithAuthor | null;
}

export async function listRoommatePostsByAuthor(
  supabase: Client,
  authorId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<RoommatePostWithAuthor[]> {
  let query = supabase
    .from("roommate_posts")
    .select(ROOMMATE_SELECT)
    .eq("author_id", authorId)
    .order("created_at", { ascending: false });
  if (!opts.includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data as RoommatePostWithAuthor[];
}

export async function getRoommatePostsByIds(
  supabase: Client,
  ids: string[],
): Promise<RoommatePostWithAuthor[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("roommate_posts").select(ROOMMATE_SELECT).in("id", ids);
  if (error) throw error;
  return data as RoommatePostWithAuthor[];
}

function toRow(input: RoommatePostInput) {
  return {
    post_type: input.postType,
    title: input.title,
    description: input.description,
    university_id: input.universityId ?? null,
    budget_min: input.budgetMin ?? null,
    budget_max: input.budgetMax ?? null,
    currency: input.currency,
    move_in_date: input.moveInDate ?? null,
    location: input.location ?? null,
    gender_preference: input.genderPreference,
    smoking_ok: input.smokingOk,
    pets_ok: input.petsOk,
    sleep_schedule: input.sleepSchedule ?? null,
    cleanliness: input.cleanliness ?? null,
    images: input.images,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
  };
}

export async function createRoommatePost(
  supabase: Client,
  authorId: string,
  input: RoommatePostInput,
): Promise<RoommatePost> {
  const { data, error } = await supabase
    .from("roommate_posts")
    .insert({ ...toRow(input), author_id: authorId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoommatePost(
  supabase: Client,
  id: string,
  input: RoommatePostInput,
): Promise<RoommatePost> {
  const { data, error } = await supabase
    .from("roommate_posts")
    .update(toRow(input))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setRoommatePostActive(supabase: Client, id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("roommate_posts").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

export async function deleteRoommatePost(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("roommate_posts").delete().eq("id", id);
  if (error) throw error;
}
