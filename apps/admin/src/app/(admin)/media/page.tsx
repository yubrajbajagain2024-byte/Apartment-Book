import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { getMediaJobStats, listMediaJobs } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { workerStatus } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaJobsTable } from "@/components/media/media-jobs-table";
import { RunWorkerButton } from "@/components/media/run-worker-button";
import { StatCard } from "@/components/overview/stat-card";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Media" };

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />}
      <span>
        <span className="font-medium text-gray-900">{label}</span> <span className="text-gray-600">{detail}</span>
      </span>
    </li>
  );
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaff("/media");
  const params = await searchParams;
  const showAll = firstParam(params.view) === "all";
  const supabase = await createClient();
  const [stats, jobs] = await Promise.all([getMediaJobStats(supabase), listMediaJobs(supabase, { pendingOnly: !showAll, limit: 100 })]);
  const status = workerStatus();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Media"
        description="Photos and videos of hidden or deleted content. The database queues the work; this app's worker moves photos to the private quarantine bucket, deletes files and turns video playback off and on."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Pending" value={stats.pending} hint="waiting or retrying" icon={Clock} tone={stats.pending > 0 ? "amber" : "gray"} />
        <StatCard label="Failing" value={stats.failing} hint="three or more attempts" icon={AlertTriangle} tone={stats.failing > 0 ? "red" : "gray"} />
        <StatCard label="Done" value={stats.done} hint="finished or superseded" icon={CheckCircle2} tone="green" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Worker</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1.5">
            <Check ok={status.storage} label="Storage" detail={status.storage ? "configured: photos are quarantined, released and deleted." : "not configured: set SUPABASE_SERVICE_ROLE_KEY on the admin app."} />
            <Check ok={status.mux} label="Mux" detail={status.mux ? "configured: video playback is disabled, re-enabled and assets deleted." : "not configured: set MUX_TOKEN_ID and MUX_TOKEN_SECRET on the admin app; video jobs wait."} />
            <Check ok={status.cron} label="Scheduled retry" detail={status.cron ? "CRON_SECRET is set; the daily sweep in vercel.json can run." : "set CRON_SECRET to enable the scheduled sweep. Hiding and deleting still run the worker at once."} />
          </ul>
          <p className="text-sm text-gray-600">The worker runs right after every hide, restore and delete. Use the button after a retry, or when jobs piled up while the keys were missing.</p>
          <RunWorkerButton enabled={status.storage} />
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{showAll ? "All jobs" : "Pending jobs"}</h2>
        <nav aria-label="Queue view" className="flex gap-1 rounded-lg bg-gray-200/60 p-1">
          <Link href="/media" aria-current={!showAll ? "page" : undefined} className={cn("rounded-md px-3 py-1 text-sm font-medium", !showAll ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}>
            Pending
          </Link>
          <Link href="/media?view=all" aria-current={showAll ? "page" : undefined} className={cn("rounded-md px-3 py-1 text-sm font-medium", showAll ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}>
            All
          </Link>
        </nav>
      </div>
      <MediaJobsTable jobs={jobs} />
    </div>
  );
}
