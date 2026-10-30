import Link from "next/link";
import { CalendarClock, Inbox } from "lucide-react";
import { businessCategoryLabel } from "@apartment-book/shared";
import { fetchBusinessOpsOverview, fetchConsoleAds, fetchConsoleBusinesses, requireStaffAdmin, staffMetadata } from "@/lib/staff/server";
import { plural } from "@/lib/staff/format";
import { Ago } from "@/components/staff/live";
import { LiveRefresh } from "@/components/staff/live-refresh";
import { EmptyBox, Panel, Section, StatTile } from "@/components/staff/parts";
import { AdStatusPill, BusinessStatusPill, centralTime, period, placementsText, usd } from "@/components/staff/business/parts";

export const generateMetadata = () => staffMetadata("Business · CampConnect Admin");

/**
 * What waits for the team: businesses to review (once their owner confirmed the email), ads in review (oldest first),
 * students' open reports, and the campaigns that end in the next three days; with this month's money.
 */
export default async function BusinessOverviewPage() {
  await requireStaffAdmin();
  const [o, businesses, ads] = await Promise.all([fetchBusinessOpsOverview(), fetchConsoleBusinesses("", "pending", 0, 5), fetchConsoleAds("pending_review", "", null, 0, 5)]);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          {plural(o.businesses.approved, "approved business", "approved businesses")}, {o.businesses.verified} Verified Partner{o.businesses.verified === 1 ? "" : "s"}, {o.businesses.suspended} suspended.
        </p>
        <LiveRefresh generatedAt={o.generatedAt} />
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Businesses to review" value={String(o.businesses.pendingConfirmed)} hint={`${o.businesses.pending - o.businesses.pendingConfirmed} more waiting for their owner to confirm the email`} />
        <StatTile label="Ads in review" value={String(o.ads.inReview)} hint={o.ads.oldestInReviewAt ? "oldest submitted" : "queue clear"}>
          {o.ads.oldestInReviewAt ? <Ago ms={o.ads.oldestInReviewAt} className="text-xs text-gray-600" /> : null}
        </StatTile>
        <StatTile label="Running · scheduled" value={`${o.ads.running} · ${o.ads.scheduled}`} hint={o.ads.pausedByTeam ? `${o.ads.pausedByTeam} paused by the team` : "none paused by the team"} />
        <StatTile label="Booked this month" value={usd(o.revenue.monthToDateCents)} hint={`${usd(o.revenue.earnedMonthToDateCents)} earned · ${usd(o.revenue.last30Cents)} in 30 days`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Businesses to review" action={<Link href="/admin/business/advertisers?status=pending" prefetch={false} className="text-xs font-medium text-brand-700 hover:underline">All</Link>}>
          {businesses.items.length === 0 ? (
            <EmptyBox icon={Inbox} title="No business waiting" />
          ) : (
            <Panel className="divide-y divide-gray-100 p-0">
              {businesses.items.map((b) => (
                <Link key={b.id} href={`/admin/business/advertisers/${b.id}`} prefetch={false} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{b.name}</p>
                    <p className="truncate text-xs text-gray-600">
                      {businessCategoryLabel(b.category)} · {b.owner.email ?? b.owner.name} · {b.owner.confirmed ? "email confirmed" : "email not confirmed yet"}
                    </p>
                  </div>
                  <BusinessStatusPill status={b.status} />
                </Link>
              ))}
            </Panel>
          )}
        </Section>
        <Section title="Ads in review" hint="oldest first" action={<Link href="/admin/business/campaigns" prefetch={false} className="text-xs font-medium text-brand-700 hover:underline">All</Link>}>
          {ads.items.length === 0 ? (
            <EmptyBox icon={Inbox} title="No ad waiting" />
          ) : (
            <Panel className="divide-y divide-gray-100 p-0">
              {ads.items.map((a) => (
                <Link key={a.id} href={`/admin/business/campaigns/${a.id}`} prefetch={false} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{a.name}</p>
                    <p className="truncate text-xs text-gray-600">
                      {a.business.name} · {placementsText(a.placements)} · {period(a.startsAt, a.endsAt)} · budget {usd(a.budgetCents)}
                    </p>
                  </div>
                  <AdStatusPill status={a.status} pausedBy={a.pausedBy} />
                </Link>
              ))}
            </Panel>
          )}
        </Section>
      </div>

      <Section title="Ending in the next three days">
        {o.endingSoon.length === 0 ? (
          <EmptyBox icon={CalendarClock} title="No campaign ends soon" />
        ) : (
          <Panel className="divide-y divide-gray-100 p-0">
            {o.endingSoon.map((a) => (
              <Link key={a.id} href={`/admin/business/campaigns/${a.id}`} prefetch={false} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-gray-900">{a.name}</span> <span className="text-gray-600">· {a.businessName}</span>
                </span>
                <span className="shrink-0 text-xs text-gray-600">ends {centralTime(a.endsAt)}</span>
              </Link>
            ))}
          </Panel>
        )}
      </Section>
      {o.reports.open ? (
        <p className="text-sm text-gray-700">
          {plural(o.reports.open, "open report")} from students.{" "}
          <Link href="/admin/business/reports" prefetch={false} className="font-medium text-brand-700 hover:underline">
            Review them
          </Link>
        </p>
      ) : null}
    </div>
  );
}
