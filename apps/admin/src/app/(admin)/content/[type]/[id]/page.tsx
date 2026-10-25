import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getContentSnapshot, MODERATION_TARGET_TYPE_VALUES, type ModerationTargetType } from "@apartment-book/shared";
import { hasRole, requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, firstParam, isUuid } from "@/lib/utils";
import { ContentActions } from "@/components/content/content-actions";
import { ContentView } from "@/components/content/content-view";
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

  let snapshot;
  try {
    snapshot = await getContentSnapshot(await createClient(), targetType, id);
  } catch (error) {
    if (errorMessage(error, "") === "Content not found") notFound();
    throw error;
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
        <ContentActions targetType={targetType} targetId={id} hidden={Boolean(snapshot.hiddenAt)} authorId={snapshot.authorId} canDelete={hasRole(access, "admin")} reportId={reportId} returnTo="/content?deleted=1" />
      </div>
    </div>
  );
}
