"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { REPORT_DECISIONS, type ReportRow } from "@apartment-book/shared";
import { reopenReportAction, resolveReportAction } from "@/lib/actions/moderation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Time } from "@/components/common/time";
import { decisionLabel } from "./report-badges";

/** Close an open report with a decision and staff-only notes, or reopen a closed one. */
export function ResolveForm({ report }: { report: ReportRow }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(resolveReportAction, null);
  const [error, setError] = useState<string | null>(null);

  if (report.status !== "open") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decision</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 text-sm">
          <p className="font-semibold text-gray-900">{report.status === "dismissed" ? "Dismissed" : decisionLabel(report.decision) || "Reviewed"}</p>
          {report.notes ? <p className="whitespace-pre-wrap text-gray-700">{report.notes}</p> : null}
          <p className="text-xs text-gray-500">
            by {report.reviewerName || "staff"} · <Time iso={report.reviewedAt} />
          </p>
          <FormMessage error={error} />
          <ConfirmButton
            variant="outline"
            size="sm"
            className="self-start"
            confirmText="Reopen this report? The decision and notes are cleared."
            action={async () => {
              const result = await reopenReportAction(report.id);
              if (result.error) setError(result.error);
              else router.refresh();
            }}
          >
            Reopen
          </ConfirmButton>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Close this report</CardTitle>
      </CardHeader>
      <form action={action} className="flex flex-col gap-4 px-5 py-4">
        <input type="hidden" name="reportId" value={report.id} />
        <FormMessage error={state?.error} success={state?.success} />
        <Field label="Decision" htmlFor="decision" required error={state?.fieldErrors?.decision} hint="Hiding, deleting or suspending from this page records the matching decision for you.">
          <Select id="decision" name="decision" required defaultValue={state?.values?.decision ?? "no_action"}>
            {REPORT_DECISIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes for staff" htmlFor="notes" error={state?.fieldErrors?.notes} hint="Never shown to the reporter or the author.">
          <Textarea id="notes" name="notes" maxLength={2000} defaultValue={state?.values?.notes} placeholder="What you checked and why you decided this." />
        </Field>
        <Button type="submit" loading={pending} className="self-start">
          Close report
        </Button>
      </form>
    </Card>
  );
}
