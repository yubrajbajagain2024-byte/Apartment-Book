import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BUSINESS_PORTAL_NAME, canSeeBilling, formatCents, getBusinessPayment, paymentStanding, paymentStandingLabel, paymentSubject } from "@apartment-book/shared";
import { portalPath, requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { PrintReceipt } from "@/components/business/billing-actions";
import { BizLink, Panel, Pill } from "@/components/business/ui";

export const metadata: Metadata = { title: "Receipt · Billing" };

/**
 * One payment's receipt, to print or save as a PDF for the business's books: who paid, for what, for which dates, the
 * amount and the invoice or receipt number the UniBuzz team recorded with it.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ membership }, { id }] = await Promise.all([requireBusiness("/billing"), params]);
  if (!canSeeBilling(membership.role)) redirect(await portalPath("/"));
  const business = membership.business;
  const payment = await getBusinessPayment(await createClient(), business.id, id);
  if (!payment) notFound();
  const standing = paymentStanding(payment);
  const rows: [string, string][] = [
    ["Paid for", paymentSubject(payment)],
    ["Period", `${formatDate(payment.starts_at)} – ${formatDate(payment.ends_at)}`],
    ["Recorded", formatDate(payment.created_at)],
    ["Invoice or receipt number", payment.payment_reference],
    ["Status", paymentStandingLabel(standing)],
  ];
  if (payment.cancelled_at) rows.push(["Cancelled", formatDate(payment.cancelled_at)]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BizLink href="/billing" variant="ghost">
          <ArrowLeft className="h-4 w-4" /> Billing
        </BizLink>
        <PrintReceipt />
      </div>
      <Panel className="p-8 print:shadow-none print:ring-0" data-testid="receipt">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-biz-line pb-6">
          <div>
            <p className="text-[13px] font-medium text-biz-ink-3">{BUSINESS_PORTAL_NAME}</p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-biz-ink">Receipt</h1>
            <p className="mt-1 font-mono text-[12px] text-biz-ink-4">{payment.id}</p>
          </div>
          <div className="text-right">
            <p className="text-[13px] text-biz-ink-3">Amount</p>
            <p className="text-[30px] font-semibold tabular-nums tracking-[-0.02em] text-biz-ink">{formatCents(payment.amount_cents, payment.currency)}</p>
            <Pill tone={standing === "cancelled" ? "danger" : "neutral"}>{payment.currency}</Pill>
          </div>
        </header>
        <section className="grid gap-6 py-6 sm:grid-cols-2">
          <div>
            <h2 className="text-[12px] font-medium uppercase tracking-wide text-biz-ink-4">Billed to</h2>
            <p className="mt-2 text-[15px] font-semibold text-biz-ink">{business.name}</p>
            {[business.address, business.city].filter(Boolean).length ? <p className="text-[14px] text-biz-ink-2">{[business.address, business.city].filter(Boolean).join(", ")}</p> : null}
            {business.contact_email ? <p className="text-[14px] text-biz-ink-2">{business.contact_email}</p> : null}
          </div>
          <div>
            <h2 className="text-[12px] font-medium uppercase tracking-wide text-biz-ink-4">Received by</h2>
            <p className="mt-2 text-[15px] font-semibold text-biz-ink">UniBuzz</p>
            <p className="text-[14px] text-biz-ink-2">Advertising on UniBuzz</p>
          </div>
        </section>
        <dl className="divide-y divide-biz-line border-t border-biz-line">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-2 py-3 text-[15px]">
              <dt className="text-biz-ink-3">{label}</dt>
              <dd className="min-w-0 break-words text-right font-medium text-biz-ink" suppressHydrationWarning>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[13px] leading-relaxed text-biz-ink-4">
          The UniBuzz team recorded this payment when it approved your advertising. Keep it with the invoice it names; questions about it go to the UniBuzz team with this number.
        </p>
      </Panel>
    </div>
  );
}
