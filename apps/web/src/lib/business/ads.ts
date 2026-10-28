import "server-only";
import { formatPrice, listApartmentsByBusiness, listBusinessDeals, listUniversities, mediaCover, mediaItems, photosFor, type Business, type Client, type University } from "@apartment-book/shared";
import type { PromotableItem } from "@/components/business/ad-editor";

/**
 * What the ad editor offers a business: every campus, the open ones (sign-up works there: Texas State first) and the
 * business's own campuses on top; and its live posts and active listings to promote.
 */
export async function adEditorData(supabase: Client, business: Business): Promise<{
  universities: { id: string; name: string; featured: boolean }[];
  defaultUniversityIds: string[];
  promotable: PromotableItem[];
}> {
  const [universities, posts, listings] = await Promise.all([
    listUniversities(supabase).catch((): University[] => []),
    listBusinessDeals(supabase, business.id).catch(() => []),
    listApartmentsByBusiness(supabase, business.id).catch(() => []),
  ]);
  const mine = new Set(business.university_ids);
  const rank = (u: University) => (mine.has(u.id) ? 0 : u.email_domain ? 1 : 2);
  const sorted = [...universities].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const open = universities.filter((u) => u.email_domain).map((u) => u.id);
  const now = Date.now();
  const promotable: PromotableItem[] = [
    ...posts
      .filter((p) => p.status === "active" && (!p.ends_at || new Date(p.ends_at).getTime() > now))
      .map((p) => ({ value: `deal:${p.id}`, label: p.title, image: mediaCover(mediaItems(p.media)) ?? p.image_url, price: p.price_cents !== null ? formatPrice(p.price_cents / 100, p.currency) : null })),
    ...listings
      .filter((a) => a.status === "active")
      .map((a) => ({ value: `apartment:${a.id}`, label: `Listing: ${a.title}`, image: photosFor(a.images, a.image_meta)[0]?.url ?? null, price: `${formatPrice(a.price_per_month, a.currency)}/mo` })),
  ];
  return {
    universities: sorted.map((u) => ({ id: u.id, name: u.name, featured: Boolean(u.email_domain) })),
    defaultUniversityIds: business.university_ids.length ? business.university_ids : open,
    promotable,
  };
}
