"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Flag } from "lucide-react";
import { listReports, type ReportRow, type ReportStatus } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { Time } from "@/components/common/time";
import { ReasonBadge, StatusBadge, targetTypeLabel } from "./report-badges";

const PAGE = 50;

/** One report as a list row: what was reported, by whom, how long ago, and its state. Links to the review page. */
export function ReportRowSummary({ report }: { report: ReportRow }) {
  return (
    <li>
      <Link href={`/reports/${report.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 sm:px-5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <Flag className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ReasonBadge reason={report.reason} />
            <span className="text-sm font-semibold text-gray-900">{targetTypeLabel(report.targetType)}</span>
            {!report.targetExists ? <Badge tone="gray">Removed</Badge> : report.targetHidden ? <Badge tone="amber">{report.targetType === "profile" ? "Suspended" : "Hidden"}</Badge> : null}
            {report.status !== "open" ? <StatusBadge status={report.status} decision={report.decision} /> : null}
          </div>
          {report.targetPreview ? <p className="mt-0.5 truncate text-sm text-gray-700">“{report.targetPreview}”</p> : null}
          {report.details ? <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{report.details}</p> : null}
          <p className="mt-1 text-xs text-gray-500">
            Reported by <span className="font-medium text-gray-600">{report.reporterName || report.reporterEmail || "someone"}</span> · <Time iso={report.createdAt} />
          </p>
        </div>
        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** The queue for one status: first page from the server, older pages fetched with the browser client. */
export function ReportList({ initial, status }: { initial: ReportRow[]; status: ReportStatus | "all" }) {
  const [items, setItems] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loading) return;
    setLoading(true);
    setError(null);
    try {
      const older = await listReports(createClient(), { status, limit: PAGE, before: last.createdAt });
      setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.id === o.id))]);
      setDone(older.length < PAGE);
    } catch (e) {
      setError(`Could not load older reports. ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Flag}
        title={status === "open" ? "No open reports" : "Nothing here"}
        description={status === "open" ? "Reports from the website and the app land here the moment they are filed." : "No reports with this status yet."}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-gray-100">
          {items.map((report) => (
            <ReportRowSummary key={report.id} report={report} />
          ))}
        </ul>
      </Card>
      <FormMessage error={error} />
      {!done ? (
        <Button variant="outline" onClick={loadMore} loading={loading} className="self-center">
          Load older
        </Button>
      ) : null}
    </div>
  );
}
