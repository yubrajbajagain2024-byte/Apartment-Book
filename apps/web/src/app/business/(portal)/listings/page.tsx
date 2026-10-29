import type { Metadata } from "next";
import { Building2, Plus } from "lucide-react";
import { getBusinessListingStats, listApartmentsByBusiness, photosFor } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { ListingTable, type ListingRow } from "@/components/business/listing-table";
import { ProductsTabs } from "@/components/business/section-tabs";
import { BizLink, EmptyPanel, Notice, PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Listings · Products & Services" };

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
  const newListing = approved ? (
    <BizLink href="/listings/new">
      <Plus className="h-4 w-4" /> Post a listing
    </BizLink>
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Products & Services"
        subtitle={`${rows.length} ${rows.length === 1 ? "listing" : "listings"}. Active ones appear in Explore › Housing in the UniBuzz app and on the website under ${business.name}${business.verified_partner ? ", marked Verified Partner" : ""}; a listing with a paid promotion running is labelled Sponsored.`}
        actions={newListing}
      />
      <ProductsTabs active="listings" listings />
      {firstParam(params.posted) ? (
        <Notice tone="success">Your listing is live. Students near the campus you chose see it in Housing now.</Notice>
      ) : null}
      {rows.length === 0 ? (
        <EmptyPanel
          icon={Building2}
          title="No listings yet"
          description={approved ? "Post your first apartment: photos, a video tour, the rent and the campus it is near." : "Once your business is approved you can post apartment listings here."}
          action={newListing}
        />
      ) : (
        <ListingTable rows={rows} />
      )}
    </div>
  );
}
