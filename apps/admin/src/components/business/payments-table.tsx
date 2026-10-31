"use client";

import { useState } from "react";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import { formatCents } from "@apartment-book/shared";
import { voidPaymentAction } from "@/lib/console/business-actions";
import type { ConsolePayment } from "@/lib/console/ops-types";
import { StaffDialog } from "@/components/console/dialog";
import { Panel, Pill } from "@/components/console/parts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ErrorNote, useConsoleAction } from "./advertiser-actions";
import { centralDay, centralTime } from "./parts";

const SUBJECT = { ad: "Ad", listing: "Listing (v1)", post: "Post (v1)", removed: "Removed" } as const;

/**
 * Payments on record: amount, reference, the period paid for, who recorded it, and whether it is in force. Voiding one
 * (refunded, or recorded by mistake) needs a reason the business reads; an ad left with no payment in force ends.
 */
export function PaymentsTable({ payments, showBusiness = true }: { payments: ConsolePayment[]; showBusiness?: boolean }) {
  const [voiding, setVoiding] = useState<ConsolePayment | null>(null);
  const [reason, setReason] = useState("");
  const { pending, error, run, setError } = useConsoleAction();
  if (payments.length === 0) return <p className="text-sm text-gray-500">No payments on record.</p>;
  const close = () => {
    setVoiding(null);
    setReason("");
    setError(null);
  };
  return (
    <>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Recorded</th>
              {showBusiness ? <th className="px-3 py-2 font-medium">Business</th> : null}
              <th className="px-3 py-2 font-medium">For</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Period</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Status and actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {payments.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-3 py-1.5 text-gray-700">
                  {centralDay(p.createdAt)}
                  <p className="text-xs text-gray-500">{p.recordedBy ?? "Former staff"}</p>
                </td>
                {showBusiness ? (
                  <td className="px-3 py-1.5">
                    {p.business ? (
                      <Link href={`/business/advertisers/${p.business.id}`} prefetch={false} className="text-gray-900 hover:underline">
                        {p.business.name}
                      </Link>
                    ) : (
                      <span className="text-gray-500">Deleted business</span>
                    )}
                  </td>
                ) : null}
                <td className="px-3 py-1.5">
                  {p.ad ? (
                    <Link href={`/business/campaigns/${p.ad.id}`} prefetch={false} className="text-gray-900 hover:underline">
                      {p.ad.name}
                    </Link>
                  ) : (
                    <span className="text-gray-600">{SUBJECT[p.subject]}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-gray-800">{p.reference}</td>
                <td className="px-3 py-1.5 text-gray-700">
                  {centralDay(p.startsAt)} to {centralDay(p.endsAt)}
                </td>
                <td className={p.status === "cancelled" ? "px-3 py-1.5 text-right tabular-nums text-gray-500 line-through" : "px-3 py-1.5 text-right tabular-nums text-gray-900"}>
                  {formatCents(p.amountCents, p.currency)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {p.status === "cancelled" ? (
                    <Pill tone="gray" title={p.cancelledAt ? `Voided ${centralTime(p.cancelledAt)}` : undefined}>
                      Voided
                    </Pill>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setVoiding(p)}>
                      <Undo2 className="h-4 w-4" aria-hidden /> Void
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <StaffDialog
        open={voiding !== null}
        onClose={close}
        tone="danger"
        title="Void this payment?"
        description={voiding ? `${formatCents(voiding.amountCents, voiding.currency)}, ${voiding.reference}. It stays on record as voided. If its ad has no other payment in force, the ad ends now.` : undefined}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="button" variant="danger" disabled={pending || reason.trim().length < 5} onClick={() => voiding && run(() => voidPaymentAction(voiding.id, reason), close)}>
              Void payment
            </Button>
          </>
        }
      >
        <ErrorNote error={error} />
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Why (the business reads this)
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={900} data-autofocus />
        </label>
      </StaffDialog>
    </>
  );
}
