import { DEFAULT_PAGE_SIZE, type ApartmentSort } from "../constants";
import type { ApartmentInput } from "../schemas";
import type { Apartment, ApartmentWithOwner, Client, ListingStatus, Paginated } from "../types/models";
import { pageRange, sanitizeSearch, searchOrFilter } from "../utils";

export const APARTMENT_SELECT =
  "*, owner:profiles!apartments_owner_id_fkey(id, full_name, avatar_url, university:universities(email_domain)), university:universities(id, name, latitude, longitude)";

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

  const fromTable = supabase.from("apartments").select(APARTMENT_SELECT, { count: "exact" });
  const withinRadius = filters.radiusKm !== undefined && filters.radiusKm > 0 && filters.universityId;
  // Radius search goes through the PostGIS function; it returns apartment rows, so
  // the same embedded select, filters, ordering and paging apply.
  let query = withinRadius
    ? (supabase
        .rpc("apartments_within", { p_university_id: filters.universityId as string, p_radius_m: (filters.radiusKm as number) * 1000 }, { count: "exact" })
        .select(APARTMENT_SELECT) as unknown as typeof fromTable)
    : fromTable;
  query = query.eq("status", "active");

  if (filters.universityId && !withinRadius) query = query.eq("university_id", filters.universityId);
  if (filters.minPrice !== undefined) query = query.gte("price_per_month", filters.minPrice);
  if (filters.maxPrice !== undefined) query = query.lte("price_per_month", filters.maxPrice);
  if (filters.minBedrooms !== undefined) query = query.gte("bedrooms", filters.minBedrooms);
  if (filters.furnished) query = query.eq("furnished", true);
  if (filters.petsAllowed) query = query.eq("pets_allowed", true);

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
      query = query.order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return {
    data: data as ApartmentWithOwner[],
    count: total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getApartment(supabase: Client, id: string): Promise<ApartmentWithOwner | null> {
  const { data, error } = await supabase
    .from("apartments")
    .select(APARTMENT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as ApartmentWithOwner | null;
}

export async function listApartmentsByOwner(
  supabase: Client,
  ownerId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ApartmentWithOwner[]> {
  let query = supabase
    .from("apartments")
    .select(APARTMENT_SELECT)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (!opts.includeInactive) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw error;
  return data as ApartmentWithOwner[];
}

export async function getApartmentsByIds(supabase: Client, ids: string[]): Promise<ApartmentWithOwner[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("apartments").select(APARTMENT_SELECT).in("id", ids);
  if (error) throw error;
  return data as ApartmentWithOwner[];
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

export async function createApartment(
  supabase: Client,
  ownerId: string,
  input: ApartmentInput,
): Promise<Apartment> {
  const { data, error } = await supabase
    .from("apartments")
    .insert({ ...toRow(input), owner_id: ownerId })
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
