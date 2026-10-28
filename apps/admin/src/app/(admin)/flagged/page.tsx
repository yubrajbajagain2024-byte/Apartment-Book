import type { Metadata } from "next";
import Link from "next/link";
import {
  AUTO_HIDE_STATUSES,
  AUTO_HIDE_THRESHOLD,
  getAutoHiddenCounts,
  isMissingFunctionError,
  listAutoHidden,
  type AutoHiddenCounts,
  type AutoHiddenRow,
  type AutoHideStatus,
} from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { FormMessage } from "@/components/ui/field";
import { SetupNotice } from "@/components/ui/setup-notice";
import { FlaggedList } from "@/components/flagged/flagged-list";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Flagged" };

const TABS: { value: AutoHideStatus | "all"; label: string }[] = [...AUTO_HIDE_STATUSES.map((s) => ({ value: s.value, label: s.label })), { value: "all", label: "All" }];

export default async function FlaggedPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaff("/flagged");
  const params = await searchParams;
  const requested = firstParam(params.status);
  const status = TABS.find((t) => t.value === requested)?.value ?? "pending";
  const supabase = await createClient();

  let rows: AutoHiddenRow[] = [];
  let counts: AutoHiddenCounts | null = null;
  let needsMigration = false;
  try {
    [rows, counts] = await Promise.all([listAutoHidden(supabase, { status, limit: 50 }), getAutoHiddenCounts(supabase)]);
  } catch (error) {
    if (!isMissingFunctionError(error)) throw error;
    needsMigration = true;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Flagged"
        description={`Content hidden automatically because ${AUTO_HIDE_THRESHOLD} different people reported it (buzzes can be hidden sooner by Buzz's own threshold). It stays hidden until you restore it, keep it hidden or delete it; its owner was told it is under review.`}
      />
      {firstParam(params.deleted) ? <FormMessage success="The content was deleted permanently. Its files and videos are being removed." /> : null}
      {needsMigration ? (
        <SetupNotice migration="20261109000000_report_auto_hide (on main)" what="Hiding content automatically after reports" />
      ) : (
        <>
          <nav aria-label="Review status" className="flex gap-1 overflow-x-auto rounded-lg bg-gray-200/60 p-1">
            {TABS.map((tab) => (
              <Link
                key={tab.value}
                href={tab.value === "pending" ? "/flagged" : `/flagged?status=${tab.value}`}
                aria-current={tab.value === status ? "page" : undefined}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap", tab.value === status ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
              >
                {tab.label}
                {counts && tab.value !== "all" ? <span className="ml-1.5 text-xs text-gray-500">{counts[tab.value]}</span> : null}
              </Link>
            ))}
          </nav>
          <FlaggedList key={status} initial={rows} status={status} />
        </>
      )}
    </div>
  );
}
