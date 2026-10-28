import type { Metadata } from "next";
import { BarChart3, Bookmark, Eye, Inbox, MousePointerClick, Store, Users } from "lucide-react";
import { clickRate, formatCents, getAdStats, getAnalyticsOverview, getDailyStats } from "@apartment-book/shared";
import { requireCapability } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { PortalLink } from "@/components/business/portal-base";
import { TrendChart } from "@/components/business/trend-chart";
import { AdStatusPill, EmptyPanel, PageHeader, Panel, PanelHeader, StatTile } from "@/components/business/ui";

export const metadata: Metadata = { title: "Analytics" };

const PERIODS = [7, 30, 90] as const;

/**
 * The business's numbers: what students did with its ads, posts, listings and profile, over 7, 30 or 90 days, and each
 * ad's totals. Counts of real events only, kept by the database once per person per hour or day; no list of who.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ membership }, params] = await Promise.all([requireCapability("analytics", "/analytics"), searchParams]);
  const days = PERIODS.find((p) => String(p) === firstParam(params.days)) ?? 30;
  const supabase = await createClient();
  const id = membership.business.id;
  const [overview, daily, ads] = await Promise.all([getAnalyticsOverview(supabase, id, days), getDailyStats(supabase, id, { days }), getAdStats(supabase, id).catch(() => [])]);
  const fmt = (v: number) => v.toLocaleString("en-US");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Analytics"
        subtitle="What students did with your ads, posts, listings and profile. Counts only: UniBuzz never tells a business who a student is."
        actions={
          <nav aria-label="Period" className="inline-flex rounded-full bg-biz-surface p-1 ring-1 ring-biz-line">
            {PERIODS.map((p) => (
              <PortalLink
                key={p}
                href={p === 30 ? "/analytics" : `/analytics?days=${p}`}
                aria-current={p === days ? "page" : undefined}
                className={cn("inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors", p === days ? "bg-biz-ink text-biz-surface" : "text-biz-ink-3 hover:text-biz-ink")}
              >
                {p} days
              </PortalLink>
            ))}
          </nav>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="analytics-overview">
        <StatTile icon={Eye} label="Impressions" value={fmt(overview.impressions)} sub={`${fmt(overview.reach)} students reached`} />
        <StatTile icon={MousePointerClick} label="Clicks" value={fmt(overview.clicks)} sub={`${clickRate(overview.clicks, overview.impressions)} of impressions`} />
        <StatTile icon={Users} label="Profile visits" value={fmt(overview.profile_visits)} />
        <StatTile icon={Inbox} label="Inquiries" value={fmt(overview.inquiries)} sub="Chats students opened" />
        <StatTile icon={Bookmark} label="Saves" value={fmt(overview.saves)} />
        <StatTile icon={Store} label="Post and listing views" value={fmt(overview.post_views)} />
        <StatTile icon={BarChart3} label="Ads running" value={fmt(overview.active_ads)} />
        <StatTile label="Paid in this period" value={formatCents(overview.spend_cents)} sub="Recorded by the UniBuzz team" />
      </div>

      <Panel className="pb-6">
        <PanelHeader title="Day by day" subtitle={`The last ${days} days, everything together.`} />
        <div className="px-6 pt-5">
          <TrendChart series={daily} label="Your business" />
        </div>
      </Panel>

      {ads.length === 0 ? (
        <EmptyPanel icon={BarChart3} title="No ads to compare yet" description="Each ad's impressions, reach, clicks, saves, profile visits and inquiries appear here once it runs." />
      ) : (
        <Panel className="overflow-hidden">
          <PanelHeader title="By ad" subtitle="Over each ad's whole run." />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-y border-biz-line bg-biz-surface-2 text-biz-ink-3">
                <tr>
                  <th scope="col" className="px-6 py-2.5 font-medium">Ad</th>
                  {["Impressions", "Reach", "Clicks", "CTR", "Saves", "Profile visits", "Inquiries"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2.5 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-biz-line">
                {ads.map((a) => (
                  <tr key={a.ad_id} className="transition-colors hover:bg-biz-surface-2">
                    <td className="px-6 py-3">
                      <PortalLink href={`/ads/${a.ad_id}`} className="flex items-center gap-2 font-medium text-biz-ink hover:underline">
                        {a.name} <AdStatusPill ad={{ status: a.status, starts_at: a.starts_at, ends_at: a.ends_at }} />
                      </PortalLink>
                    </td>
                    {[a.impressions, a.reach, a.clicks, clickRate(a.clicks, a.impressions), a.saves, a.profile_visits, a.inquiries].map((v, i) => (
                      <td key={i} className="px-3 py-3 text-right tabular-nums text-biz-ink-2">
                        {typeof v === "number" ? fmt(v) : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
