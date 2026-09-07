import { DEFAULT_PAGE_SIZE, type ItemSort } from "../constants";
import type { ItemInput } from "../schemas";
import type { Client, Item, ItemCondition, ItemStatus, ItemWithSeller, Paginated } from "../types/models";
import { pageRange, sanitizeSearch, searchOrFilter } from "../utils";

export const ITEM_SELECT =
  "*, seller:profiles!items_seller_id_fkey(id, full_name, avatar_url), university:universities(id, name, latitude, longitude)";

export type ItemFilters = {
  q?: string;
  universityId?: string;
  category?: string;
  condition?: ItemCondition;
  minPrice?: number;
  maxPrice?: number;
  sort?: ItemSort;
  page?: number;
  pageSize?: number;
};

export async function listItems(supabase: Client, filters: ItemFilters = {}): Promise<Paginated<ItemWithSeller>> {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const { from, to } = pageRange(page, pageSize);

  let query = supabase
    .from("items")
    .select(ITEM_SELECT, { count: "exact" })
    .eq("status", "available");

  if (filters.universityId) query = query.eq("university_id", filters.universityId);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.condition) query = query.eq("condition", filters.condition);
  if (filters.minPrice !== undefined) query = query.gte("price", filters.minPrice);
  if (filters.maxPrice !== undefined) query = query.lte("price", filters.maxPrice);

  const q = sanitizeSearch(filters.q);
  if (q) query = query.or(searchOrFilter(["title", "description", "pickup_location"], q));

  switch (filters.sort) {
    case "price_asc":
      query = query.order("price", { ascending: true });
      break;
    case "price_desc":
      query = query.order("price", { ascending: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;
  const total = count ?? 0;
  return {
    data: data as ItemWithSeller[],
    count: total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getItem(supabase: Client, id: string): Promise<ItemWithSeller | null> {
  const { data, error } = await supabase.from("items").select(ITEM_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as ItemWithSeller | null;
}

export async function listItemsBySeller(
  supabase: Client,
  sellerId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ItemWithSeller[]> {
  let query = supabase
    .from("items")
    .select(ITEM_SELECT)
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });
  if (!opts.includeInactive) query = query.eq("status", "available");
  const { data, error } = await query;
  if (error) throw error;
  return data as ItemWithSeller[];
}

export async function getItemsByIds(supabase: Client, ids: string[]): Promise<ItemWithSeller[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("items").select(ITEM_SELECT).in("id", ids);
  if (error) throw error;
  return data as ItemWithSeller[];
}

function toRow(input: ItemInput) {
  return {
    title: input.title,
    description: input.description,
    price: input.price,
    currency: input.currency,
    category: input.category,
    condition: input.condition,
    university_id: input.universityId ?? null,
    pickup_location: input.pickupLocation ?? null,
    images: input.images,
  };
}

export async function createItem(supabase: Client, sellerId: string, input: ItemInput): Promise<Item> {
  const { data, error } = await supabase
    .from("items")
    .insert({ ...toRow(input), seller_id: sellerId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateItem(supabase: Client, id: string, input: ItemInput): Promise<Item> {
  const { data, error } = await supabase.from("items").update(toRow(input)).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

export async function setItemStatus(supabase: Client, id: string, status: ItemStatus): Promise<void> {
  const { error } = await supabase.from("items").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteItem(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) throw error;
}
