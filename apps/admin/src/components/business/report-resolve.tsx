"use client";

import { useState } from "react";
import { resolveBusinessReportAction } from "@/lib/console/business-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote, useConsoleAction } from "./advertiser-actions";

/** Close a student's report: actioned (the ad paused or rejected, the business warned or suspended) or dismissed. */
export function ReportResolve({ reportId }: { reportId: string }) {
  const { pending, error, run } = useConsoleAction();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote error={error} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="What you did (the team only)" aria-label="Note" className="h-9 flex-1 text-sm" />
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveBusinessReportAction(reportId, "actioned", note))}>
          Actioned
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resolveBusinessReportAction(reportId, "dismissed", note))}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
