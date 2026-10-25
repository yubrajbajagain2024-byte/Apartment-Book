import type { Metadata } from "next";
import { Plus, Tag } from "lucide-react";
import { getBusinessDealStats, listBusinessDeals, listUniversities } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { DealTable } from "@/components/business/deal-table";
import { PortalLink } from "@/components/business/portal-base";

export const metadata: Metadata = { title: "Deals" };

export default async function DealsPage() {
  const { membership } = await requireBusiness("/deals");
  const business = membership.business;
  const supabase = await createClient();
  const [deals, stats, universities] = await Promise.all([
    listBusinessDeals(supabase, business.id),
    getBusinessDealStats(supabase, business.id).catch(() => []),
    listUniversities(supabase).catch(() => []),
  ]);
  const names = new Map(universities.map((u) => [u.id, u.name]));
  const newDeal = (
    <PortalLink href="/deals/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 bg-aurora px-4 text-sm font-semibold text-white hover:brightness-95">
      <Plus className="h-5 w-5" /> Add a deal
    </PortalLink>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deals</h1>
          <p className="text-sm text-gray-600">
            Offers for students at the campuses you choose.{business.status === "approved" ? " Live deals show on CampConnect's Deals page." : " They go in front of students once the business is approved."}
          </p>
        </div>
        {newDeal}
      </div>
      {deals.length === 0 ? (
        <EmptyState icon={Tag} title="No deals yet" description="A discount, a free add-on, a student night: say what it is, where it applies and until when." action={newDeal} />
      ) : (
        <DealTable deals={deals} stats={stats} universityNames={names} />
      )}
    </div>
  );
}
