import { DEFAULT_PAGE_SIZE, type ApartmentSort } from "../constants";
import type { ApartmentInput } from "../schemas";
import type { Apartment, ApartmentWithOwner, Client, ListingStatus, Paginated } from "../types/models";
import { pageRange, sanitizeSearch, searchOrFilter } from "../utils";
import { isMissingRelation } from "./profile-page";

const OWNER_SELECT =
  "*, owner:profiles!apartments_owner_id_fkey(id, full_name, avatar_url, university:universities(email_domain)), university:universities(id, name, latitude, longitude)";
/** With the business behind a portal listing (migration 39) and whether a paid promotion runs on it, for its label. */
export const APARTMENT_SELECT = `${OWNER_SELECT}, business:businesses!apartments_business_id_fkey(id, name, logo_url, verified_partner), sponsored:listing_sponsored`;

/**
 * Listings are read with the business embedded. A database before migration 39 has no businesses table and refuses
 * that select; once that is seen, this process reads listings without it (the label simply does not show), so the
 * apps keep working while the database catches up.
 */
let businessEmbed = true;
async function withBusinessFallback<T>(run: (select: string) => Promise<T>): Promise<T> {
  if (!businessEmbed) return run(OWNER_SELECT);
  try {
    return await run(APARTMENT_SELECT);
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    businessEmbed = false;
    return run(OWNER_SELECT);
  }
}

export type ApartmentFilters = {
  q?: string;
  universityId?: string;
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  furnished?: boolean;
  petsAllowed?: boolean;
  /** Only listings pinned within this many kilometres of the university's campus (needs universityId). */
  radiusKm?: number;
  /** Only listings with a video tour. */
  videoOnly?: boolean;
  sort?: ApartmentSort;
  page?: number;
  pageSize?: number;
};

export async function listApartments(
  supabase: Client,
  filters: ApartmentFilters = {},
): Promise<Paginated<ApartmentWithOwner>> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const { from, to } = pageRange(page, pageSize);

  const { data, count } = await withBusinessFallback(async (select) => {
    const fromTable = supabase.from("apartments").select(select, { count: "exact" });
    const withinRadius = filters.radiusKm !== undefined && filters.radiusKm > 0 && filters.universityId;
    // Radius search goes through the PostGIS function; it returns apartment rows, so
    // the same embedded select, filters, ordering and paging apply.
    let query = withinRadius
      ? (supabase
          .rpc("apartments_within", { p_university_id: filters.universityId as string, p_radius_m: (filters.radiusKm as number) * 1000 }, { count: "exact" })
          .select(select) as unknown as typeof fromTable)
      : fromTable;
    query = query.eq("status", "active");

    if (filters.universityId && !withinRadius) query = query.eq("university_id", filters.universityId);
    if (filters.minPrice !== undefined) query = query.gte("price_per_month", filters.minPrice);
    if (filters.maxPrice !== undefined) query = query.lte("price_per_month", filters.maxPrice);
    if (filters.minBedrooms !== undefined) query = query.gte("bedrooms", filters.minBedrooms);
    if (filters.furnished) query = query.eq("furnished", true);
    if (filters.petsAllowed) query = query.eq("pets_allowed", true);
    if (filters.videoOnly) query = query.eq("has_video", true);

    const q = sanitizeSearch(filters.q);
    if (q) query = query.or(searchOrFilter(["title", "description", "address", "city"], q));

    switch (filters.sort) {
      case "price_asc":
        query = query.order("price_per_month", { ascending: true });
        break;
      case "price_desc":
        query = query.order("price_per_month", { ascending: false });
        break;
      case "distance":
        query = query.order("distance_km", { ascending: true, nullsFirst: false });
        break;
      default:
        // Backend ranking rule: posts with a video tour come first, then newest.
        query = query.order("has_video", { ascending: false }).order("created_at", { ascending: false });
    }

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    return { data: data as unknown as ApartmentWithOwner[], count };
  });
  const total = count ?? 0;
  return {
    data,
    count: total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getApartment(supabase: Client, id: string): Promise<ApartmentWithOwner | null> {
  return withBusinessFallback(async (select) => {
    const { data, error } = await supabase.from("apartments").select(select).eq("id", id).maybeSingle();
    if (error) throw error;
    return data as unknown as ApartmentWithOwner | null;
  });
}

export async function listApartmentsByOwner(
  supabase: Client,
  ownerId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ApartmentWithOwner[]> {
  return withBusinessFallback(async (select) => {
    let query = supabase
      .from("apartments")
      .select(select)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (!opts.includeInactive) query = query.eq("status", "active");
    const { data, error } = await query;
    if (error) throw error;
    return data as unknown as ApartmentWithOwner[];
  });
}

/** Every listing of a business, whatever its status, newest first: the portal's Listings page. */
export async function listApartmentsByBusiness(supabase: Client, businessId: string): Promise<ApartmentWithOwner[]> {
  const { data, error } = await supabase
    .from("apartments")
    .select(APARTMENT_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as unknown as ApartmentWithOwner[];
}

export async function getApartmentsByIds(supabase: Client, ids: string[]): Promise<ApartmentWithOwner[]> {
  if (ids.length === 0) return [];
  return withBusinessFallback(async (select) => {
    const { data, error } = await supabase.from("apartments").select(select).in("id", ids);
    if (error) throw error;
    return data as unknown as ApartmentWithOwner[];
  });
}

function toRow(input: ApartmentInput) {
  return {
    title: input.title,
    description: input.description,
    price_per_month: input.pricePerMonth,
    currency: input.currency,
    address: input.address,
    city: input.city ?? null,
    university_id: input.universityId ?? null,
    distance_km: input.distanceKm ?? null,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    furnished: input.furnished,
    utilities_included: input.utilitiesIncluded,
    pets_allowed: input.petsAllowed,
    available_from: input.availableFrom ?? null,
    lease_months: input.leaseMonths ?? null,
    amenities: input.amenities,
    images: input.images,
    image_meta: input.imageMeta.filter((m) => input.images.includes(m.url)),
    videos: input.videos,
    map_url: input.mapUrl ?? null,
    contact_phone: input.contactPhone ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
  };
}

/** Listings with a pinned location, for the map view (no paging). */
export async function listApartmentsForMap(
  supabase: Client,
  filters: Pick<ApartmentFilters, "universityId" | "radiusKm" | "q" | "minPrice" | "maxPrice" | "minBedrooms" | "furnished" | "petsAllowed"> = {},
): Promise<ApartmentWithOwner[]> {
  const page = await listApartments(supabase, { ...filters, page: 1, pageSize: 200, sort: "newest" });
  return page.data.filter((a) => a.latitude !== null && a.longitude !== null);
}

/**
 * A listing. From the portal, pass the business: the row is owned by the business's owner (whoever on the team posts
 * it) and carries business_id, as the database requires of a business account.
 */
export async function createApartment(
  supabase: Client,
  ownerId: string,
  input: ApartmentInput,
  opts: { businessId?: string | null } = {},
): Promise<Apartment> {
  const { data, error } = await supabase
    .from("apartments")
    .insert({ ...toRow(input), owner_id: ownerId, ...(opts.businessId ? { business_id: opts.businessId } : {}) })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateApartment(
  supabase: Client,
  id: string,
  input: ApartmentInput,
): Promise<Apartment> {
  const { data, error } = await supabase
    .from("apartments")
    .update(toRow(input))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setApartmentStatus(
  supabase: Client,
  id: string,
  status: ListingStatus,
): Promise<void> {
  const { error } = await supabase.from("apartments").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteApartment(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("apartments").delete().eq("id", id);
  if (error) throw error;
}
