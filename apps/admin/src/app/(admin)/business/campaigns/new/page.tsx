import type { Metadata } from "next";
import Link from "next/link";
import { Store } from "lucide-react";
import { listApartmentsByBusiness, listBusinessDeals, listUniversities } from "@apartment-book/shared";
import { fetchConsoleBusiness, requireConsoleAdmin } from "@/lib/console/server";
import { firstParam } from "@/lib/utils";
import { EmptyBox, Panel } from "@/components/console/parts";
import { CampaignCreateForm } from "@/components/business/campaign-create-form";

export const metadata: Metadata = { title: "New campaign" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The time this request renders at (each request renders afresh). */
const renderedAt = () => Date.now();

/** A draft campaign for one approved business (?business=<id>), from its page under Advertisers. */
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const me = await requireConsoleAdmin("/business/campaigns/new");
  const businessId = firstParam((await searchParams).business) ?? "";
  if (!UUID.test(businessId)) {
    return <EmptyBox icon={Store} title="Pick the business first" description="Open the business under Advertisers and choose “Draft a campaign for them”." />;
  }
  const [d, universities, posts, listings] = await Promise.all([
    fetchConsoleBusiness(businessId),
    listUniversities(me.supabase).catch(() => []),
    listBusinessDeals(me.supabase, businessId).catch(() => []),
    listApartmentsByBusiness(me.supabase, businessId).catch(() => []),
  ]);
  const b = d.business;
  if (b.status !== "approved") {
    return <EmptyBox icon={Store} title="Only an approved business can run ads" description={`${b.name} is ${b.status}. Review it first.`} />;
  }
  // The business's own campuses first, then the open ones (sign-up works there), then the rest: as the portal's editor.
  const mine = new Set(b.universityIds);
  const rank = (u: { id: string; email_domain: string | null }) => (mine.has(u.id) ? 0 : u.email_domain ? 1 : 2);
  const campuses = [...universities].sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name)).map((u) => ({ id: u.id, name: u.name }));
  const defaults = b.universityIds.length ? b.universityIds : universities.filter((u) => u.email_domain).map((u) => u.id);
  const now = renderedAt();
  const promotable = [
    ...posts.filter((p) => p.status === "active" && (!p.ends_at || new Date(p.ends_at).getTime() > now)).map((p) => ({ value: `deal:${p.id}`, label: `Post: ${p.title}` })),
    ...listings.filter((l) => l.status === "active").map((l) => ({ value: `apartment:${l.id}`, label: `Listing: ${l.title}` })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-gray-500">
          <Link href={`/business/advertisers/${b.id}`} prefetch={false} className="hover:underline">
            {b.name}
          </Link>{" "}
          /
        </p>
        <h2 className="text-xl font-bold text-gray-900">Draft a campaign</h2>
        <p className="text-sm text-gray-600">
          It goes to {b.name}&apos;s Ads Manager as a draft and their owner and admins are told. They add photos if they like and submit it; you then review it here and record the payment.
        </p>
      </div>
      <Panel>
        <CampaignCreateForm businessId={b.id} housing={b.category === "housing"} campuses={campuses} defaultCampusIds={defaults} promotable={promotable} />
      </Panel>
    </div>
  );
}
