import type { Metadata } from "next";
import Link from "next/link";
import { fetchConsolePayments, requireConsoleAdmin } from "@/lib/console/server";
import { cn, firstParam } from "@/lib/utils";
import { CsvButton } from "@/components/console/csv-button";
import { StatTile } from "@/components/console/parts";
import { PaymentsTable } from "@/components/business/payments-table";
import { usd } from "@/components/business/parts";
import { buttonClasses } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export const metadata: Metadata = { title: "Payments" };

const PAGE = 50;
const RANGES = [
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "365", label: "1 year", days: 365 },
  { value: "all", label: "All time", days: null },
] as const;

/**
 * The payments ledger across every business (no payment provider yet: each row is a payment the team recorded, at an
 * ad's approval or later). Void one from here; the totals and the CSV follow the filters.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireConsoleAdmin("/business/payments");
  const params = await searchParams;
  const range = RANGES.find((r) => r.value === firstParam(params.range)) ?? RANGES[0];
  const rawStatus = firstParam(params.status);
  const status = rawStatus === "active" || rawStatus === "cancelled" ? rawStatus : null;
  const q = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const list = await fetchConsolePayments(range.days, status, q, page * PAGE, PAGE);
  const href = (next: { range?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const r = next.range ?? range.value;
    if (r !== "30") sp.set("range", r);
    if (status) sp.set("status", status);
    if (q) sp.set("q", q);
    if (next.page) sp.set("page", String(next.page));
    const s = sp.toString();
    return s ? `/business/payments?${s}` : "/business/payments";
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Recorded in" className="flex gap-1 rounded-xl bg-gray-200/70 p-1">
          {RANGES.map((r) => (
            <Link
              key={r.value}
              href={href({ range: r.value })}
              prefetch={false}
              aria-current={r === range ? "page" : undefined}
              className={cn("flex h-8 items-center rounded-lg px-2.5 text-sm font-medium", r === range ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
            >
              {r.label}
            </Link>
          ))}
        </nav>
        <form method="get" action="/business/payments" className="flex flex-wrap items-center gap-1.5">
          {range.value !== "30" ? <input type="hidden" name="range" value={range.value} /> : null}
          <Select name="status" defaultValue={status ?? ""} aria-label="Status" className="h-9 text-sm">
            <option value="">In force and voided</option>
            <option value="active">In force</option>
            <option value="cancelled">Voided</option>
          </Select>
          <Input name="q" defaultValue={q} placeholder="Business, campaign or reference" aria-label="Search payments" className="h-9 w-60 text-sm" />
          <button type="submit" className={buttonClasses({ variant: "outline", size: "sm" })}>
            Apply
          </button>
        </form>
        <span className="ml-auto">
          <CsvButton
            filename={`unibuzz-payments-${range.value}.csv`}
            header={["recorded", "business", "campaign", "reference", "amount (cents)", "currency", "status", "starts", "ends", "voided", "recorded by"]}
            rows={list.items.map((p) => [
              new Date(p.createdAt).toISOString(),
              p.business?.name ?? "",
              p.ad?.name ?? p.subject,
              p.reference,
              p.amountCents,
              p.currency,
              p.status === "active" ? "in force" : "voided",
              new Date(p.startsAt).toISOString(),
              new Date(p.endsAt).toISOString(),
              p.cancelledAt ? new Date(p.cancelledAt).toISOString() : "",
              p.recordedBy ?? "",
            ])}
            label="CSV of this page"
          />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Payments" value={list.totals.count.toLocaleString("en-US")} hint={`recorded in ${range.label.toLowerCase()}`} />
        <StatTile label="Booked" value={usd(list.totals.bookedCents)} hint="US dollars, voided included" />
        <StatTile label="In force" value={usd(list.totals.inForceCents)} />
        <StatTile label="Voided" value={usd(list.totals.voidedCents)} />
      </div>

      <PaymentsTable payments={list.items} />

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
