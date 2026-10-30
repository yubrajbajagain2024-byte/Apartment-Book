import type { Metadata } from "next";
import { Plus, Store } from "lucide-react";
import { getBusinessDealStats, listBusinessDeals, listUniversities, teamRoleAllows, type Deal } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { DealTable } from "@/components/business/deal-table";
import { FilterTabs } from "@/components/business/filter-tabs";
import { ProductsTabs } from "@/components/business/section-tabs";
import { BizLink, EmptyPanel, PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Products & Services" };

/** What the type filter offers: offers are v1's deals and promotions; v1's deals at /deals are every kind since migration 50. */
const KINDS = [
  { value: "all", label: "All", kinds: null },
  { value: "products", label: "Products", kinds: ["product"] },
  { value: "services", label: "Services", kinds: ["service"] },
  { value: "offers", label: "Special offers", kinds: ["deal", "promotion"] },
  { value: "events", label: "Events", kinds: ["event"] },
  { value: "updates", label: "Updates", kinds: ["update"] },
] as const;

const matches = (f: (typeof KINDS)[number], d: Deal) => !f.kinds || (f.kinds as readonly string[]).includes(d.kind);
/** Each filter's kinds, for the grid to pick from in the browser (null: every kind). */
const KINDS_BY_FILTER = Object.fromEntries(KINDS.map((k) => [k.value, k.kinds])) as Record<string, readonly string[] | null>;

/**
 * Products & Services: the business's posts (products, services, special offers, events, updates) and its listings.
 * Every post is on the page; the type filter (?kind=) picks from them in the browser, so switching costs no request.
 */
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
  const canPublish = teamRoleAllows(membership.role, "publish");
  const newPost = canPublish ? (
    <BizLink href="/deals/new">
      <Plus className="h-4 w-4" /> New post
    </BizLink>
  ) : null;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Products & Services"
        subtitle={
          business.status === "approved"
            ? "Your products, services, special offers, events and updates: what students see on your public profile; offers also appear in Deals. Promote any of them with an ad."
            : "Draft them now: students see them once the UniBuzz team approves your business."
        }
        actions={newPost}
      />
      <ProductsTabs active="posts" listings={business.category === "housing"} />
      {deals.length === 0 ? (
        <EmptyPanel icon={Store} title="Nothing here yet" description="A new product, a service, a student discount, an event: photos or a video, a price, a code, a link." action={newPost} />
      ) : (
        <>
          <FilterTabs label="Filter by type" param="kind" path="/deals" fallback="all" options={KINDS.map((k) => ({ value: k.value, label: k.label, count: deals.filter((d) => matches(k, d)).length }))} />
          <DealTable deals={deals} stats={stats} universityNames={names} canPublish={canPublish} filter={{ param: "kind", fallback: "all", kinds: KINDS_BY_FILTER }} />
        </>
      )}
    </div>
  );
}
