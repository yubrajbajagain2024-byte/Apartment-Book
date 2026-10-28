"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { resolveReportAction } from "@/lib/actions/business";
import { cn } from "@/lib/utils";
import { bizButton, bizField } from "./ui";

/** Close a student's report: actioned (the ad was paused or rejected, the business warned) or dismissed, with a note. */
export function ReportActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = (status: "actioned" | "dismissed") =>
    start(async () => {
      const result = await resolveReportAction(reportId, status, note);
      setError(result.error ?? null);
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did (only the UniBuzz team reads this)" aria-label="Note" className={cn(bizField, "h-9 flex-1 text-[13px]")} />
      <button type="button" disabled={pending} onClick={() => run("actioned")} className={bizButton({ variant: "secondary", size: "sm" })}>
        <Check className="h-3.5 w-3.5" /> Actioned
      </button>
      <button type="button" disabled={pending} onClick={() => run("dismissed")} className={bizButton({ variant: "ghost", size: "sm" })}>
        <X className="h-3.5 w-3.5" /> Dismiss
      </button>
      {error ? <p className="text-[13px] text-biz-danger">{error}</p> : null}
    </div>
  );
}
