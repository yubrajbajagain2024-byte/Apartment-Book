import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarClock, CreditCard, Receipt, Wallet } from "lucide-react";
import {
  canSeeBilling,
  formatCents,
  formatMoneyByCurrency,
  listBusinessPayments,
  paymentStanding,
  paymentStandingLabel,
  paymentSubject,
  paymentsCsv,
  paymentTotals,
  type BusinessPayment,
  type PaymentStanding,
} from "@apartment-book/shared";
import { portalPath, requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { DownloadCsv } from "@/components/business/billing-actions";
import { FilteredList, FilterTabs } from "@/components/business/filter-tabs";
import { PortalLink } from "@/components/business/portal-base";
import { EmptyPanel, PageHeader, Pill, StatTile, type Tone } from "@/components/business/ui";

export const metadata: Metadata = { title: "Billing" };

const FILTERS: { value: "all" | PaymentStanding; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Running" },
  { value: "upcoming", label: "Scheduled" },
  { value: "ended", label: "Ended" },
  { value: "cancelled", label: "Cancelled" },
];
const TONES: Record<PaymentStanding, Tone> = { active: "success", upcoming: "accent", ended: "neutral", cancelled: "danger" };
const FILTER_VALUES = FILTERS.map((f) => f.value);

/** Where a payment's subject lives in the portal: its ad, or v1's listing or post. */
function subjectHref(p: BusinessPayment): string | null {
  if (p.ad) return `/ads/${p.ad.id}`;
  if (p.apartment) return `/listings/${p.apartment.id}/edit`;
  if (p.deal) return `/deals/${p.deal.id}/edit`;
  return null;
}

/** The business's payments, and the moment they were read (what "running" and "this month" are measured against). */
async function loadPayments(businessId: string): Promise<{ payments: BusinessPayment[]; now: number }> {
  const payments = await listBusinessPayments(await createClient(), businessId);
  return { payments, now: Date.now() };
}

/**
 * Billing: what the business has paid for advertising, each payment's receipt, and a CSV for its books. The UniBuzz
 * team records a payment when it approves an ad (there is no card on file), so this page reads and never charges.
 * For the owner, admins and analysts (canSeeBilling); editors draft ads but never pay for them. Every payment is on
 * the page; the standing filter (?status=) picks from them in the browser, so switching costs no request.
 */
export default async function BillingPage() {
  const { membership } = await requireBusiness("/billing");
  if (!canSeeBilling(membership.role)) redirect(await portalPath("/"));
  const business = membership.business;
  const { payments, now } = await loadPayments(business.id);
  const totals = paymentTotals(payments, now);
  const csv = paymentsCsv(
    payments.map((p) => ({
      recorded_at: p.created_at,
      reference: p.payment_reference,
      paid_for: paymentSubject(p),
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      amount_cents: p.amount_cents,
      currency: p.currency,
      status: paymentStandingLabel(paymentStanding(p, now)),
    })),
  );
  const slug = business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing"
        subtitle="What you have paid to advertise on UniBuzz. The UniBuzz team records each payment when it approves an ad, with your invoice or receipt number: there is no card on file, and nothing is charged from here."
        actions={payments.length ? <DownloadCsv csv={csv} filename={`${slug}-payments-${new Date(now).toISOString().slice(0, 10)}.csv`} /> : null}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="billing-totals">
        <StatTile icon={Wallet} label="This month" value={formatMoneyByCurrency(totals.thisMonth)} />
        <StatTile icon={CalendarClock} label="Last 30 days" value={formatMoneyByCurrency(totals.last30)} />
        <StatTile icon={CreditCard} label="All time" value={formatMoneyByCurrency(totals.allTime)} sub={`${payments.length} ${payments.length === 1 ? "payment" : "payments"}`} />
        <StatTile icon={Receipt} label="Running now" value={totals.running.toLocaleString("en-US")} sub="paid campaigns" href="/ads?status=running" />
      </div>

      {payments.length === 0 ? (
        <EmptyPanel
          icon={Receipt}
          title="No payments yet"
          description="When the UniBuzz team approves one of your ads, they record its payment here, with the period it pays for and your invoice or receipt number."
        />
      ) : (
        <>
          <FilterTabs
            label="Filter payments"
            param="status"
            path="/billing"
            fallback="all"
            options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: f.value === "all" ? payments.length : payments.filter((p) => paymentStanding(p, now) === f.value).length }))}
          />
          <FilteredList
            param="status"
            values={FILTER_VALUES}
            fallback="all"
            emptyText="Nothing here."
            className="overflow-hidden"
            testId="payments"
            list
            header={
              <div className="hidden grid-cols-[7rem_minmax(0,1fr)_11rem_9rem_7rem_6rem] gap-4 border-b border-biz-line px-6 py-3 text-[12px] font-medium uppercase tracking-wide text-biz-ink-4 md:grid">
                <span>Recorded</span>
                <span>Paid for</span>
                <span>Period</span>
                <span>Reference</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Status</span>
              </div>
            }
            rows={payments.map((p) => {
                  const standing = paymentStanding(p, now);
                  const href = subjectHref(p);
                  const subject = href ? (
                    <PortalLink href={href} className="block truncate text-[15px] font-medium text-biz-ink hover:underline">
                      {paymentSubject(p)}
                    </PortalLink>
                  ) : (
                    <span className="block truncate text-[15px] font-medium text-biz-ink-3">{paymentSubject(p)}</span>
                  );
                  const receipt = (
                    <PortalLink href={`/billing/${p.id}`} className="text-[13px] font-medium text-biz-accent-ink hover:underline">
                      Receipt
                    </PortalLink>
                  );
                  const amount = formatCents(p.amount_cents, p.currency);
                  const status = <Pill tone={TONES[standing]}>{paymentStandingLabel(standing)}</Pill>;
                  const node = (
                    <>
                      {/* Phones: what and how much, then when, the reference and how it stands. */}
                      <div className="flex flex-col gap-1.5 px-5 py-4 md:hidden">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0">{subject}</span>
                          <span className="shrink-0 text-[15px] font-semibold tabular-nums text-biz-ink">{amount}</span>
                        </div>
                        <p className="text-[13px] text-biz-ink-3" suppressHydrationWarning>
                          {formatDate(p.starts_at)} – {formatDate(p.ends_at)} · recorded {formatDate(p.created_at)}
                        </p>
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-mono text-[12px] text-biz-ink-3">{p.payment_reference}</span>
                          <span className="flex shrink-0 items-center gap-3">
                            {receipt}
                            {status}
                          </span>
                        </div>
                      </div>
                      <div className="hidden grid-cols-[7rem_minmax(0,1fr)_11rem_9rem_7rem_6rem] items-center gap-4 px-6 py-4 md:grid">
                        <span className="text-[13px] text-biz-ink-3" suppressHydrationWarning>
                          {formatDate(p.created_at)}
                        </span>
                        <span className="min-w-0">
                          {subject}
                          {receipt}
                        </span>
                        <span className="text-[13px] text-biz-ink-3" suppressHydrationWarning>
                          {formatDate(p.starts_at)} – {formatDate(p.ends_at)}
                        </span>
                        <span className="truncate font-mono text-[12px] text-biz-ink-3">{p.payment_reference}</span>
                        <span className="text-right text-[15px] font-semibold tabular-nums text-biz-ink">{amount}</span>
                        <span className="text-right">{status}</span>
                      </div>
                    </>
                  );
                  return { key: p.id, filters: ["all", standing], node };
                })}
          />
        </>
      )}
    </div>
  );
}
