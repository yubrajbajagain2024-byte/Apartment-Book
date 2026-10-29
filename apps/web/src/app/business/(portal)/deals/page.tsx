import type { Metadata } from "next";
import { Plus, Store } from "lucide-react";
import { getBusinessDealStats, listBusinessDeals, listUniversities, teamRoleAllows, type Deal } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { DealTable } from "@/components/business/deal-table";
import { PortalLink } from "@/components/business/portal-base";
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

/** Products & Services: the business's posts (products, services, special offers, events, updates) and its listings. */
export default async function DealsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ membership }, params] = await Promise.all([requireBusiness("/deals"), searchParams]);
  const business = membership.business;
  const supabase = await createClient();
  const [deals, stats, universities] = await Promise.all([
    listBusinessDeals(supabase, business.id),
    getBusinessDealStats(supabase, business.id).catch(() => []),
    listUniversities(supabase).catch(() => []),
  ]);
  const names = new Map(universities.map((u) => [u.id, u.name]));
  const canPublish = teamRoleAllows(membership.role, "publish");
  const filter = KINDS.find((k) => k.value === firstParam(params.kind)) ?? KINDS[0];
  const shown = deals.filter((d) => matches(filter, d));
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
          <nav aria-label="Filter by type" className="-mb-2 flex gap-1 overflow-x-auto no-scrollbar">
            {KINDS.map((k) => {
              const active = k.value === filter.value;
              const count = deals.filter((d) => matches(k, d)).length;
              return (
                <PortalLink
                  key={k.value}
                  href={k.value === "all" ? "/deals" : `/deals?kind=${k.value}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors",
                    active ? "bg-biz-ink text-biz-surface" : "bg-biz-surface text-biz-ink-2 ring-1 ring-biz-line hover:text-biz-ink",
                  )}
                >
                  {k.label} <span className={cn("tabular-nums", active ? "opacity-70" : "text-biz-ink-4")}>{count}</span>
                </PortalLink>
              );
            })}
          </nav>
          {shown.length === 0 ? (
            <p className="py-10 text-center text-[15px] text-biz-ink-3">Nothing of this type yet.</p>
          ) : (
            <DealTable deals={shown} stats={stats} universityNames={names} canPublish={canPublish} />
          )}
        </>
      )}
    </div>
  );
}
