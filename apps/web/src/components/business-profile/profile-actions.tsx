"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Flag, MoreHorizontal } from "lucide-react";
import { BUSINESS_REPORT_REASONS, recordBusinessEvent, type BusinessReportReason } from "@apartment-book/shared";
import { reportBusinessAction, setBusinessBlockedAction } from "@/lib/actions/ads";
import { createClient } from "@/lib/supabase/client";

/** Counts the visit (once per student per day; from an ad, as that ad's profile visit). Nothing for the business's own people. */
export function TrackProfileVisit({ businessId, adId }: { businessId: string; adId: string | null }) {
  useEffect(() => {
    void recordBusinessEvent(createClient(), "profile_visit", { businessId, adId, placement: adId ? null : "profile" });
  }, [businessId, adId]);
  return null;
}

/** "…" on a business's profile: report it to the UniBuzz team, or block it (its ads and posts go, it cannot be messaged). */
export function BusinessMenu({ businessId, name, blocked }: { businessId: string; name: string; blocked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (work: () => Promise<{ error?: string }>, done: string) =>
    start(async () => {
      const result = await work();
      setNote(result.error ?? done);
      setOpen(false);
      setReporting(false);
      router.refresh();
    });
  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100";
  return (
    <div className="relative">
      <button type="button" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200 text-gray-900 hover:bg-gray-300">
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open ? (
        <div role="menu" className="ab-menu-in absolute right-0 top-full z-30 mt-1 w-64 origin-top-right rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-gray-200">
          {reporting ? (
            <>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Why are you reporting {name}?</p>
              {BUSINESS_REPORT_REASONS.map((r) => (
                <button key={r.value} type="button" role="menuitem" disabled={pending} onClick={() => run(() => reportBusinessAction({ businessId }, r.value as BusinessReportReason), "Thanks. The UniBuzz team will look at it.")} className={row}>
                  {r.label}
                </button>
              ))}
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => setReporting(true)} className={row}>
                <Flag className="h-4 w-4" /> Report {name}
              </button>
              <button type="button" role="menuitem" disabled={pending} onClick={() => run(() => setBusinessBlockedAction(businessId, !blocked), blocked ? `${name} is unblocked.` : `${name} is blocked.`)} className={row}>
                <Ban className="h-4 w-4" /> {blocked ? "Unblock" : "Block"} {name}
              </button>
            </>
          )}
        </div>
      ) : null}
      {note ? (
        <p role="status" className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
          {note}
        </p>
      ) : null}
    </div>
  );
}
