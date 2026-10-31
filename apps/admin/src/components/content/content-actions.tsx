"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Trash2, UserX } from "lucide-react";
import type { ModerationTargetType } from "@apartment-book/shared";
import { deleteContentAction, hideContentAction, restoreContentAction } from "@/lib/actions/moderation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { ConfirmButton } from "@/components/common/confirm-button";

/**
 * Hide (reversible), restore, and, for admins and owners, delete for good. When the page
 * was opened from a report, the action also records the matching decision on it.
 */
export function ContentActions({
  targetType,
  targetId,
  hidden,
  authorId,
  canDelete,
  reportId,
  returnTo,
}: {
  targetType: ModerationTargetType;
  targetId: string;
  hidden: boolean;
  authorId: string | null;
  canDelete: boolean;
  reportId?: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const [hideState, hide, hiding] = useActionState(hideContentAction, null);
  const [deleteState, remove, deleting] = useActionState(deleteContentAction, null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const suspendHref = authorId ? `/users/${authorId}${reportId ? `?report=${reportId}` : ""}` : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{hidden ? "Hidden" : "Hide"}</CardTitle>
        </CardHeader>
        {hidden ? (
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">Restoring makes it visible again everywhere and brings its photos and video back.</p>
            <FormMessage error={restoreError} success={hideState?.success} />
            <ConfirmButton
              variant="outline"
              className="self-start"
              confirmText="Restore this content for everyone?"
              action={async () => {
                const result = await restoreContentAction(targetType, targetId);
                if (result.error) setRestoreError(result.error);
                else {
                  setRestoreError(null);
                  router.refresh();
                }
              }}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Restore
            </ConfirmButton>
          </CardBody>
        ) : (
          <form action={hide} className="flex flex-col gap-3 px-5 py-4">
            <input type="hidden" name="targetType" value={targetType} />
            <input type="hidden" name="targetId" value={targetId} />
            {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}
            <p className="text-sm text-gray-600">
              Reversible. It disappears from feeds, search, profiles and detail pages; the owner still sees it with your reason. Photos are moved out of the public bucket and videos
              stop playing.
            </p>
            <FormMessage error={hideState?.error} success={hideState?.success} />
            <Field label="Reason shown to the owner" htmlFor="hideReason" required error={hideState?.fieldErrors?.reason} hint="3 to 500 characters, written for the person.">
              <Textarea id="hideReason" name="reason" required minLength={3} maxLength={500} defaultValue={hideState?.values?.reason} placeholder="This listing asks for a deposit before a viewing, which our rules do not allow." />
            </Field>
            <Button type="submit" loading={hiding} className="self-start">
              <EyeOff className="h-4 w-4" aria-hidden="true" />
              Hide{reportId ? " and resolve report" : ""}
            </Button>
          </form>
        )}
      </Card>

      {suspendHref ? (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3">
            <UserX className="h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm text-gray-600">Repeated or serious problems call for a suspension of the account rather than one hidden post.</p>
            <Link href={suspendHref} className="text-sm font-semibold text-brand-600 hover:underline">
              Open the author&apos;s account
            </Link>
          </CardBody>
        </Card>
      ) : null}

      {canDelete ? (
        <Card className="ring-red-200">
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle className="text-base text-red-700">Delete permanently</CardTitle>
            {!showDelete ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowDelete(true)}>
                Show
              </Button>
            ) : null}
          </CardHeader>
          {showDelete ? (
            <form action={remove} className="flex flex-col gap-3 px-5 py-4">
              <input type="hidden" name="targetType" value={targetType} />
              <input type="hidden" name="targetId" value={targetId} />
              {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <p className="text-sm text-gray-600">
                A separate, deliberate act: the row and its comments, likes, saves and votes go for good, and its files and videos are queued for deletion. The full content is
                written to the audit log first. Hide first unless there is a reason not to.
              </p>
              <FormMessage error={deleteState?.error} />
              <Field label="Reason" htmlFor="deleteReason" required error={deleteState?.fieldErrors?.reason}>
                <Textarea id="deleteReason" name="reason" required minLength={3} maxLength={500} defaultValue={deleteState?.values?.reason} />
              </Field>
              <Field label="Type DELETE to confirm" htmlFor="deleteConfirm" required>
                <Input id="deleteConfirm" name="confirm" required autoComplete="off" placeholder="DELETE" className="max-w-48" />
              </Field>
              <Button type="submit" variant="danger" loading={deleting} className="self-start">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete permanently
              </Button>
            </form>
          ) : (
            <CardBody>
              <p className="text-sm text-gray-600">Admins and owners only. Cannot be undone.</p>
            </CardBody>
          )}
        </Card>
      ) : null}
    </div>
  );
}
