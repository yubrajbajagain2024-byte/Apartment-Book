"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { REPORT_REASONS, type ReportReason, type ReportTargetType } from "@apartment-book/shared";
import { reportAction } from "@/lib/actions/moderation";
import { cn } from "@/lib/utils";

/** Reason picker shown inside a menu; sends the report and thanks the user. */
export function ReportMenu({ targetType, targetId, onDone, className }: { targetType: ReportTargetType; targetId: string; onDone?: () => void; className?: string }) {
  const [state, setState] = useState<"pick" | "sent" | "error">("pick");
  const [pending, start] = useTransition();
  if (state === "sent") return <p className={cn("px-2.5 py-2 text-sm text-gray-700", className)}>Thanks. Our team will review it.</p>;
  return (
    <div className={className} role="group" aria-label="Report reason">
      <p className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Why are you reporting this?</p>
      {REPORT_REASONS.map((r) => (
        <button
          key={r.value}
          type="button"
          role="menuitem"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await reportAction(targetType, targetId, r.value as ReportReason);
              setState(result.error ? "error" : "sent");
              if (!result.error) setTimeout(() => onDone?.(), 1200);
            })
          }
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50"
        >
          <Flag className="h-4 w-4 text-gray-500" /> {r.label}
        </button>
      ))}
      {state === "error" ? <p className="px-2.5 pt-1 text-xs text-red-600">Could not send the report. Try again.</p> : null}
    </div>
  );
}
