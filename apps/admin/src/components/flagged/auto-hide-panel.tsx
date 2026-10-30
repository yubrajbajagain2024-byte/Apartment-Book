"use client";

import { useActionState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { AutoHiddenRow } from "@apartment-book/shared";
import { upholdAutoHideAction } from "@/lib/actions/moderation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Time } from "@/components/common/time";
import { AutoHideStatusBadge, reasonsSummary, sourceText } from "./flag-badges";

/**
 * Shown on a content page when reports hid the item automatically. While the flag waits for review
 * it offers "Keep hidden"; Restore and Delete permanently are the content actions next to it, and
 * all three close the flag, close its reports and tell the owner in the database.
 */
export function AutoHidePanel({ flag }: { flag: AutoHiddenRow }) {
  const [state, keep, keeping] = useActionState(upholdAutoHideAction, null);
  const pending = flag.status === "pending";

  return (
    <Card className={pending ? "ring-red-200" : undefined}>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-5 w-5 text-red-600" aria-hidden="true" />
          Hidden automatically
        </CardTitle>
        <AutoHideStatusBadge status={flag.status} />
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-gray-700">
          {sourceText(flag)}, so it was hidden <Time iso={flag.hiddenAt} /> for everyone but its owner, who was told it is under review.
          {Object.keys(flag.reasons).length ? ` Reasons: ${reasonsSummary(flag.reasons)}.` : ""}
        </p>
        {pending ? (
          <>
            <p className="text-sm text-gray-600">
              Restore it if the reports were wrong: they are dismissed, so it takes 10 new people to hide it again. Keep it hidden if they were right. Admins can also delete it
              permanently below.
            </p>
            <form action={keep} className="flex flex-col gap-3">
              <input type="hidden" name="flagId" value={flag.id} />
              <input type="hidden" name="targetType" value={flag.targetType} />
              <input type="hidden" name="targetId" value={flag.targetId} />
              <FormMessage error={state?.error} success={state?.success} />
              <Field label="Note for staff" htmlFor="keepNote" error={state?.fieldErrors?.note} hint="Optional. Never shown to the owner or the reporters.">
                <Textarea id="keepNote" name="note" maxLength={2000} defaultValue={state?.values?.note} />
              </Field>
              <Button type="submit" variant="outline" loading={keeping} className="self-start">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Keep hidden
              </Button>
            </form>
          </>
        ) : (
          <p className="text-sm text-gray-600">
            Reviewed <Time iso={flag.reviewedAt} /> by {flag.reviewerName ?? (flag.reviewedBy ? "a former staff member" : "the system")}
            {flag.reviewNote ? `: “${flag.reviewNote}”` : "."}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
