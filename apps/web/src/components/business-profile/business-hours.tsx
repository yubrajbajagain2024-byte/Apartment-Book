"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { businessHoursStatus, HOURS_TIMEZONES, hoursWeekRows, upcomingSpecialHours, type BusinessHours, type HoursStatus } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

const TONE: Record<HoursStatus["tone"], string> = {
  open: "text-green-700",
  soon: "text-amber-700",
  closed: "text-red-600",
};

/**
 * A business's hours on its profile: whether it is open now (worked out in its own time zone, and again every half
 * minute while the page is open), opening into the week, today in bold, and the special hours coming up. The server
 * sends the first status, so the page never flashes an empty line.
 */
export function BusinessHoursPanel({ hours, initial }: { hours: BusinessHours; initial: HoursStatus | null }) {
  const [status, setStatus] = useState(initial);
  useEffect(() => {
    const timer = setInterval(() => setStatus(businessHoursStatus(hours, new Date())), 30_000);
    return () => clearInterval(timer);
  }, [hours]);
  const rows = hoursWeekRows(hours, status?.today ?? null, status?.date);
  const specials = status ? upcomingSpecialHours(hours, status.date) : [];
  const zone = HOURS_TIMEZONES.find((t) => t.value === hours.timezone)?.label ?? hours.timezone;

  return (
    <details className="group w-full max-w-md rounded-xl bg-gray-50 ring-1 ring-gray-200 [&_summary::-webkit-details-marker]:hidden" data-testid="business-hours">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm transition-colors hover:bg-gray-100">
        <Clock className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
        {status ? (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5" data-testid="business-hours-status">
            <span className={cn("font-semibold", TONE[status.tone])}>{status.label}</span>
            {status.detail ? <span className="text-gray-700">· {status.detail}</span> : null}
          </span>
        ) : (
          <span className="font-semibold text-gray-900">Hours</span>
        )}
        {status?.special ? <span className="truncate rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">{status.special}</span> : null}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-gray-500 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-gray-200 px-3.5 pb-3 pt-2.5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {rows.map((r) => (
            <Fragment key={r.day}>
              <dt className={r.today ? "font-semibold text-gray-900" : "text-gray-600"}>{r.label}</dt>
              <dd className={cn("text-right tabular-nums", r.today ? "font-semibold text-gray-900" : r.text === "Closed" ? "text-gray-500" : "text-gray-800")}>
                {r.text}
                {r.special ? <span className="block text-xs font-medium text-amber-700">{r.special}</span> : null}
              </dd>
            </Fragment>
          ))}
        </dl>
        {specials.length ? (
          <div className="mt-3 border-t border-gray-200 pt-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Holiday hours</p>
            <ul className="mt-1.5 flex flex-col gap-1.5 text-sm">
              {specials.map((s) => (
                <li key={s.date} className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 text-gray-800">
                    {s.dateLabel}
                    {s.label ? <span className="text-gray-500"> · {s.label}</span> : null}
                  </span>
                  <span className={cn("shrink-0 tabular-nums", s.text === "Closed" ? "font-medium text-red-600" : "text-gray-800")}>{s.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-gray-500">Times in {zone}.</p>
      </div>
    </details>
  );
}
