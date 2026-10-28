import type { Metadata } from "next";
import { Flag } from "lucide-react";
import { BUSINESS_REPORT_REASONS, adminListBusinessReports } from "@apartment-book/shared";
import { requireAdmin } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam, timeAgo } from "@/lib/utils";
import { PortalLink } from "@/components/business/portal-base";
import { ReportActions } from "@/components/business/report-actions";
import { EmptyPanel, PageHeader, Panel, Pill } from "@/components/business/ui";

export const metadata: Metadata = { title: "Reports" };

/** What students reported about ads, posts and businesses. The business never sees these, nor who sent them. */
export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireAdmin("/admin/reports");
  const closed = firstParam((await searchParams).show) === "closed";
  const reports = await adminListBusinessReports(await createClient(), closed ? null : "open");
  const shown = closed ? reports.filter((r) => r.status !== "open") : reports;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        subtitle="Students' reports of ads, posts and businesses. Pause or reject the ad from the Ads tab, or suspend the business, then close the report here."
        actions={
          <nav className="inline-flex rounded-full bg-biz-surface p-1 ring-1 ring-biz-line" aria-label="Show">
            {[
              ["Open", "/admin/reports", !closed],
              ["Closed", "/admin/reports?show=closed", closed],
            ].map(([label, href, active]) => (
              <PortalLink key={String(label)} href={String(href)} aria-current={active ? "page" : undefined} className={cn("inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium", active ? "bg-biz-ink text-biz-surface" : "text-biz-ink-3")}>
                {label}
              </PortalLink>
            ))}
          </nav>
        }
      />
      {shown.length === 0 ? (
        <EmptyPanel icon={Flag} title={closed ? "No closed reports" : "No open reports"} description="Students report from the … menu on an ad, a post or a business's profile." />
      ) : (
        <Panel className="divide-y divide-biz-line overflow-hidden">
          {shown.map((r) => (
            <div key={r.id} className="flex flex-col gap-3 px-6 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={r.reason === "discrimination" || r.reason === "scam" ? "danger" : "warning"}>{BUSINESS_REPORT_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}</Pill>
                <span className="text-[15px] font-semibold text-biz-ink">{r.business_name}</span>
                <span className="text-[13px] text-biz-ink-3">{r.ad_name ? `ad “${r.ad_name}”` : r.deal_title ? `post “${r.deal_title}”` : "the business"}</span>
                <span className="ml-auto text-xs text-biz-ink-4" suppressHydrationWarning>
                  {r.reporter_name ?? "A student"} · {timeAgo(r.created_at)}
                </span>
              </div>
              {r.details ? <p className="text-[15px] leading-relaxed text-biz-ink-2">{r.details}</p> : null}
              {r.status === "open" ? <ReportActions reportId={r.id} /> : <p className="text-[13px] text-biz-ink-3">{r.status === "actioned" ? "Actioned" : "Dismissed"}{r.resolution_note ? `: ${r.resolution_note}` : ""}</p>}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
