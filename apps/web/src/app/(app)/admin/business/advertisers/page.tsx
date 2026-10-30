import Link from "next/link";
import { BadgeCheck, Store } from "lucide-react";
import { businessCategoryLabel } from "@apartment-book/shared";
import type { BusinessStatus } from "@/lib/staff/ops-types";
import { fetchConsoleBusinesses, requireStaffAdmin, staffMetadata } from "@/lib/staff/server";
import { cn, firstParam } from "@/lib/utils";
import { EmptyBox, Panel, Pill } from "@/components/staff/parts";
import { BusinessStatusPill, centralDay, usd } from "@/components/staff/business/parts";
import { buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const generateMetadata = () => staffMetadata("Advertisers · CampConnect Admin");

const PAGE = 30;
const STATUSES: { value: BusinessStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "suspended", label: "Suspended" },
  { value: "rejected", label: "Rejected" },
];

/** Every business on UniBuzz Business (the advertisers): standing, owner, team, campaigns, money and open reports. */
export default async function AdvertisersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaffAdmin();
  const params = await searchParams;
  const status = STATUSES.find((s) => s.value && s.value === firstParam(params.status))?.value || null;
  const q = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const list = await fetchConsoleBusinesses(q, status, page * PAGE, PAGE);
  const href = (next: { status?: string | null; page?: number }) => {
    const sp = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    if (s) sp.set("status", s);
    if (q) sp.set("q", q);
    if (next.page) sp.set("page", String(next.page));
    const str = sp.toString();
    return str ? `/admin/business/advertisers?${str}` : "/admin/business/advertisers";
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Standing" className="no-scrollbar flex gap-1 overflow-x-auto">
          {STATUSES.map((s) => (
            <Link
              key={s.label}
              href={href({ status: s.value || null })}
              prefetch={false}
              aria-current={(s.value || null) === status ? "page" : undefined}
              className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-medium", (s.value || null) === status ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")}
            >
              {s.label}
              <span className="ml-1 tabular-nums opacity-70">{list.counts[s.value || "all"] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <form method="get" action="/admin/business/advertisers" className="ml-auto flex items-center gap-1.5">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <Input name="q" defaultValue={q} placeholder="Name, owner, email or id" aria-label="Search advertisers" className="h-9 w-64 text-sm" />
          <button type="submit" className={buttonClasses({ variant: "outline", size: "sm" })}>
            Search
          </button>
        </form>
      </div>

      {list.items.length === 0 ? (
        <EmptyBox icon={Store} title={q ? "No business matches." : "No business here."} />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Business</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Standing</th>
                <th className="px-3 py-2 text-right font-medium">Team</th>
                <th className="px-3 py-2 text-right font-medium">Running · review</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-3 py-2 text-right font-medium">Reports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.items.map((b) => (
                <tr key={b.id} className="align-top">
                  <td className="px-3 py-2">
                    <Link href={`/admin/business/advertisers/${b.id}`} prefetch={false} className="font-medium text-gray-900 hover:underline">
                      {b.name}
                    </Link>
                    {b.verified ? <BadgeCheck className="ml-1 inline h-4 w-4 text-brand-600" aria-label="Verified Partner" /> : null}
                    <p className="text-xs text-gray-500">
                      {businessCategoryLabel(b.category)}
                      {b.city ? ` · ${b.city}` : ""} · since {centralDay(b.createdAt)}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-gray-900">{b.owner.name ?? "—"}</p>
                    <p className="text-xs text-gray-500">
                      {b.owner.email ?? "no email"} {b.owner.confirmed ? null : <Pill tone="amber">not confirmed</Pill>}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <BusinessStatusPill status={b.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.members}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {b.adsRunning} · {b.adsInReview}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(b.paidCents)}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", b.openReports ? "font-semibold text-red-700" : "text-gray-500")}>{b.openReports}</td>
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
