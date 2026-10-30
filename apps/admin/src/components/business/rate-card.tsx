"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { centsToDollarInput, parseDollars } from "@apartment-book/shared";
import { setAdRateAction } from "@/lib/console/business-actions";
import type { AdRate } from "@/lib/console/ops-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote, useConsoleAction } from "./advertiser-actions";
import { centralTime, placementLabel, usd } from "./parts";

/** One placement's price: a daily rate per campus and a minimum; an empty daily rate means no price is set. */
function RateRow({ rate }: { rate: AdRate }) {
  const { pending, error, run } = useConsoleAction();
  const [daily, setDaily] = useState(centsToDollarInput(rate.dailyCents));
  const [minimum, setMinimum] = useState(centsToDollarInput(rate.minimumCents));
  const changed = daily !== centsToDollarInput(rate.dailyCents) || minimum !== centsToDollarInput(rate.minimumCents);
  const example = parseDollars(daily);
  return (
    <form
      className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[8rem_10rem_10rem_minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setAdRateAction(rate.placement, daily, minimum));
      }}
    >
      <div>
        <p className="font-medium text-gray-900">{placementLabel(rate.placement)}</p>
        <p className="text-xs text-gray-500">{rate.updatedAt ? `${rate.updatedBy ?? "Staff"}, ${centralTime(rate.updatedAt)}` : "no price yet"}</p>
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Per campus per day (USD)
        <Input value={daily} onChange={(e) => setDaily(e.target.value)} inputMode="decimal" placeholder="no price" className="tabular-nums" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Minimum per ad (USD)
        <Input value={minimum} onChange={(e) => setMinimum(e.target.value)} inputMode="decimal" placeholder="0" className="tabular-nums" />
      </label>
      <p className="text-xs text-gray-500">{example !== null ? `A week on one campus: ${usd(Math.max(example * 7, parseDollars(minimum) ?? 0))}` : "Leave the daily rate empty for no price."}</p>
      <div className="flex flex-col gap-1">
        <ErrorNote error={error} />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !changed}>
          <Save className="h-4 w-4" aria-hidden /> Save
        </Button>
      </div>
    </form>
  );
}

export function RateCard({ rates }: { rates: AdRate[] }) {
  return (
    <div className="divide-y divide-gray-100 rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      {rates.map((r) => (
        <RateRow key={r.placement} rate={r} />
      ))}
    </div>
  );
}
