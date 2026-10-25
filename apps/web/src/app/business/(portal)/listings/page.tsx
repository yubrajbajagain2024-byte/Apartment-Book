import type { Metadata } from "next";
import { Building2, Plus } from "lucide-react";
import { getBusinessListingStats, listApartmentsByBusiness, photosFor } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { ListingTable, type ListingRow } from "@/components/business/listing-table";
import { PortalLink } from "@/components/business/portal-base";

export const metadata: Metadata = { title: "Listings" };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ membership }, params] = await Promise.all([requireBusiness("/listings"), searchParams]);
  const business = membership.business;
  const supabase = await createClient();
  const [listings, stats] = await Promise.all([listApartmentsByBusiness(supabase, business.id), getBusinessListingStats(supabase, business.id).catch(() => [])]);
  const statsById = new Map(stats.map((s) => [s.listing_id, s]));
  const rows: ListingRow[] = listings.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    price: a.price_per_month,
    currency: a.currency,
    place: a.city || a.address,
    image: photosFor(a.images, a.image_meta)[0]?.url ?? null,
    createdAt: a.created_at,
    stats: statsById.get(a.id) ?? null,
  }));
  const approved = business.status === "approved";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Listings</h1>
          <p className="text-sm text-gray-600">
            {rows.length} {rows.length === 1 ? "listing" : "listings"}. Active ones appear in Explore › Housing in the CampConnect app and on the website under {business.name}
            {business.verified_partner ? ", marked Verified Partner" : ""}; a listing with a paid promotion running is labelled Sponsored.
          </p>
        </div>
        {approved ? (
          <PortalLink href="/listings/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 bg-aurora px-4 text-sm font-semibold text-white hover:brightness-95">
            <Plus className="h-5 w-5" /> Post a listing
          </PortalLink>
        ) : null}
      </div>
      {firstParam(params.posted) ? <FormMessage success="Your listing is live. Students near the campus you chose see it in Housing now." /> : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No listings yet"
          description={approved ? "Post your first apartment: photos, a video tour, the rent and the campus it is near." : "Once your business is approved you can post apartment listings here."}
          action={
            approved ? (
              <PortalLink href="/listings/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 bg-aurora px-4 text-sm font-semibold text-white hover:brightness-95">
                <Plus className="h-5 w-5" /> Post a listing
              </PortalLink>
            ) : undefined
          }
        />
      ) : (
        <ListingTable rows={rows} />
      )}
    </div>
  );
}
