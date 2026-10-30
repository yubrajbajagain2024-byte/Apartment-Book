import type { Metadata } from "next";
import Link from "next/link";
import { listReports, type ReportStatus } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { ReportList } from "@/components/reports/report-list";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Reports" };

const TABS: { value: ReportStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "reviewed", label: "Reviewed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaff("/reports");
  const params = await searchParams;
  const requested = firstParam(params.status);
  const status = TABS.find((t) => t.value === requested)?.value ?? "open";
  const reports = await listReports(await createClient(), { status, limit: 50 });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description="What people flagged on the website and in the app. Open the report to see the content, act on it and record a decision." />
      <nav aria-label="Report status" className="flex gap-1 overflow-x-auto rounded-lg bg-gray-200/60 p-1">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "open" ? "/reports" : `/reports?status=${tab.value}`}
            aria-current={tab.value === status ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap", tab.value === status ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <ReportList key={status} initial={reports} status={status} />
    </div>
  );
}
