import type { Metadata } from "next";
import { Plus, Store } from "lucide-react";
import { getBusinessDealStats, listBusinessDeals, listUniversities, teamRoleAllows } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { DealTable } from "@/components/business/deal-table";
import { BizLink, EmptyPanel, PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Posts" };

/** The business's posts (v1's deals, at /deals still): updates, products, services, deals, events and promotions. */
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
        title="Posts"
        subtitle={
          business.status === "approved"
            ? "What students see on your public profile; offers also appear in Deals. Promote any of them with an ad."
            : "Draft them now: students see them once the UniBuzz team approves your business."
        }
        actions={newPost}
      />
      {deals.length === 0 ? (
        <EmptyPanel icon={Store} title="No posts yet" description="A new product, a student discount, an event, a service: photos or a video, a price, a code, a link." action={newPost} />
      ) : (
        <DealTable deals={deals} stats={stats} universityNames={names} canPublish={canPublish} />
      )}
    </div>
  );
}
