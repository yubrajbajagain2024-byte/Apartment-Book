import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getContentSnapshot, isMissingFunctionError, listAutoHidden, MODERATION_TARGET_TYPE_VALUES, type AutoHiddenRow, type ModerationTargetType } from "@apartment-book/shared";
import { hasRole, requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, firstParam, isUuid } from "@/lib/utils";
import { ContentActions } from "@/components/content/content-actions";
import { ContentView } from "@/components/content/content-view";
import { AutoHidePanel } from "@/components/flagged/auto-hide-panel";
import { targetTypeLabel } from "@/components/reports/report-badges";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Review content" };

type Props = { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

export default async function ContentDetailPage({ params, searchParams }: Props) {
  const { type, id } = await params;
  if (!(MODERATION_TARGET_TYPE_VALUES as readonly string[]).includes(type) || !isUuid(id)) notFound();
  const targetType = type as ModerationTargetType;
  const access = await requireStaff(`/content/${type}/${id}`);
  const query = await searchParams;
  const reportId = isUuid(firstParam(query.report)) ? firstParam(query.report) : undefined;

  const supabase = await createClient();
  let snapshot;
  try {
    snapshot = await getContentSnapshot(supabase, targetType, id);
  } catch (error) {
    if (errorMessage(error, "") === "Content not found") notFound();
    throw error;
  }
  // Its latest automatic hide, if reports ever hid it. Missing until main's report auto-hide migration is live.
  let flag: AutoHiddenRow | null = null;
  try {
    flag = (await listAutoHidden(supabase, { status: "all", limit: 1, target: { type: targetType, id } }))[0] ?? null;
  } catch (error) {
    if (!isMissingFunctionError(error)) throw error;
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href={reportId ? `/reports/${reportId}` : "/content"} className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {reportId ? "Back to the report" : "Content"}
      </Link>
      <PageHeader title={targetTypeLabel(targetType)} description="Hide first; it is reversible. Deleting is a separate, permanent step for admins and owners." />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ContentView snapshot={snapshot} />
        <div className="flex min-w-0 flex-col gap-4">
          {flag ? <AutoHidePanel flag={flag} /> : null}
          <ContentActions targetType={targetType} targetId={id} hidden={Boolean(snapshot.hiddenAt)} authorId={snapshot.authorId} canDelete={hasRole(access, "admin")} reportId={reportId} returnTo={flag?.status === "pending" ? "/flagged?deleted=1" : "/content?deleted=1"} />
        </div>
      </div>
    </div>
  );
}
