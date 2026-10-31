import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { BUSINESS_REPORT_REASONS, adminListBusinessReports } from "@apartment-book/shared";
import { requireConsoleAdmin } from "@/lib/console/server";
import { cn, firstParam } from "@/lib/utils";
import { EmptyBox, Panel, Pill } from "@/components/console/parts";
import { ReportResolve } from "@/components/business/report-resolve";
import { centralTime } from "@/components/business/parts";

export const metadata: Metadata = { title: "Business reports" };

/**
 * Students' reports of ads, posts and businesses (Business v2's queue; the business never sees them, nor who sent
 * them). Act from the campaign or the advertiser page (pause or reject the ad, suspend the business), then close the
 * report here.
 */
export default async function BusinessReportsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const me = await requireConsoleAdmin("/business/reports");
  const closed = firstParam((await searchParams).show) === "closed";
  const reports = await adminListBusinessReports(me.supabase, closed ? null : "open");
  const shown = closed ? reports.filter((r) => r.status !== "open") : reports;
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Show" className="flex gap-1">
        {[
          ["Open", "/business/reports", !closed],
          ["Closed", "/business/reports?show=closed", closed],
        ].map(([label, href, active]) => (
          <Link
            key={String(label)}
            href={String(href)}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn("inline-flex h-8 items-center rounded-full px-3 text-sm font-medium", active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyBox icon={Flag} title={closed ? "No closed reports" : "No open reports"} description="Students report from the … menu on an ad, a post or a business's profile." />
      ) : (
        <Panel className="divide-y divide-gray-100 p-0">
          {shown.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Pill tone={r.reason === "discrimination" || r.reason === "scam" ? "red" : "amber"}>{BUSINESS_REPORT_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}</Pill>
                <Link href={`/business/advertisers/${r.business_id}`} prefetch={false} className="font-medium text-gray-900 hover:underline">
                  {r.business_name}
                </Link>
                {r.ad_id ? (
                  <Link href={`/business/campaigns/${r.ad_id}`} prefetch={false} className="text-gray-600 hover:underline">
                    ad “{r.ad_name}”
                  </Link>
                ) : (
                  <span className="text-gray-600">{r.deal_title ? `post “${r.deal_title}”` : "the business"}</span>
                )}
                <span className="ml-auto text-xs text-gray-500">
                  {r.reporter_name ?? "A student"} · {centralTime(new Date(r.created_at).getTime())}
                </span>
              </div>
              {r.details ? <p className="text-sm text-gray-800">{r.details}</p> : null}
              {r.status === "open" ? (
                <ReportResolve reportId={r.id} />
              ) : (
                <p className="text-sm text-gray-600">
                  {r.status === "actioned" ? "Actioned" : "Dismissed"}
                  {r.resolution_note ? `: ${r.resolution_note}` : ""}
                </p>
              )}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
