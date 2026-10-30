import Link from "next/link";
import { AlertTriangle, Flag, Megaphone } from "lucide-react";
import type { AdStatus } from "@/lib/staff/ops-types";
import { fetchConsoleAds, requireStaffAdmin, staffMetadata } from "@/lib/staff/server";
import { cn, firstParam } from "@/lib/utils";
import { EmptyBox, Panel } from "@/components/staff/parts";
import { AdStatusPill, period, placementsText, usd } from "@/components/staff/business/parts";
import { buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const generateMetadata = () => staffMetadata("Campaigns · CampConnect Admin");

const PAGE = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS: { value: AdStatus | "all"; label: string }[] = [
  { value: "pending_review", label: "In review" },
  { value: "active", label: "Running" },
  { value: "scheduled", label: "Scheduled" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Ended" },
  { value: "rejected", label: "Rejected" },
  { value: "draft", label: "Drafts" },
  { value: "all", label: "All" },
];

/**
 * Every campaign: in review first (oldest submission first), with the money (budget, paid, the rate card's quote),
 * delivery so far, students' open reports and the Fair Housing screen's flags.
 */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaffAdmin();
  const params = await searchParams;
  const status = FILTERS.find((f) => f.value === firstParam(params.status))?.value ?? "pending_review";
  const q = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const rawBusiness = firstParam(params.business) ?? "";
  const businessId = UUID.test(rawBusiness) ? rawBusiness : null;
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const list = await fetchConsoleAds(status, q, businessId, page * PAGE, PAGE);
  const href = (next: { status?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const s = next.status ?? status;
    if (s !== "pending_review") sp.set("status", s);
    if (q) sp.set("q", q);
    if (businessId) sp.set("business", businessId);
    if (next.page) sp.set("page", String(next.page));
    const str = sp.toString();
    return str ? `/admin/business/campaigns?${str}` : "/admin/business/campaigns";
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Status" className="no-scrollbar flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={href({ status: f.value })}
              prefetch={false}
              aria-current={f.value === status ? "page" : undefined}
              className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-medium", f.value === status ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{list.counts[f.value] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <form method="get" action="/admin/business/campaigns" className="ml-auto flex items-center gap-1.5">
          {status !== "pending_review" ? <input type="hidden" name="status" value={status} /> : null}
          {businessId ? <input type="hidden" name="business" value={businessId} /> : null}
          <Input name="q" defaultValue={q} placeholder="Campaign, business or id" aria-label="Search campaigns" className="h-9 w-60 text-sm" />
          <button type="submit" className={buttonClasses({ variant: "outline", size: "sm" })}>
            Search
          </button>
        </form>
      </div>
      {businessId ? (
        <p className="text-sm text-gray-600">
          One business&apos;s campaigns.{" "}
          <Link href="/admin/business/campaigns" prefetch={false} className="font-medium text-brand-700 hover:underline">
            Show every business
          </Link>
        </p>
      ) : null}

      {list.items.length === 0 ? (
        <EmptyBox icon={Megaphone} title={status === "pending_review" && !q ? "No ad is waiting for review." : "No campaign here."} description="A business drafts its ads in the portal; you can draft one for an approved business from its page under Advertisers." />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Campaign</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Dates</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
                <th className="px-3 py-2 text-right font-medium">Rate card</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-3 py-2 text-right font-medium">Impr. · clicks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.items.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-3 py-2">
                    <Link href={`/admin/business/campaigns/${a.id}`} prefetch={false} className="font-medium text-gray-900 hover:underline">
                      {a.name}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {a.business.name} · {placementsText(a.placements)}
                      {a.vertical === "housing" ? " · housing" : ""}
                    </p>
                    <p className="flex flex-wrap gap-2 text-xs">
                      {a.openReports ? (
                        <span className="inline-flex items-center gap-1 text-red-700">
                          <Flag className="h-3 w-3" aria-hidden /> {a.openReports} open report{a.openReports === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {a.fairHousingFlags.length ? (
                        <span className="inline-flex items-center gap-1 text-amber-800">
                          <AlertTriangle className="h-3 w-3" aria-hidden /> Fair Housing flags
                        </span>
                      ) : null}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <AdStatusPill status={a.status} pausedBy={a.pausedBy} />
                  </td>
                  <td className="px-3 py-2 text-gray-700">{period(a.startsAt, a.endsAt)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(a.budgetCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{a.quote?.cents != null ? usd(a.quote.cents) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.paidCents ? usd(a.paidCents) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.impressions.toLocaleString("en-US")} · {a.clicks.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {page > 0 || list.nextOffset !== null ? (
        <div className="flex items-center justify-between">
          {page > 0 ? (
            <Link href={href({ page: page - 1 })} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          {list.nextOffset !== null ? (
            <Link href={href({ page: page + 1 })} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
