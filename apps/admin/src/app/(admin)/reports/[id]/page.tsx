import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getContentSnapshot, getReport, isMissingFunctionError, listReports, type ContentSnapshot, type ReportRow } from "@apartment-book/shared";
import { hasRole, requireStaff } from "@/lib/admin";
import { siteUrlFor } from "@/lib/site-links";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, firstParam, isUuid } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { Time } from "@/components/common/time";
import { ContentActions } from "@/components/content/content-actions";
import { ContentView } from "@/components/content/content-view";
import { ReasonBadge, StatusBadge, targetTypeLabel } from "@/components/reports/report-badges";
import { ResolveForm } from "@/components/reports/resolve-form";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Report" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** admin_report_get is migration 16; until it is applied the row is found in the full list (first 200). */
async function loadReport(id: string): Promise<ReportRow | null> {
  const supabase = await createClient();
  try {
    return await getReport(supabase, id);
  } catch (error) {
    if (errorMessage(error, "") === "Report not found") return null;
    if (!isMissingFunctionError(error)) throw error;
    const all = await listReports(supabase, { status: "all", limit: 200 });
    return all.find((r) => r.id === id) ?? null;
  }
}

export default async function ReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const access = await requireStaff(`/reports/${id}`);
  const query = await searchParams;
  const report = await loadReport(id);
  if (!report) notFound();

  let snapshot: ContentSnapshot | null = null;
  let snapshotError: string | null = null;
  if (report.targetType !== "profile" && report.targetExists) {
    try {
      snapshot = await getContentSnapshot(await createClient(), report.targetType, report.targetId);
    } catch (error) {
      snapshotError = errorMessage(error);
    }
  }
  const profileUrl = report.targetType === "profile" ? siteUrlFor("profile", report.targetId) : null;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Reports
      </Link>
      <PageHeader
        title={`Report: ${targetTypeLabel(report.targetType)}`}
        description="Read what was reported, look at the content, act on it, then record the decision. Everything is logged with your name."
        actions={<StatusBadge status={report.status} decision={report.decision} />}
      />
      {firstParam(query.deleted) ? <FormMessage success="The content was deleted permanently and the report resolved." /> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {report.targetType === "profile" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reported profile</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-3 text-sm">
                {report.targetExists ? (
                  <>
                    <p className="text-gray-700">
                      <Link href={`/users/${report.targetId}?report=${report.id}`} className="font-semibold text-gray-900 hover:underline">
                        {report.targetPreview || "Unnamed"}
                      </Link>
                      {report.targetHidden ? <Badge tone="red" className="ml-2">Suspended</Badge> : null}
                    </p>
                    <p className="text-gray-600">Profiles are moderated through the account: open it to see their activity, previous suspensions and to suspend them. Suspending from there resolves this report.</p>
                    <div className="flex flex-wrap gap-3">
                      <Link href={`/users/${report.targetId}?report=${report.id}`} className="font-semibold text-brand-600 hover:underline">
                        Open account
                      </Link>
                      {profileUrl ? (
                        <a href={profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-gray-600 hover:underline">
                          Profile on site
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="text-gray-600">This account no longer exists.</p>
                )}
              </CardBody>
            </Card>
          ) : snapshot ? (
            <>
              <ContentView snapshot={snapshot} />
              <ContentActions
                targetType={snapshot.targetType}
                targetId={snapshot.targetId}
                hidden={Boolean(snapshot.hiddenAt)}
                authorId={snapshot.authorId}
                canDelete={hasRole(access, "admin")}
                reportId={report.id}
              />
            </>
          ) : (
            <Card>
              <CardBody className="text-sm text-gray-600">{snapshotError ? `The content could not be loaded: ${snapshotError}` : "This content no longer exists; it was deleted by its owner or by staff."}</CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">The report</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <ReasonBadge reason={report.reason} />
                <span className="text-gray-500">
                  <Time iso={report.createdAt} />
                </span>
              </div>
              {report.details ? <p className="whitespace-pre-wrap text-gray-800">{report.details}</p> : <p className="italic text-gray-500">No details given.</p>}
              <p className="text-xs text-gray-500">
                Reported by{" "}
                <Link href={`/users/${report.reporterId}`} className="font-medium text-gray-700 hover:underline">
                  {report.reporterName || report.reporterEmail || "someone"}
                </Link>
                {report.reporterEmail && report.reporterName ? ` (${report.reporterEmail})` : ""}
              </p>
              {report.targetPreview ? <p className="text-xs text-gray-500">About: “{report.targetPreview}”</p> : null}
            </CardBody>
          </Card>
          <ResolveForm report={report} />
        </div>
      </div>
    </div>
  );
}
